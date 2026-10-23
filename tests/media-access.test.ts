import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// El CRM muestra los adjuntos con URL firmadas pedidas con la sesión del usuario: la política de
// Storage tiene que dejar firmar solo los archivos de su propia organización.

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let path = "";
let aOperator: TestUser;
let bOperator: TestUser;

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-media-${label}`, name: `Prueba Media ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";

  aOperator = await createTestUser(admin, { organizationId: orgIds[0] ?? "", role: "operator", label: "media-a", runId });
  bOperator = await createTestUser(admin, { organizationId: orgIds[1] ?? "", role: "operator", label: "media-b", runId });
  userIds.push(aOperator.id, bOperator.id);

  path = `${orgA}/conversacion-de-prueba/archivo.txt`;
  const { error } = await admin.storage.from("media").upload(path, Buffer.from("contenido de prueba"), { contentType: "text/plain" });
  if (error) throw new Error(`No se pudo subir el archivo de prueba: ${error.message}`);
});

afterAll(async () => {
  await admin.storage.from("media").remove([path]);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("acceso a adjuntos del CRM", () => {
  it("un usuario de la organización puede firmar la URL de su archivo", async () => {
    const { data, error } = await aOperator.client.storage.from("media").createSignedUrls([path], 60);
    expect(error).toBeNull();
    expect(data?.[0]?.signedUrl).toContain("token=");
    expect(data?.[0]?.error).toBeFalsy();
  });

  it("un usuario de otra organización no puede firmar esa URL", async () => {
    const { data } = await bOperator.client.storage.from("media").createSignedUrls([path], 60);
    expect(data?.[0]?.signedUrl ?? null).toBeNull();
    expect(data?.[0]?.error).toBeTruthy();
  });
});
