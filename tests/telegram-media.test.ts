import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { storeTelegramMedia, TELEGRAM_MAX_DOWNLOAD_BYTES } from "../src/lib/inbound/media";
import { extractTelegramMedia } from "../src/lib/inbound/telegram";
import { adminClient, randomId } from "./helpers/supabase-test";

describe("adjuntos de Telegram: extracción", () => {
  it("de una foto elige el tamaño más grande", () => {
    const media = extractTelegramMedia({
      photo: [
        { file_id: "chica", width: 90, height: 60 },
        { file_id: "grande", width: 1280, height: 960, file_size: 1234 },
        { file_id: "media", width: 320, height: 240 },
      ],
    });
    expect(media).toEqual({ providerMediaId: "grande", mimeType: "image/jpeg", fileName: null, sizeBytes: 1234 });
  });

  it("de un audio de voz toma tipo y tamaño", () => {
    const media = extractTelegramMedia({ voice: { file_id: "v1", mime_type: "audio/ogg", file_size: 5000, duration: 3 } });
    expect(media).toEqual({ providerMediaId: "v1", mimeType: "audio/ogg", fileName: null, sizeBytes: 5000 });
  });

  it("de un documento conserva el nombre", () => {
    const media = extractTelegramMedia({ document: { file_id: "d1", file_name: "recibo.pdf", mime_type: "application/pdf" } });
    expect(media?.fileName).toBe("recibo.pdf");
  });

  it("un texto o un sticker no tienen adjunto descargable", () => {
    expect(extractTelegramMedia({ text: "hola" })).toBeNull();
    expect(extractTelegramMedia({ sticker: { file_id: "s1" } })).toBeNull();
  });
});

describe("adjuntos de Telegram: descarga y guardado", () => {
  const admin = adminClient();
  const runId = randomId();
  let organizationId = "";
  let conversationId = "";
  let messageId = "";

  // Telegram falso: getFile devuelve una ruta y la descarga devuelve bytes fijos.
  const calls: string[] = [];
  const bytes = Buffer.from("audio-de-prueba");
  const fakeFetch = async (url: string) => {
    calls.push(url);
    if (url.endsWith("/getFile")) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: "voice/file_1.oga", file_size: bytes.length } }));
    }
    return new Response(bytes, { headers: { "content-type": "audio/ogg" } });
  };

  beforeAll(async () => {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-media`, name: "Prueba Media" })
      .select("id")
      .single();
    if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    organizationId = org.id;

    const { data: channel } = await admin
      .from("channels")
      .insert({ organization_id: organizationId, type: "telegram", name: "Bot", external_id: `zz-test-${runId}` })
      .select("id")
      .single();
    if (!channel) throw new Error("No se creó el canal");

    const { error: ingestError } = await admin.rpc("ingest_inbound_message", {
      p_organization_id: organizationId,
      p_channel_id: channel.id,
      p_channel_type: "telegram",
      p_identifier: `3${Date.now().toString().slice(-8)}`,
      p_contact_name: "Ana Prueba",
      p_external_id: "1:1",
      p_type: "audio",
      p_body: "",
      p_provider_timestamp: new Date().toISOString(),
      p_raw: {},
    });
    if (ingestError) throw new Error(ingestError.message);

    const { data: message } = await admin.from("messages").select("id, conversation_id").eq("organization_id", organizationId).single();
    if (!message) throw new Error("No se creó el mensaje");
    messageId = message.id;
    conversationId = message.conversation_id;
  });

  afterAll(async () => {
    await admin.storage.from("media").remove([`${organizationId}/${conversationId}/${messageId}.ogg`]);
    await admin.from("organizations").delete().eq("id", organizationId);
  });

  const media = { providerMediaId: "v1", mimeType: "audio/ogg", fileName: null, sizeBytes: bytes.length };
  const params = () => ({ organizationId, conversationId, messageId, token: "123:token-de-prueba", media, fetchImpl: fakeFetch });

  it("descarga, guarda en el bucket privado y registra tipo, tamaño y huella", async () => {
    expect(await storeTelegramMedia(admin, params())).toBe("stored");

    const { data: file } = await admin.from("media_files").select("storage_path, mime_type, size_bytes, sha256").eq("message_id", messageId).single();
    expect(file?.storage_path).toBe(`${organizationId}/${conversationId}/${messageId}.ogg`);
    expect(file).toMatchObject({ mime_type: "audio/ogg", size_bytes: bytes.length });
    expect(file?.sha256).toHaveLength(64);

    const { data: stored } = await admin.storage.from("media").download(file?.storage_path ?? "");
    expect(Buffer.from(await (stored as Blob).arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("es idempotente: un segundo intento no descarga ni duplica", async () => {
    const before = calls.length;
    expect(await storeTelegramMedia(admin, params())).toBe("exists");
    expect(calls.length).toBe(before);
  });

  it("no intenta descargar archivos de más de 20 MB", async () => {
    const before = calls.length;
    const result = await storeTelegramMedia(admin, {
      ...params(),
      messageId: crypto.randomUUID(),
      media: { ...media, sizeBytes: TELEGRAM_MAX_DOWNLOAD_BYTES + 1 },
    });
    expect(result).toBe("too-large");
    expect(calls.length).toBe(before);
  });

  it("si getFile falla, lanza un error sin filtrar el token", async () => {
    const failing = async () => new Response(JSON.stringify({ ok: false, description: "Bad Request: file is too big" }), { status: 400 });
    const error = await storeTelegramMedia(admin, { ...params(), messageId: crypto.randomUUID(), fetchImpl: failing }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("file is too big");
    expect((error as Error).message).not.toContain("token-de-prueba");
  });
});
