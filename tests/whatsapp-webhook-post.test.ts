import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, randomId } from "./helpers/supabase-test";

// Prueba de integración del POST del webhook contra el proyecto de desarrollo. Crea su propia
// organización y canal con el prefijo "zz-test-" y los borra al terminar.

const SECRET = "secreto-de-prueba-del-webhook";
const admin = adminClient();
const runId = randomId();
const phoneNumberId = `zz-test-${runId}`;
const unknownPhoneNumberId = `zz-test-${runId}-desconocido`;

let organizationId = "";
let POST: (request: NextRequest) => Promise<Response>;

function payload(messageId: string, number = phoneNumberId) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: number },
              contacts: [{ profile: { name: "Ana Prueba" }, wa_id: "5490000000001" }],
              messages: [
                { from: "5490000000001", id: messageId, timestamp: "1700000000", type: "text", text: { body: "hola" } },
              ],
            },
          },
        ],
      },
    ],
  });
}

function request(body: string, signature?: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  const value = signature === undefined ? `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}` : signature;
  if (value !== null) headers.set("x-hub-signature-256", value);
  return new NextRequest("http://localhost/api/webhooks/whatsapp", { method: "POST", body, headers });
}

async function countEvents(dedupeKey: string): Promise<number> {
  const { data } = await admin.from("webhook_events").select("id").eq("dedupe_key", dedupeKey);
  return data?.length ?? 0;
}

beforeAll(async () => {
  process.env.META_APP_SECRET = SECRET;
  ({ POST } = await import("../src/app/api/webhooks/whatsapp/route"));

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}`, name: "Prueba Webhook" })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  organizationId = org.id;

  const { error: channelError } = await admin
    .from("channels")
    .insert({ organization_id: organizationId, type: "whatsapp", name: "Canal de prueba", external_id: phoneNumberId });
  if (channelError) throw new Error(`No se pudo crear el canal: ${channelError.message}`);
});

afterAll(async () => {
  await admin.from("webhook_events").delete().like("dedupe_key", `msg:wamid.zz-test-${runId}%`);
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("POST /api/webhooks/whatsapp", () => {
  it("guarda un mensaje firmado y lo asocia a la organización del canal", async () => {
    const id = `wamid.zz-test-${runId}-ok`;
    const response = await POST(request(payload(id)));
    expect(response.status).toBe(200);

    const { data } = await admin
      .from("webhook_events")
      .select("organization_id, processed_at, error")
      .eq("dedupe_key", `msg:${id}`)
      .single();
    expect(data?.organization_id).toBe(organizationId);
    expect(data?.processed_at).toBeNull();
    expect(data?.error).toBeNull();
  });

  it("no duplica el evento si Meta lo reenvía", async () => {
    const id = `wamid.zz-test-${runId}-duplicado`;
    const body = payload(id);
    expect((await POST(request(body))).status).toBe(200);
    expect((await POST(request(body))).status).toBe(200);
    expect((await POST(request(body))).status).toBe(200);
    expect(await countEvents(`msg:${id}`)).toBe(1);
  });

  it("rechaza una firma inválida y no guarda nada", async () => {
    const id = `wamid.zz-test-${runId}-firma-mala`;
    const response = await POST(request(payload(id), "sha256=" + "0".repeat(64)));
    expect(response.status).toBe(401);
    expect(await countEvents(`msg:${id}`)).toBe(0);
  });

  it("rechaza si falta la firma", async () => {
    const id = `wamid.zz-test-${runId}-sin-firma`;
    const response = await POST(request(payload(id), null));
    expect(response.status).toBe(401);
    expect(await countEvents(`msg:${id}`)).toBe(0);
  });

  it("rechaza un cuerpo que no es JSON aunque esté bien firmado", async () => {
    const response = await POST(request("esto no es json"));
    expect(response.status).toBe(400);
  });

  it("guarda pero marca como procesado un número sin canal registrado", async () => {
    const id = `wamid.zz-test-${runId}-desconocido`;
    const response = await POST(request(payload(id, unknownPhoneNumberId)));
    expect(response.status).toBe(200);

    const { data } = await admin
      .from("webhook_events")
      .select("organization_id, processed_at, error")
      .eq("dedupe_key", `msg:${id}`)
      .single();
    expect(data?.organization_id).toBeNull();
    expect(data?.processed_at).not.toBeNull();
    expect(data?.error).toContain("Canal no registrado");
  });
});
