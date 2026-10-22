import { describe, expect, it } from "vitest";

import { extractEvents } from "../src/lib/whatsapp/events";

const PHONE_NUMBER_ID = "100000000000001";

function envelope(value: Record<string, unknown>, field = "messages") {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "200000000000002", changes: [{ field, value }] }],
  };
}

const metadata = { display_phone_number: "15550000000", phone_number_id: PHONE_NUMBER_ID };

describe("extracción de eventos de WhatsApp", () => {
  it("separa un mensaje entrante y le asocia su contacto", () => {
    const events = extractEvents(
      envelope({
        messaging_product: "whatsapp",
        metadata,
        contacts: [{ profile: { name: "Ana Prueba" }, wa_id: "5490000000001" }],
        messages: [
          { from: "5490000000001", id: "wamid.AAA", timestamp: "1700000000", type: "text", text: { body: "hola" } },
        ],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "message",
      phoneNumberId: PHONE_NUMBER_ID,
      dedupeKey: "msg:wamid.AAA",
    });
    expect(JSON.stringify(events[0]?.payload)).toContain("Ana Prueba");
  });

  it("separa los estados y los distingue por estado", () => {
    const events = extractEvents(
      envelope({
        metadata,
        statuses: [
          { id: "wamid.BBB", status: "sent", timestamp: "1700000001", recipient_id: "5490000000001" },
          { id: "wamid.BBB", status: "delivered", timestamp: "1700000002", recipient_id: "5490000000001" },
        ],
      }),
    );

    expect(events.map((event) => event.dedupeKey)).toEqual([
      "status:wamid.BBB:sent",
      "status:wamid.BBB:delivered",
    ]);
  });

  it("procesa varios mensajes en un mismo envío", () => {
    const events = extractEvents(
      envelope({
        metadata,
        messages: [
          { from: "1", id: "wamid.1", timestamp: "1", type: "text", text: { body: "a" } },
          { from: "1", id: "wamid.2", timestamp: "2", type: "audio", audio: { id: "media-1" } },
        ],
      }),
    );
    expect(events.map((event) => event.dedupeKey)).toEqual(["msg:wamid.1", "msg:wamid.2"]);
  });

  it("ignora otros campos, objetos ajenos y datos incompletos sin fallar", () => {
    expect(extractEvents(null)).toEqual([]);
    expect(extractEvents("texto")).toEqual([]);
    expect(extractEvents({ object: "page", entry: [] })).toEqual([]);
    expect(extractEvents(envelope({ metadata }, "account_update"))).toEqual([]);
    expect(extractEvents(envelope({ messages: [{ id: "wamid.X" }] }))).toEqual([]);
    expect(extractEvents(envelope({ metadata, messages: [{ from: "1" }] }))).toEqual([]);
    expect(extractEvents(envelope({ metadata, statuses: [{ id: "wamid.Y" }] }))).toEqual([]);
  });
});
