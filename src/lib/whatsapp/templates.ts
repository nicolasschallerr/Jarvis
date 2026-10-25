import type { Database, Json } from "@/lib/supabase/database.types";

// Plantillas de mensajes de WhatsApp (Fase 9, ADR-030). Fuera de la ventana de 24 h, WhatsApp solo deja escribir
// con plantillas aprobadas por Meta. Este módulo no hace llamadas de red: lee las variables, arma el texto que ve
// el equipo y el pedido que se manda a Meta, según la documentación de la Cloud API:
//   POST https://graph.facebook.com/<versión>/<phone-number-id>/messages
//   { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
//     template: { name, language: { code }, components: [{ type: "body", parameters: [...] }] } }
// Los parámetros son posicionales ({{1}}, {{2}}: solo "text", en orden) o con nombre ({{nombre}}: además
// "parameter_name").

export type TemplateStatus = Database["public"]["Enums"]["template_meta_status"];
export type ParameterFormat = "positional" | "named";

export const TEMPLATE_BODY_MAX = 1024;
// Un parámetro no puede ser vacío ni traer saltos de línea, tabulaciones o más de 4 espacios seguidos (Meta lo
// rechaza); se limpia antes de enviar.
export const PARAMETER_MAX = 300;

const VARIABLE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

// Variables del cuerpo, en el orden en que aparecen y sin repetir.
export function templateVariables(body: string): string[] {
  const seen: string[] = [];
  for (const match of body.matchAll(VARIABLE)) {
    const key = match[1] ?? "";
    if (key && !seen.includes(key)) seen.push(key);
  }
  return seen;
}

export function parameterFormatOf(body: string): ParameterFormat {
  // Sin variables, o todas numéricas ({{1}}, {{2}}): posicional. Con algún nombre ({{nombre}}): con nombre.
  return templateVariables(body).every((key) => /^\d+$/.test(key)) ? "positional" : "named";
}

export function cleanParameter(value: string): string {
  return value.replace(/[\n\r\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, PARAMETER_MAX);
}

// Texto final que ve el equipo en la conversación (y que se guarda como cuerpo del mensaje).
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(VARIABLE, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : cleanParameter(value);
  });
}

export type TemplateCheck = { ok: true; values: Record<string, string> } | { ok: false; error: string };

// Cada variable necesita un valor no vacío.
export function checkValues(body: string, values: Record<string, string>): TemplateCheck {
  const clean: Record<string, string> = {};
  for (const key of templateVariables(body)) {
    const value = cleanParameter(values[key] ?? "");
    if (!value) return { ok: false, error: `Completá la variable {{${key}}}.` };
    clean[key] = value;
  }
  return { ok: true, values: clean };
}

export function buildTemplatePayload(params: {
  to: string;
  name: string;
  language: string;
  body: string;
  format: ParameterFormat;
  values: Record<string, string>;
}): Record<string, unknown> {
  const variables = templateVariables(params.body);
  const parameters = variables.map((key) =>
    params.format === "named"
      ? { type: "text", parameter_name: key, text: cleanParameter(params.values[key] ?? "") }
      : { type: "text", text: cleanParameter(params.values[key] ?? "") },
  );
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    // Meta recomienda el número con "+" y código de país; el identificador del contacto ya viene con el país.
    to: params.to.startsWith("+") ? params.to : `+${params.to}`,
    type: "template",
    template: {
      name: params.name,
      language: { code: params.language },
      ...(parameters.length > 0 ? { components: [{ type: "body", parameters }] } : {}),
    },
  };
}

// Estado de Meta (APPROVED, PENDING, REJECTED, PAUSED, DISABLED, ...) → estado guardado.
export function statusFromMeta(status: string | undefined): TemplateStatus {
  switch ((status ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
    case "PENDING_DELETION":
    case "DELETED":
    case "ARCHIVED":
      return "disabled";
    default:
      // PENDING, IN_APPEAL y cualquier estado nuevo: en revisión.
      return "submitted";
  }
}

export const STATUS_LABELS: Record<TemplateStatus, string> = {
  draft: "Borrador",
  submitted: "En revisión",
  approved: "Aprobada",
  rejected: "Rechazada",
  paused: "Pausada",
  disabled: "Desactivada",
};

// Una plantilla tal como la devuelve GET /<waba-id>/message_templates.
export type MetaTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  parameter_format?: string;
  rejected_reason?: string;
  components?: Array<{ type?: string; text?: string; format?: string; [key: string]: unknown }>;
};

export type TemplateRow = {
  name: string;
  language: string;
  category: string | null;
  body: string;
  parameter_format: ParameterFormat;
  components: Json;
  meta_status: TemplateStatus;
  meta_template_id: string | null;
  rejected_reason: string | null;
};

// Convierte una plantilla de Meta en la fila que se guarda. Sin cuerpo no sirve para escribir: se descarta.
export function rowFromMeta(template: MetaTemplate): TemplateRow | null {
  const body = template.components?.find((component) => component.type?.toUpperCase() === "BODY")?.text;
  if (!template.name || !template.language || !body) return null;
  const format: ParameterFormat =
    template.parameter_format?.toUpperCase() === "NAMED" ? "named" : template.parameter_format ? "positional" : parameterFormatOf(body);
  return {
    name: template.name,
    language: template.language,
    category: template.category ? template.category.toLowerCase() : null,
    body,
    parameter_format: format,
    components: (template.components ?? []) as Json,
    meta_status: statusFromMeta(template.status),
    meta_template_id: template.id ?? null,
    rejected_reason: template.rejected_reason && template.rejected_reason !== "NONE" ? template.rejected_reason : null,
  };
}
