import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { respondToMessage } from "../src/lib/agent/attention";
import { buildHistory, buildSystemPrompt, describeMessage, type HistoryRow, type InlineMedia } from "../src/lib/agent/context";
import { loadHistoryRows, loadInlineMedia, MAX_INLINE_MEDIA_BYTES, MAX_INLINE_MEDIA_COUNT } from "../src/lib/agent/load";
import { toSdkMessages } from "../src/lib/ai/anthropic-client";
import { createScriptedClient } from "../src/lib/ai/scripted-client";
import { createScriptedTranscriber } from "../src/lib/ai/transcription";
import { buildAttentionSettings, syncAttentionConfig } from "../src/lib/client-config/attention";
import { parseClientConfig, syncSectorsAndUnits } from "../src/lib/client-config/load";
import { transcribeAudioMessage } from "../src/lib/inbound/transcribe";
import { adminClient, randomId } from "./helpers/supabase-test";

// Imágenes, PDF y audios en la atención. Todo con datos y archivos inventados; modelo y transcriptor simulados.

const parsed = parseClientConfig(readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8"));
if (!parsed.ok) throw new Error(parsed.errors.join("; "));

const row = (overrides: Partial<HistoryRow>): HistoryRow => ({ direction: "inbound", type: "text", body: null, transcription: null, ...overrides });

const png: InlineMedia = { type: "image", mediaType: "image/png", data: "AAAA" };
const pdf: InlineMedia = { type: "document", mediaType: "application/pdf", data: "BBBB" };

describe("historial con adjuntos", () => {
  it("el mensaje con una imagen en línea lleva el texto y la imagen", () => {
    const history = buildHistory([row({ id: "m1", type: "image", body: "mi comprobante" })], new Map([["m1", png]]));
    expect(history).toEqual([{ role: "user", content: [{ type: "text", text: "mi comprobante" }, png] }]);
  });

  it("sin pie de foto el texto describe el adjunto", () => {
    const history = buildHistory([row({ id: "m1", type: "document" })], new Map([["m1", pdf]]));
    expect(history).toEqual([{ role: "user", content: [{ type: "text", text: "[El asociado envió un documento]" }, pdf] }]);
  });

  it("los mensajes seguidos del asociado se juntan, con todos sus adjuntos", () => {
    const history = buildHistory(
      [row({ id: "m1", type: "text", body: "hola" }), row({ id: "m2", type: "image", body: "foto 1" }), row({ id: "m3", type: "document", body: "pdf 1" })],
      new Map<string, InlineMedia>([["m2", png], ["m3", pdf]]),
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual({ role: "user", content: [{ type: "text", text: "hola\nfoto 1\npdf 1" }, png, pdf] });
  });

  it("un adjunto guardado pero que ya no se muestra se menciona, sin enviarlo", () => {
    expect(describeMessage(row({ type: "image", hasFile: true }))).toBe("[El asociado envió una imagen antes; ya no se muestra]");
    expect(describeMessage(row({ type: "document", hasFile: true, body: "contrato" }))).toBe("[Documento enviado antes, ya no se muestra] contrato");
    const history = buildHistory([row({ id: "m1", type: "image", hasFile: true })]);
    expect(history).toEqual([{ role: "user", content: "[El asociado envió una imagen antes; ya no se muestra]" }]);
  });

  it("un adjunto que nunca se descargó le pide al agente que le pida al asociado que lo escriba", () => {
    expect(describeMessage(row({ type: "image" }))).toContain("pedile con amabilidad que lo escriba");
    expect(describeMessage(row({ type: "audio" }))).toContain("no se pudo transcribir");
  });

  it("un audio transcripto llega como texto con su marca", () => {
    expect(describeMessage(row({ type: "audio", transcription: "quiero un préstamo" }))).toBe("[Audio transcripto] quiero un préstamo");
    expect(buildHistory([row({ type: "audio", transcription: "hola" })])).toEqual([{ role: "user", content: "[Audio transcripto] hola" }]);
  });

  it("las instrucciones explican cómo tratar los adjuntos", () => {
    const prompt = buildSystemPrompt("Hola", buildAttentionSettings(parsed.config, {}), new Date("2026-10-26T15:00:00Z"));
    expect(prompt).toContain("## Adjuntos");
    expect(prompt).toContain("[Audio transcripto]");
  });
});

describe("formato del proveedor", () => {
  it("las imágenes y los PDF van como bloques base64 y el resto queda igual", () => {
    const sdk = toSdkMessages([
      { role: "user", content: "texto simple" },
      { role: "assistant", content: [{ type: "text", text: "respuesta" }] },
      { role: "user", content: [{ type: "text", text: "mirá" }, png, pdf] },
    ]);
    expect(sdk[0]).toEqual({ role: "user", content: "texto simple" });
    expect(sdk[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "respuesta" }] });
    expect(sdk[2]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "mirá" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBBB" } },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Integración contra jarvis-dev (con archivos reales en el almacenamiento)
// ---------------------------------------------------------------------------

const admin = adminClient();
const runId = randomId();
const tokenVar = `CHANNEL_TOKEN_ZZTEST_${runId.toUpperCase()}`;
const uploaded: string[] = [];
let organizationId = "";
let channelId = "";
let counter = 1500;
let seed = 0;
let clock = Date.now() - 30 * 60 * 1000;
const monday = new Date("2026-10-26T15:00:00Z");

function tick(): Date {
  clock += 2000;
  return new Date(clock);
}

function fakeTelegram() {
  return async () => {
    counter += 1;
    return new Response(JSON.stringify({ ok: true, result: { message_id: counter, date: Math.floor(tick().getTime() / 1000) } }), { status: 200 });
  };
}

type FileSpec = { mime: string; bytes: Buffer; sizeBytes?: number | null; extension: string };

// Un mensaje del asociado, con su archivo en el almacenamiento y registrado en media_files.
async function ingestWithFile(identifier: string, type: "image" | "document" | "audio", body: string, file: FileSpec | null) {
  seed += 1;
  const externalId = `${identifier}:${seed}`;
  const { error } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: organizationId,
    p_channel_id: channelId,
    p_channel_type: "telegram",
    p_identifier: identifier,
    p_contact_name: "Ana Prueba",
    p_external_id: externalId,
    p_type: type,
    p_body: body,
    p_provider_timestamp: tick().toISOString(),
    p_raw: {},
  });
  if (error) throw new Error(`No se pudo ingresar el mensaje: ${error.message}`);
  const { data: message } = await admin.from("messages").select("id, conversation_id").eq("external_id", externalId).single();
  const messageId = message?.id ?? "";
  const conversationId = message?.conversation_id ?? "";

  if (file) {
    const path = `${organizationId}/${conversationId}/${messageId}.${file.extension}`;
    const { error: uploadError } = await admin.storage.from("media").upload(path, file.bytes, { contentType: file.mime, upsert: true });
    if (uploadError) throw new Error(`No se pudo subir el archivo: ${uploadError.message}`);
    uploaded.push(path);
    const { error: insertError } = await admin.from("media_files").insert({
      organization_id: organizationId,
      message_id: messageId,
      storage_path: path,
      mime_type: file.mime,
      size_bytes: file.sizeBytes === undefined ? file.bytes.length : file.sizeBytes,
    });
    if (insertError) throw new Error(`No se pudo registrar el archivo: ${insertError.message}`);
  }

  return { messageId, conversationId };
}

const bytesOf = (text: string) => Buffer.from(text, "utf8");
const png1 = (label: string): FileSpec => ({ mime: "image/png", bytes: bytesOf(`png-${label}`), extension: "png" });

beforeAll(async () => {
  process.env[tokenVar] = "123456:token-de-prueba";

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-media`, name: "Prueba Adjuntos" })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  organizationId = org.id;

  const { data: channel } = await admin
    .from("channels")
    .insert({ organization_id: organizationId, type: "telegram", name: "Canal de prueba", external_id: `zz-test-${runId}-tg`, secret_ref: tokenVar })
    .select("id")
    .single();
  channelId = channel?.id ?? "";

  await syncSectorsAndUnits(admin, organizationId, parsed.config);
  await syncAttentionConfig(admin, organizationId, parsed.config, { prompt: "Sos {{nombre_agente}}.", knowledge: {} });
  await admin.from("agents").insert({ organization_id: organizationId, kind: "attention", name: "Sofía", is_enabled: true });
});

afterAll(async () => {
  delete process.env[tokenVar];
  if (uploaded.length > 0) await admin.storage.from("media").remove(uploaded);
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("adjuntos que ve el agente", () => {
  it("baja solo los más recientes que el modelo puede leer y de tamaño razonable", async () => {
    const identifier = `4${Date.now().toString().slice(-8)}`;
    const old = await ingestWithFile(identifier, "image", "la más vieja", png1("vieja"));
    const gif = await ingestWithFile(identifier, "image", "gif", { mime: "image/gif", bytes: bytesOf("gif-1"), extension: "gif" });
    const heavy = await ingestWithFile(identifier, "image", "pesada", { ...png1("pesada"), sizeBytes: MAX_INLINE_MEDIA_BYTES + 1 });
    const text = await ingestWithFile(identifier, "document", "un zip", { mime: "application/zip", bytes: bytesOf("zip"), extension: "zip" });
    const pdfMsg = await ingestWithFile(identifier, "document", "el pdf", { mime: "application/pdf", bytes: bytesOf("pdf-1"), extension: "pdf" });
    const newest = await ingestWithFile(identifier, "image", "la más nueva", png1("nueva"));

    const rows = await loadHistoryRows(admin, newest.conversationId);
    expect(rows?.map((item) => item.hasFile)).toEqual([true, true, true, true, true, true]);

    const media = await loadInlineMedia(admin, rows ?? []);
    // Tres como máximo: la nueva, el PDF y el GIF. La pesada y el zip se saltean; la más vieja ya no entra.
    expect(media.size).toBe(MAX_INLINE_MEDIA_COUNT);
    expect(media.get(newest.messageId)).toEqual({ type: "image", mediaType: "image/png", data: bytesOf("png-nueva").toString("base64") });
    expect(media.get(pdfMsg.messageId)).toEqual({ type: "document", mediaType: "application/pdf", data: bytesOf("pdf-1").toString("base64") });
    expect(media.get(gif.messageId)).toMatchObject({ type: "image", mediaType: "image/gif" });
    for (const skipped of [old.messageId, heavy.messageId, text.messageId]) expect(media.has(skipped)).toBe(false);
  });

  it("un archivo que falta en el almacenamiento se omite sin cortar el turno", async () => {
    const identifier = `5${Date.now().toString().slice(-8)}`;
    const { messageId, conversationId } = await ingestWithFile(identifier, "image", "foto", png1("x"));
    await admin.storage.from("media").remove([`${organizationId}/${conversationId}/${messageId}.png`]);

    const rows = await loadHistoryRows(admin, conversationId);
    expect((await loadInlineMedia(admin, rows ?? [])).size).toBe(0);
  });

  it("solo se muestran los adjuntos del asociado, no los que mandó el agente", async () => {
    const identifier = `6${Date.now().toString().slice(-8)}`;
    const { conversationId } = await ingestWithFile(identifier, "image", "foto", png1("y"));
    await admin.from("messages").update({ direction: "outbound", sender: "operator" }).eq("conversation_id", conversationId);

    const rows = await loadHistoryRows(admin, conversationId);
    expect((await loadInlineMedia(admin, rows ?? [])).size).toBe(0);
  });

  it("el agente recibe la imagen en su pedido al modelo", async () => {
    const identifier = `7${Date.now().toString().slice(-8)}`;
    const { messageId, conversationId } = await ingestWithFile(identifier, "image", "mi factura", png1("factura"));

    const client = createScriptedClient([{ content: [{ type: "text", text: "Veo tu factura, ¿qué necesitás?" }] }]);
    const result = await respondToMessage(admin, client, { conversationId, messageId, now: monday, fetchImpl: fakeTelegram() });
    expect(result).toMatchObject({ status: "replied" });

    const last = client.requests[0]?.messages.at(-1);
    expect(last?.role).toBe("user");
    expect(last?.content).toEqual([
      { type: "text", text: "mi factura" },
      { type: "image", mediaType: "image/png", data: bytesOf("png-factura").toString("base64") },
    ]);
  });
});

describe("transcripción de audios", () => {
  const ogg: FileSpec = { mime: "audio/ogg", bytes: bytesOf("audio-1"), extension: "ogg" };

  it("transcribe el audio, guarda el texto con el servicio y no lo repite", async () => {
    const identifier = `8${Date.now().toString().slice(-8)}`;
    const { messageId } = await ingestWithFile(identifier, "audio", "", ogg);
    const transcriber = createScriptedTranscriber(["hola quiero saber de los préstamos"]);

    expect(await transcribeAudioMessage(admin, transcriber, messageId)).toBe("transcribed");
    expect(transcriber.inputs).toHaveLength(1);
    expect(transcriber.inputs[0]).toMatchObject({ mimeType: "audio/ogg", language: "es" });
    expect(Buffer.from(transcriber.inputs[0]?.bytes ?? []).toString("utf8")).toBe("audio-1");

    const { data } = await admin.from("messages").select("transcription, transcription_provider").eq("id", messageId).single();
    expect(data).toEqual({ transcription: "hola quiero saber de los préstamos", transcription_provider: "simulado" });

    // Un reproceso no vuelve a gastar.
    expect(await transcribeAudioMessage(admin, transcriber, messageId)).toBe("already-done");
    expect(transcriber.inputs).toHaveLength(1);
  });

  it("el agente entiende el audio transcripto como si fuera texto", async () => {
    const identifier = `9${Date.now().toString().slice(-8)}`;
    const { messageId, conversationId } = await ingestWithFile(identifier, "audio", "", ogg);
    await transcribeAudioMessage(admin, createScriptedTranscriber(["necesito un préstamo de quinientos mil"]), messageId);

    const client = createScriptedClient([{ content: [{ type: "text", text: "Dale, te ayudo con el préstamo." }] }]);
    await respondToMessage(admin, client, { conversationId, messageId, now: monday, fetchImpl: fakeTelegram() });
    expect(client.requests[0]?.messages.at(-1)).toEqual({ role: "user", content: "[Audio transcripto] necesito un préstamo de quinientos mil" });
  });

  it("un audio sin voz no guarda texto vacío", async () => {
    const identifier = `1${Date.now().toString().slice(-8)}`;
    const { messageId } = await ingestWithFile(identifier, "audio", "", ogg);
    expect(await transcribeAudioMessage(admin, createScriptedTranscriber(["   "]), messageId)).toBe("empty");

    const { data } = await admin.from("messages").select("transcription").eq("id", messageId).single();
    expect(data?.transcription).toBeNull();
  });

  it("no transcribe lo que no es un audio, lo que no tiene archivo ni lo demasiado pesado", async () => {
    const identifier = `2${Date.now().toString().slice(-8)}`;
    const transcriber = createScriptedTranscriber(["no debería usarse"]);

    const image = await ingestWithFile(identifier, "image", "foto", png1("z"));
    expect(await transcribeAudioMessage(admin, transcriber, image.messageId)).toBe("no-audio");

    const noFile = await ingestWithFile(identifier, "audio", "", null);
    expect(await transcribeAudioMessage(admin, transcriber, noFile.messageId)).toBe("no-audio");

    const heavy = await ingestWithFile(identifier, "audio", "", { ...ogg, sizeBytes: 25 * 1024 * 1024 });
    expect(await transcribeAudioMessage(admin, transcriber, heavy.messageId)).toBe("too-large");

    expect(transcriber.inputs).toHaveLength(0);
  });

  it("un error del servicio se propaga y no deja nada a medias", async () => {
    const identifier = `3${Date.now().toString().slice(-8)}`;
    const { messageId } = await ingestWithFile(identifier, "audio", "", ogg);
    // Sin textos armados, el transcriptor simulado falla.
    await expect(transcribeAudioMessage(admin, createScriptedTranscriber([]), messageId)).rejects.toThrow("se quedó sin textos");

    const { data } = await admin.from("messages").select("transcription").eq("id", messageId).single();
    expect(data?.transcription).toBeNull();
  });
});
