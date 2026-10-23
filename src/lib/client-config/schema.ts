import { z } from "zod";

// Esquema del archivo clientes/<slug>/sectores-y-reglas.yaml. Por ahora se valida y se carga la parte
// estructural que usa el CRM (sectores y unidades). El resto de las secciones (horario, temas
// sensibles, seguimientos, textos) se acepta sin validar en profundidad y se tipa cuando las
// use el agente (Fases 6 y 9).

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "debe ir en minúsculas, con números y guiones (ej. atencion-general)");

const sectorSchema = z.object({
  id: slug,
  nombre: z.string().trim().min(1, "falta el nombre"),
  // Los responsables son contactos para avisos; no son usuarios del CRM, por eso no se cargan.
  responsables: z
    .array(z.object({ nombre: z.string().min(1), email: z.string().min(1) }))
    .optional(),
});

const unidadSchema = z.object({
  id: slug,
  nombre: z.string().trim().min(1, "falta el nombre"),
  sector: slug,
});

// Cómo se llaman y qué frase tienen los agentes de este cliente. "atencion" es el que conversa con los
// afiliados y "analitico" el que responde preguntas sobre los datos.
const agenteSchema = z.object({
  tipo: z.enum(["atencion", "analitico"]),
  nombre: z.string().trim().min(1, "falta el nombre").max(40, "el nombre no puede superar los 40 caracteres"),
  frase: z.string().trim().max(140, "la frase no puede superar los 140 caracteres").optional(),
});

export const clientConfigSchema = z
  .object({
    organizacion: z.object({ slug, nombre: z.string().min(1) }).loose(),
    unidades: z.array(unidadSchema).min(1, "tiene que haber al menos una unidad"),
    sectores: z.array(sectorSchema).min(1, "tiene que haber al menos un sector"),
    derivacion: z.object({ sector_por_defecto: slug }).loose().optional(),
    agentes: z.array(agenteSchema).optional(),
  })
  .loose()
  .superRefine((config, ctx) => {
    const sectorIds = config.sectores.map((sector) => sector.id);
    const known = new Set(sectorIds);

    sectorIds.forEach((id, index) => {
      if (sectorIds.indexOf(id) !== index) {
        ctx.addIssue({ code: "custom", path: ["sectores", index, "id"], message: `el sector "${id}" está repetido` });
      }
    });

    const unitIds = config.unidades.map((unit) => unit.id);
    unitIds.forEach((id, index) => {
      if (unitIds.indexOf(id) !== index) {
        ctx.addIssue({ code: "custom", path: ["unidades", index, "id"], message: `la unidad "${id}" está repetida` });
      }
    });

    (config.agentes ?? []).forEach((agente, index, all) => {
      if (all.findIndex((other) => other.tipo === agente.tipo) !== index) {
        ctx.addIssue({ code: "custom", path: ["agentes", index, "tipo"], message: `hay más de un agente de tipo "${agente.tipo}"` });
      }
    });

    config.unidades.forEach((unit, index) => {
      if (!known.has(unit.sector)) {
        ctx.addIssue({
          code: "custom",
          path: ["unidades", index, "sector"],
          message: `la unidad "${unit.id}" apunta al sector "${unit.sector}", que no está en la lista de sectores`,
        });
      }
    });

    if (config.derivacion && !known.has(config.derivacion.sector_por_defecto)) {
      ctx.addIssue({
        code: "custom",
        path: ["derivacion", "sector_por_defecto"],
        message: `el sector por defecto "${config.derivacion.sector_por_defecto}" no está en la lista de sectores`,
      });
    }
  });

export type ClientConfig = z.infer<typeof clientConfigSchema>;
