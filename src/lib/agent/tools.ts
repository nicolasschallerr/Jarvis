import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/lib/supabase/database.types";

import type { AttentionSettings } from "./context";
import type { AgentTool } from "./loop";

export type FieldDefinition = AttentionSettings["fields"][number];

export type ToolContext = {
  unitSlugs: string[];
  sectorSlugs: string[];
  fields: FieldDefinition[];
  // Intentos fallidos por dato antes de pasar a una persona.
  maxFieldRetries: number;
};

// Lo que hay guardado del caso abierto y del asociado.
export type CaseSnapshot = {
  unit: string | null;
  data: Record<string, unknown>;
  contact: { name: string | null; document: string | null; locality: string | null };
  // Canal de la conversación e identificador del contacto en él (por WhatsApp, su teléfono). Es opcional
  // para que un estado viejo o simulado sin canal siga siendo válido.
  channel?: { type: string | null; identifier: string | null };
};

// Dónde se guardan los efectos de las herramientas. En producción es la base (funciones que fijan el
// actor "agente"); en los evals es una memoria que solo anota qué se pidió. Las operaciones que pueden
// fallar devuelven null si salieron bien o el motivo del error; las demás lanzan.
export type CaseBackend = {
  saveCaseData(input: { unit: string; title: string; data: Record<string, string | number | boolean> }): Promise<string | null>;
  saveContactData(input: { name?: string; document?: string; locality?: string }): Promise<string | null>;
  // Anota un intento (válido o no) de un dato y devuelve cuántos fallidos seguidos lleva.
  recordFieldAttempt(field: string, ok: boolean): Promise<number>;
  snapshot(): Promise<CaseSnapshot>;
  handoff(input: { sector: string; summary: string; priority: "low" | "normal" | "high" | "urgent" }): Promise<string | null>;
  askArea(input: { sector: string; question: string }): Promise<string | null>;
};

// Backend de producción: llama a las funciones de la base de la conversación indicada.
export function createSupabaseBackend(admin: SupabaseClient<Database>, conversationId: string): CaseBackend {
  return {
    async saveCaseData(input) {
      const { error } = await admin.rpc("agent_save_case_data", {
        p_conversation_id: conversationId,
        p_unit_slug: input.unit,
        p_title: input.title,
        p_data: input.data as Json,
      });
      return error?.message ?? null;
    },
    async saveContactData(input) {
      const { error } = await admin.rpc("agent_save_contact_data", {
        p_conversation_id: conversationId,
        p_display_name: input.name ?? "",
        p_document_number: input.document ?? "",
        p_locality: input.locality ?? "",
      });
      return error?.message ?? null;
    },
    async recordFieldAttempt(field, ok) {
      const { data, error } = await admin.rpc("agent_record_field_attempt", {
        p_conversation_id: conversationId,
        p_field: field,
        p_ok: ok,
      });
      if (error) throw new Error(error.message);
      return data ?? 0;
    },
    async snapshot() {
      const { data, error } = await admin.rpc("agent_case_snapshot", { p_conversation_id: conversationId });
      if (error) throw new Error(error.message);
      return data as unknown as CaseSnapshot;
    },
    async handoff(input) {
      const { error } = await admin.rpc("agent_handoff_case", {
        p_conversation_id: conversationId,
        p_sector_slug: input.sector,
        p_summary: input.summary,
        p_priority: input.priority,
      });
      return error?.message ?? null;
    },
    async askArea(input) {
      const { error } = await admin.rpc("agent_ask_area", {
        p_conversation_id: conversationId,
        p_sector_slug: input.sector,
        p_question: input.question,
      });
      return error?.message ?? null;
    },
  };
}

