import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/lib/supabase/database.types";

import type { AgentTool } from "./loop";

export type ToolContext = {
  unitSlugs: string[];
  sectorSlugs: string[];
};

// Dónde se guardan los efectos de las herramientas. En producción es la base (funciones que fijan el
// actor "agente"); en los evals es una memoria que solo anota qué se pidió. Cada operación devuelve
// null si salió bien o el motivo del error.
export type CaseBackend = {
  saveCaseData(input: { unit: string; title: string; data: Record<string, string | number | boolean> }): Promise<string | null>;
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
});

const askSchema = z.object({
  sector: z.string().min(1),
  pregunta: z.string().trim().min(1).max(1000),
});

function invalid(error: z.ZodError): { output: string; isError: true } {
  return { output: `Datos inválidos: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, isError: true };
}

// Herramientas del agente de atención. El modelo nunca toca las tablas: sus pedidos pasan por el
// backend, que valida y registra. Los sectores y unidades válidos salen de la configuración del
// cliente, no están escritos en el código.
export function createAttentionTools(backend: CaseBackend, context: ToolContext): AgentTool[] {
  return [
    {
      name: "guardar_datos_del_caso",
      description:
        "Guarda en el caso los datos que el asociado fue dando (por ejemplo monto, localidad, destino) y la unidad de negocio identificada. Usala apenas tengas datos, no esperes al final. Los datos nuevos se suman a los anteriores.",
      inputSchema: {
        type: "object",
        properties: {
          unidad: { type: "string", enum: context.unitSlugs, description: "Unidad de negocio identificada." },
          titulo: { type: "string", description: "Título corto del caso (ej. 'Solicitud de crédito')." },
          datos: { type: "object", description: "Pares nombre → valor con lo que dijo el asociado." },
        },
        required: ["datos"],
      },
      async run(input) {
        const parsed = saveSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error);

        const failure = await backend.saveCaseData({
          unit: parsed.data.unidad ?? "",
          title: parsed.data.titulo ?? "",
          data: parsed.data.datos,
        });
        if (failure) return { output: `No se pudo guardar: ${failure}`, isError: true };
        return { output: "Datos guardados." };
      },
    },
    {
      name: "derivar_a_sector",
      description:
        "Deriva el caso al sector correcto con un resumen para el equipo. Usala cuando ya juntaste todos los datos que pide la unidad, o cuando el tema es sensible. Después avisale al asociado quién lo va a atender.",
      inputSchema: {
        type: "object",
        properties: {
          sector: { type: "string", enum: context.sectorSlugs },
          resumen: { type: "string", description: "Resumen claro para quien recibe el caso, con los datos juntados." },
          prioridad: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        },
        required: ["sector", "resumen"],
      },
      async run(input) {
        const parsed = handoffSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error);

        const failure = await backend.handoff({
          sector: parsed.data.sector,
          summary: parsed.data.resumen,
          priority: parsed.data.prioridad,
        });
        if (failure) return { output: `No se pudo derivar: ${failure}`, isError: true };
        return {
          output: "Caso derivado.",
          decision: { action: "handoff", sector: parsed.data.sector, priority: parsed.data.prioridad },
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
