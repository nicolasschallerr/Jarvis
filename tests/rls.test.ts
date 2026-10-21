import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  anonClient,
  createTestUser,
  randomId,
  type TestUser,
} from "./helpers/supabase-test";

// Pruebas de aislamiento (RLS) contra el proyecto de desarrollo. Crean sus propias
// organizaciones y usuarios con el prefijo "zz-test-" y los borran al terminar.
//
// Escenario:
//   Organización A: superadmin, operador del sector A1, operador de otro sector, consulta.
//   Organización B: superadmin.

const admin = adminClient();
const runId = randomId();
const userIds: string[] = [];
const orgIds: string[] = [];

let orgA = "";
let orgB = "";
let sectorA1 = "";
let sectorA2 = "";
let contactA = "";
let contactB = "";
let caseA = "";
let conversationA = "";

let aSuper: TestUser;
let aOperatorSector: TestUser;
let aOperatorOther: TestUser;
let aViewer: TestUser;
let bSuper: TestUser;

async function must<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
  what: string,
): Promise<Exclude<T, null>> {
  const { data, error } = await promise;
  if (error || data === null) {
    throw new Error(`Preparación fallida (${what}): ${error?.message ?? "sin datos"}`);
  }
  return data as Exclude<T, null>;
}

beforeAll(async () => {
  orgA = (
    await must(
      admin
        .from("organizations")
        .insert({ slug: `zz-test-${runId}-a`, name: "Prueba A" })
        .select("id")
        .single(),
      "org A",
    )
  ).id;
  orgB = (
    await must(
      admin
        .from("organizations")
        .insert({ slug: `zz-test-${runId}-b`, name: "Prueba B" })
        .select("id")
        .single(),
      "org B",
    )
  ).id;
  orgIds.push(orgA, orgB);

  aSuper = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "a-super", runId });
  aOperatorSector = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "a-op-sector", runId });
  aOperatorOther = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "a-op-otro", runId });
  aViewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "a-viewer", runId });
  bSuper = await createTestUser(admin, { organizationId: orgB, role: "superadmin", label: "b-super", runId });
  userIds.push(aSuper.id, aOperatorSector.id, aOperatorOther.id, aViewer.id, bSuper.id);

  sectorA1 = (
    await must(
      admin.from("sectors").insert({ organization_id: orgA, slug: "sector-1", name: "Sector 1" }).select("id").single(),
      "sector A1",
    )
  ).id;
  sectorA2 = (
    await must(
      admin.from("sectors").insert({ organization_id: orgA, slug: "sector-2", name: "Sector 2" }).select("id").single(),
      "sector A2",
    )
  ).id;
  await must(
    admin
      .from("sector_members")
      .insert({ sector_id: sectorA1, profile_id: aOperatorSector.id, organization_id: orgA })
      .select("sector_id")
      .single(),
    "miembro sector A1",
  );
  await must(
    admin
      .from("sector_members")
      .insert({ sector_id: sectorA2, profile_id: aOperatorOther.id, organization_id: orgA })
      .select("sector_id")
      .single(),
    "miembro sector A2",
  );

  contactA = (
    await must(
      admin.from("contacts").insert({ organization_id: orgA, display_name: "Contacto A" }).select("id").single(),
      "contacto A",
    )
  ).id;
  contactB = (
    await must(
      admin.from("contacts").insert({ organization_id: orgB, display_name: "Contacto B" }).select("id").single(),
      "contacto B",
    )
  ).id;

  caseA = (
    await must(
      admin
        .from("cases")
        .insert({ organization_id: orgA, contact_id: contactA, sector_id: sectorA1, title: "Caso A" })
        .select("id")
        .single(),
      "caso A",
    )
  ).id;

  const channelA = (
    await must(
      admin
        .from("channels")
        .insert({ organization_id: orgA, type: "whatsapp", name: "Canal A", external_id: `zz-test-${runId}` })
        .select("id")
        .single(),
      "canal A",
    )
  ).id;
  conversationA = (
    await must(
      admin
        .from("conversations")
        .insert({ organization_id: orgA, contact_id: contactA, channel_id: channelA })
        .select("id")
        .single(),
      "conversación A",
    )
  ).id;
  await must(
    admin
      .from("messages")
      .insert({
        organization_id: orgA,
        conversation_id: conversationA,
        direction: "inbound",
        sender: "contact",
        body: "mensaje de prueba",
      })
      .select("id")
      .single(),
    "mensaje A",
  );
});

afterAll(async () => {
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
  // Borrar la organización elimina en cascada todo lo que cuelga de ella.
  if (orgIds.length > 0) {
    await admin.from("organizations").delete().in("id", orgIds);
  }
});

describe("sin sesión", () => {
  it("no lee datos de ninguna tabla de negocio", async () => {
    const anon = anonClient();
    for (const table of ["organizations", "profiles", "contacts", "cases", "messages", "conversations"] as const) {
      const { data } = await anon.from(table).select("id");
      expect(data ?? [], `tabla ${table}`).toHaveLength(0);
    }
  });
});

