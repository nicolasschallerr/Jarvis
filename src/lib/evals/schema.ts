import { parse } from "yaml";
import { z } from "zod";

// Formato de clientes/<slug>/evals/casos.yaml (ver clientes/_plantilla/evals/casos.yaml).

export const EVAL_ACTIONS = ["responder", "juntar_datos", "derivar", "consultar_area"] as const;
export type EvalAction = (typeof EVAL_ACTIONS)[number];

const evalCaseSchema = z.object({
  id: z.string().min(1),
  unidad: z.string().nullable().optional(),
  mensajes: z.array(z.string().min(1)).min(1, "tiene que haber al menos un mensaje"),
  esperado: z.object({
    accion: z.enum(EVAL_ACTIONS),
    sector: z.string().optional(),
    debe_incluir: z.array(z.string().min(1)).default([]),
    no_debe: z.array(z.string().min(1)).default([]),
  }),
});

const evalFileSchema = z.array(evalCaseSchema).superRefine((cases, ctx) => {
  cases.forEach((item, index) => {
    if (cases.findIndex((other) => other.id === item.id) !== index) {
      ctx.addIssue({ code: "custom", path: [index, "id"], message: `el caso "${item.id}" está repetido` });
    }
    if (item.esperado.accion === "derivar" || item.esperado.accion === "consultar_area") return;
    if (item.esperado.sector) {
      ctx.addIssue({ code: "custom", path: [index, "esperado", "sector"], message: `la acción "${item.esperado.accion}" no lleva sector` });
    }
  });
});

export type EvalCase = z.infer<typeof evalCaseSchema>;

export type ParseEvalsResult = { ok: true; cases: EvalCase[] } | { ok: false; errors: string[] };

// Lee y valida el YAML de casos. Los errores salen en español con su ubicación.
export function parseEvalCases(text: string): ParseEvalsResult {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    return { ok: false, errors: [`El archivo no es un YAML válido: ${error instanceof Error ? error.message : "error desconocido"}`] };
  }

  const result = evalFileSchema.safeParse(raw);
  if (result.success) return { ok: true, cases: result.data };

  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`),
  };
}