const saveSchema = z.object({
  unidad: z.string().optional(),
  titulo: z.string().trim().max(120).optional(),
  datos: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

const handoffSchema = z.object({
  sector: z.string().min(1),
  resumen: z.string().trim().min(1).max(1500),
  prioridad: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  datos_incompletos_ok: z.boolean().default(false),
});

const askSchema = z.object({
  sector: z.string().min(1),
  pregunta: z.string().trim().min(1).max(1000),
});

function invalid(error: z.ZodError): { output: string; isError: true } {
  return { output: `Datos inválidos: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, isError: true };
}

// Texto que se guarda de un valor: sin espacios de más y, si el dato lo pide, solo con dígitos.
export function cleanValue(field: FieldDefinition, value: string | number | boolean): string {
  const text = String(value).trim();
  return field.clean === "digits" ? text.replace(/\D/g, "") : text;
}

// ¿El valor cumple la regla del dato? Sin regla, cualquier texto no vacío.
export function isValidValue(field: FieldDefinition, cleaned: string): boolean {
  if (cleaned === "") return false;
  if (cleaned.length > 500) return false;
  return field.regex ? new RegExp(field.regex).test(cleaned) : true;
}

// Datos que se piden en una unidad: los de todas las ramas y los propios de esa unidad.
export function fieldsForUnit(fields: FieldDefinition[], unit: string | null): FieldDefinition[] {
  return fields.filter((field) => field.units === null || (unit !== null && field.units.includes(unit)));
}

// El valor que el canal ya conoce para un dato (el teléfono por WhatsApp), o null. Solo cuenta si el dato
// está marcado `desde_canal` en la configuración y el canal es WhatsApp, donde el identificador del chat
// es el número de teléfono.
export function valueFromChannel(field: FieldDefinition, snapshot: CaseSnapshot): string | null {
  if (!field.fromChannel || snapshot.channel?.type !== "whatsapp") return null;
  const digits = (snapshot.channel.identifier ?? "").replace(/\D/g, "");
  return digits === "" ? null : digits;
}

function hasValue(field: FieldDefinition, snapshot: CaseSnapshot): boolean {
  if (valueFromChannel(field, snapshot) !== null) return true;
  if (field.store === "contact_name") return Boolean(snapshot.contact.name);
  if (field.store === "contact_document") return Boolean(snapshot.contact.document);
  if (field.store === "contact_locality") return Boolean(snapshot.contact.locality);
  const value = snapshot.data[field.id];
  return value !== undefined && value !== null && String(value).trim() !== "";
}

// Datos obligatorios que todavía faltan para la unidad del caso, en el orden en que se definieron.
export function missingRequiredFields(fields: FieldDefinition[], snapshot: CaseSnapshot): FieldDefinition[] {
  return fieldsForUnit(fields, snapshot.unit).filter((field) => field.required && !hasValue(field, snapshot));
}

// Herramientas del agente de atención. El modelo nunca toca las tablas: sus pedidos pasan por el
// backend, que valida y registra. Los sectores, unidades y datos válidos salen de la configuración del
// cliente, no están escritos en el código.
export function createAttentionTools(backend: CaseBackend, context: ToolContext): AgentTool[] {
  const fieldIds = context.fields.map((field) => field.id);

  return [
    {
      name: "guardar_datos_del_caso",
      description:
        "Guarda lo que el asociado fue dando y la unidad de negocio identificada. Usala apenas tengas datos, no esperes al final. Cada dato se valida: si alguno es inválido, no se guarda y te digo cómo pedirlo de nuevo. Los datos nuevos se suman a los anteriores.",
      inputSchema: {
        type: "object",
        properties: {
          unidad: { type: "string", enum: context.unitSlugs, description: "Unidad de negocio identificada." },
          titulo: { type: "string", description: "Título corto del caso (ej. 'Solicitud de crédito')." },
          datos: {
            type: "object",
            description: fieldIds.length
              ? `Pares dato → valor. Datos conocidos (usá exactamente estos nombres): ${fieldIds.join(", ")}. Cualquier otro dato libre también se guarda.`
              : "Pares nombre → valor con lo que dijo el asociado.",
          },
        },
        required: ["datos"],
      },
      async run(input) {
        const parsed = saveSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error);

        const caseData: Record<string, string | number | boolean> = {};
        const contact: { name?: string; document?: string; locality?: string } = {};
        const saved: string[] = [];
        const rejected: string[] = [];
        let exhausted: FieldDefinition | null = null;

        for (const [key, value] of Object.entries(parsed.data.datos)) {
          const field = context.fields.find((candidate) => candidate.id === key);

          // Dato libre (no definido en la configuración): se guarda tal cual.
          if (!field) {
            caseData[key] = value;
            continue;
          }

          const cleaned = cleanValue(field, value);
          if (!isValidValue(field, cleaned)) {
            const attempts = await backend.recordFieldAttempt(field.id, false);
            rejected.push(`${field.label}: ${field.help ?? "no tiene un formato válido"} (intento ${attempts} de ${context.maxFieldRetries})`);
            if (attempts >= context.maxFieldRetries && !exhausted) exhausted = field;
            continue;
          }

          await backend.recordFieldAttempt(field.id, true);
          saved.push(field.label);
          if (field.store === "contact_name") contact.name = cleaned;
          else if (field.store === "contact_document") contact.document = cleaned;
          else if (field.store === "contact_locality") contact.locality = cleaned;
          else caseData[field.id] = cleaned;
        }

        if (Object.keys(contact).length > 0) {
          const failure = await backend.saveContactData(contact);
          if (failure) return { output: `No se pudieron guardar los datos del asociado: ${failure}`, isError: true };
        }
        const hasCaseWork = Object.keys(caseData).length > 0 || parsed.data.unidad || parsed.data.titulo;
        if (hasCaseWork) {
          const failure = await backend.saveCaseData({ unit: parsed.data.unidad ?? "", title: parsed.data.titulo ?? "", data: caseData });
          if (failure) return { output: `No se pudo guardar: ${failure}`, isError: true };
        }

        if (rejected.length === 0) return { output: saved.length ? `Datos guardados: ${saved.join(", ")}.` : "Datos guardados." };

        const lines = [
          saved.length ? `Se guardaron: ${saved.join(", ")}.` : "No se guardó ningún dato.",
          `No se guardaron por formato inválido: ${rejected.join("; ")}.`,
        ];
        if (exhausted) {
          lines.push(
            `El asociado ya superó los ${context.maxFieldRetries} intentos con "${exhausted.label}": no sigas pidiéndolo. Derivá a una persona con derivar_a_sector (datos_incompletos_ok: true).`,
          );
        } else {
          lines.push("Explicale cómo escribirlo y pedí solo ese dato de nuevo.");
        }
        return { output: lines.join(" "), isError: true, decision: exhausted ? { action: "field_retries_exceeded", field: exhausted.id } : undefined };
      },
    },
    {
      name: "derivar_a_sector",
      description:
        "Deriva el caso al sector correcto con un resumen para el equipo. Usala cuando ya juntaste todos los datos obligatorios de la unidad, o con datos_incompletos_ok si el tema es sensible, el asociado pide hablar con una persona o superó los intentos con un dato. El sistema le envía al asociado el mensaje oficial de derivación: no lo escribas vos.",
      inputSchema: {
        type: "object",
        properties: {
          sector: { type: "string", enum: context.sectorSlugs },
          resumen: { type: "string", description: "Resumen claro para quien recibe el caso, con los datos juntados." },
          prioridad: { type: "string", enum: ["low", "normal", "high", "urgent"] },
          datos_incompletos_ok: { type: "boolean", description: "true solo en los casos de excepción descritos." },
        },
        required: ["sector", "resumen"],
      },
      async run(input) {
        const parsed = handoffSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error);

        const snapshot = await backend.snapshot();

        // Guardián de datos: sin los obligatorios de la unidad no se deriva, salvo excepción declarada.
        if (!parsed.data.datos_incompletos_ok) {
          const missing = missingRequiredFields(context.fields, snapshot);
          if (missing.length > 0) {
            return {
              output: `Faltan datos obligatorios: ${missing.map((field) => field.label).join(", ")}. Pedíselos al asociado de a uno, en ese orden, y guardalos antes de derivar.`,
              isError: true,
            };
          }
        }

        // Los datos que el canal ya conoce (el teléfono por WhatsApp) se guardan solos en el caso.
        const fromChannel: Record<string, string> = {};
        for (const field of fieldsForUnit(context.fields, snapshot.unit)) {
          const value = valueFromChannel(field, snapshot);
          if (value !== null && field.store === "case" && snapshot.data[field.id] === undefined) fromChannel[field.id] = value;
        }
        if (Object.keys(fromChannel).length > 0) {
          const saveFailure = await backend.saveCaseData({ unit: "", title: "", data: fromChannel });
          if (saveFailure) return { output: `No se pudo guardar: ${saveFailure}`, isError: true };
        }

        const failure = await backend.handoff({
          sector: parsed.data.sector,
          summary: parsed.data.resumen,
          priority: parsed.data.prioridad,
        });
        if (failure) return { output: `No se pudo derivar: ${failure}`, isError: true };
        return {
          output: "Caso derivado. El sistema le envía al asociado el mensaje oficial de derivación; no lo repitas.",
          decision: { action: "handoff", sector: parsed.data.sector, priority: parsed.data.prioridad, unit: snapshot.unit },
        };
      },
    },
    {
      name: "consultar_al_area",
      description:
        "Le hace una pregunta a un sector cuando falta un dato que solo el área sabe (precio, cupo, disponibilidad). El sector responde después; avisale al asociado que le vas a contestar por este mismo chat.",
      inputSchema: {
        type: "object",
        properties: {
          sector: { type: "string", enum: context.sectorSlugs },
          pregunta: { type: "string", description: "La pregunta, completa y sin datos personales innecesarios." },
        },
        required: ["sector", "pregunta"],
      },
      async run(input) {
        const parsed = askSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error);

        const failure = await backend.askArea({ sector: parsed.data.sector, question: parsed.data.pregunta });
        if (failure) return { output: `No se pudo consultar: ${failure}`, isError: true };
        return { output: "Consulta enviada al área.", decision: { action: "ask_area", sector: parsed.data.sector } };
      },
    },
  ];
}
