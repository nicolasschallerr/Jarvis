import { describe, expect, it } from "vitest";

import { extractBody, mapMessageType, parseProviderTimestamp } from "../src/lib/inbound/whatsapp";
import { isAuthorizedWorkerRequest } from "../src/lib/worker-auth";

describe("mapeo de mensajes de WhatsApp", () => {
  it("reconoce los tipos conocidos y marca el resto como no soportado", () => {
    expect(mapMessageType("text")).toBe("text");
    expect(mapMessageType("audio")).toBe("audio");
    expect(mapMessageType("document")).toBe("document");
    expect(mapMessageType("order")).toBe("unsupported");
    expect(mapMessageType(null)).toBe("unsupported");
  });

  it("extrae el texto según el tipo", () => {
    expect(extractBody({ type: "text", text: { body: "hola" } })).toBe("hola");
    expect(extractBody({ type: "image", image: { id: "1", caption: "mi DNI" } })).toBe("mi DNI");
    expect(extractBody({ type: "image", image: { id: "1" } })).toBeNull();
    expect(extractBody({ type: "audio", audio: { id: "1" } })).toBeNull();
    expect(
      extractBody({ type: "interactive", interactive: { button_reply: { id: "a", title: "Sí" } } }),
    ).toBe("Sí");
    expect(
      extractBody({ type: "interactive", interactive: { list_reply: { id: "b", title: "Turismo" } } }),
    ).toBe("Turismo");
    expect(extractBody({ type: "interactive", button_reply: { id: "a", title: "Sí" } })).toBeNull();
    expect(extractBody({ type: "reaction", reaction: { emoji: "👍" } })).toBe("👍");
    expect(extractBody({})).toBeNull();
  });

  it("convierte la hora del proveedor (segundos) y tiene un respaldo", () => {
    const fallback = new Date("2026-01-01T00:00:00.000Z");
    expect(parseProviderTimestamp("1700000000", fallback)).toBe("2023-11-14T22:13:20.000Z");
    expect(parseProviderTimestamp(1700000000, fallback)).toBe("2023-11-14T22:13:20.000Z");
    expect(parseProviderTimestamp("no es un número", fallback)).toBe(fallback.toISOString());
    expect(parseProviderTimestamp(undefined, fallback)).toBe(fallback.toISOString());
  });
});

describe("autorización del trabajador", () => {
  it("acepta solo el secreto correcto con el prefijo Bearer", () => {
    expect(isAuthorizedWorkerRequest("Bearer secreto-123", "secreto-123")).toBe(true);
    expect(isAuthorizedWorkerRequest("Bearer otro", "secreto-123")).toBe(false);
    expect(isAuthorizedWorkerRequest("secreto-123", "secreto-123")).toBe(false);
    expect(isAuthorizedWorkerRequest(null, "secreto-123")).toBe(false);
  });

  it("falla cerrado si el servidor no tiene secreto", () => {
    expect(isAuthorizedWorkerRequest("Bearer algo", undefined)).toBe(false);
    expect(isAuthorizedWorkerRequest("Bearer ", "")).toBe(false);
  });
});