describe("aislamiento entre organizaciones", () => {
  it("cada usuario ve solo su organización", async () => {
    const { data } = await aSuper.client.from("organizations").select("id");
    expect(data?.map((o) => o.id)).toEqual([orgA]);

    const { data: other } = await bSuper.client.from("organizations").select("id");
    expect(other?.map((o) => o.id)).toEqual([orgB]);
  });

  it("la organización B no ve contactos, casos ni mensajes de A", async () => {
    for (const table of ["contacts", "cases", "messages", "conversations", "sectors", "profiles"] as const) {
      const { data } = await bSuper.client.from(table).select("organization_id");
      const foreign = (data ?? []).filter((row) => row.organization_id === orgA);
      expect(foreign, `tabla ${table}`).toHaveLength(0);
    }
  });

  it("la organización B no puede crear datos dentro de A", async () => {
    const { error } = await bSuper.client
      .from("contacts")
      .insert({ organization_id: orgA, display_name: "Intruso" });
    expect(error).not.toBeNull();
  });

  it("la organización B no puede modificar ni borrar datos de A", async () => {
    await bSuper.client.from("contacts").update({ display_name: "Hackeado" }).eq("id", contactA);
    await bSuper.client.from("contacts").delete().eq("id", contactA);

    const { data } = await admin.from("contacts").select("display_name").eq("id", contactA).single();
    expect(data?.display_name).toBe("Contacto A");
  });

  it("A no ve los contactos de B", async () => {
    const { data } = await aSuper.client.from("contacts").select("id").eq("id", contactB);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("roles dentro de una organización", () => {
  it("consulta y reportes lee pero no escribe contactos", async () => {
    const { data } = await aViewer.client.from("contacts").select("id").eq("id", contactA);
    expect(data).toHaveLength(1);

    const { error } = await aViewer.client
      .from("contacts")
      .insert({ organization_id: orgA, display_name: "No debería" });
    expect(error).not.toBeNull();
  });

  it("el operador crea contactos pero no los borra", async () => {
    const { data, error } = await aOperatorSector.client
      .from("contacts")
      .insert({ organization_id: orgA, display_name: "Creado por operador" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();

    await aOperatorSector.client.from("contacts").delete().eq("id", data?.id ?? "");
    const { data: still } = await admin.from("contacts").select("id").eq("id", data?.id ?? "");
    expect(still).toHaveLength(1);
  });

  it("el operador no puede cambiar su propio rol", async () => {
    await aOperatorSector.client.from("profiles").update({ role: "superadmin" }).eq("id", aOperatorSector.id);
    const { data } = await admin.from("profiles").select("role").eq("id", aOperatorSector.id).single();
    expect(data?.role).toBe("operator");
  });

  it("solo el superadmin ve la configuración de agentes y la auditoría", async () => {
    await admin.from("audit_log").insert({
      organization_id: orgA,
      action: "prueba",
      entity_type: "contact",
    });

    const { data: asSuper } = await aSuper.client.from("audit_log").select("id");
    expect((asSuper ?? []).length).toBeGreaterThan(0);

    const { data: asOperator } = await aOperatorSector.client.from("audit_log").select("id");
    expect(asOperator ?? []).toHaveLength(0);
  });

  it("nadie escribe mensajes desde el navegador, ni siquiera el superadmin", async () => {
    const { error } = await aSuper.client.from("messages").insert({
      organization_id: orgA,
      conversation_id: conversationA,
      direction: "outbound",
      sender: "operator",
      body: "no debería poder",
    });
    expect(error).not.toBeNull();
  });
});

describe("visibilidad de casos por sector", () => {
  it("el operador del sector ve el caso", async () => {
    const { data } = await aOperatorSector.client.from("cases").select("id").eq("id", caseA);
    expect(data).toHaveLength(1);
  });

  it("el operador de otro sector no ve el caso", async () => {
    const { data } = await aOperatorOther.client.from("cases").select("id").eq("id", caseA);
    expect(data ?? []).toHaveLength(0);
  });

  it("el superadmin y consulta y reportes ven todos los casos", async () => {
    const { data: asSuper } = await aSuper.client.from("cases").select("id").eq("id", caseA);
    const { data: asViewer } = await aViewer.client.from("cases").select("id").eq("id", caseA);
    expect(asSuper).toHaveLength(1);
    expect(asViewer).toHaveLength(1);
  });

  it("el operador de otro sector tampoco ve las notas internas del caso", async () => {
    await admin.from("internal_notes").insert({
      organization_id: orgA,
      case_id: caseA,
      body: "nota interna",
    });

    const { data } = await aOperatorOther.client.from("internal_notes").select("id").eq("case_id", caseA);
    expect(data ?? []).toHaveLength(0);

    const { data: visible } = await aOperatorSector.client.from("internal_notes").select("id").eq("case_id", caseA);
    expect(visible).toHaveLength(1);
  });
});
