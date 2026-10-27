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
  // Mensaje oficial de derivación propio de esta unidad (si no, se usa el general). Ver ADR-022.
  mensaje_derivacion: z.string().trim().min(1).optional(),
});

// Cómo se llaman y qué frase tienen los agentes de este cliente. "atencion" es el que conversa con los
// afiliados y "analitico" el que responde preguntas sobre los datos.
const agenteSchema = z.object({
  tipo: z.enum(["atencion", "analitico"]),
  nombre: z.string().trim().min(1, "falta el nombre").max(40, "el nombre no puede superar los 40 caracteres"),
  frase: z.string().trim().max(140, "la frase no puede superar los 140 caracteres").optional(),
});

const horarioSchema = z.object({
  dias: z.array(z.string()).min(1),
  desde: z.string().regex(/^\d{2}:\d{2}$/, "formato HH:MM"),
  hasta: z.string().regex(/^\d{2}:\d{2}$/, "formato HH:MM"),
  feriados: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato AAAA-MM-DD")).default([]),
});

const temaSensibleSchema = z.object({
  id: slug,
  descripcion: z.string().min(1),
  sector: slug,
  prioridad: z.string().default("normal"),
});

// Recordatorios automáticos cuando una gestión queda esperando al asociado. "plantilla" es la plantilla de
// Meta para escribir fuera de la ventana de 24 h (se usa cuando estén aprobadas).
const seguimientosSchema = z.object({
  activo: z.boolean().default(false),
  horas: z.array(z.number().int().positive()).default([]),
  plantilla: z.string().optional(),
});

// Textos fijos que el SISTEMA envía tal cual, sin pasar por el modelo: el menú principal (se envía cuando
// el asociado escribe MENÚ) y el mensaje de derivación (admite {{sector}}).
const textosEditablesSchema = z
  .object({
    seguimiento: z.string().min(1).optional(),
    menu_principal: z.string().min(1).optional(),
    mensaje_derivacion: z.string().min(1).optional(),
  })
  .loose();

// Un dato que el agente junta (DNI, email, monto...). "regex" valida lo que escribe el asociado; sin regex
// se acepta cualquier texto. "limpiar: digitos" quita puntos y espacios antes de validar. "guardar_en" dice
// dónde queda: en la ficha del asociado (nombre, documento, localidad) o en los datos del caso.
// "unidades" limita en qué ramas se pide; sin ella se pide en todas. Ver ADR-022.
export const CAMPO_DESTINOS = ["caso", "contacto_nombre", "contacto_documento", "contacto_localidad"] as const;

const campoSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/, "usá minúsculas, números y guion bajo (ej. email)"),
  etiqueta: z.string().trim().min(1, "falta la etiqueta"),
  regex: z
    .string()
    .optional()
    .refine((value) => {
      if (value === undefined) return true;
      try {
        new RegExp(value);
        return true;
      } catch {
        return false;
      }
    }, "la expresión regular no es válida"),
  ayuda: z.string().optional(),
  limpiar: z.enum(["digitos"]).optional(),
  guardar_en: z.enum(CAMPO_DESTINOS).default("caso"),
  unidades: z.array(slug).optional(),
  obligatorio: z.boolean().default(true),
  // Si el canal ya lo da (el teléfono, cuando escriben por WhatsApp), se toma de ahí y no se le pide al
  // asociado.
  desde_canal: z.boolean().default(false),
});

// "datos_por_mensaje": cuántos datos puede pedir el agente en un mismo mensaje. Con 1 pide de a uno; con más,
// junta los que falten en pocos mensajes (menos idas y vueltas).
const validacionSchema = z.object({
  reintentos_por_campo: z.number().int().min(1).max(10).default(3),
  datos_por_mensaje: z.number().int().min(1).max(6).default(3),
});

// Modelo y precios del agente de atención. Los precios son opcionales: sin ellos no se calcula el costo.
const iaSchema = z.object({
  modelo_atencion: z.string().min(1).optional(),
  precio_entrada_usd_por_millon: z.number().nonnegative().optional(),
  precio_salida_usd_por_millon: z.number().nonnegative().optional(),
});

// Catálogo de stock que consulta el agente (ADR-043). "nombre" es cómo se llama lo que hay en él, en plural
// (ej. "propiedades", "vehículos"). Los ítems se cargan aparte, con scripts/cargar-catalogo.mts.
const catalogoSchema = z.object({
  activo: z.boolean().default(false),
  nombre: z.string().trim().min(1).max(40).default("productos"),
});

export const clientConfigSchema = z
  .object({
    organizacion: z
      .object({ slug, nombre: z.string().min(1), nombre_agente: z.string().optional(), zona_horaria: z.string().optional() })
      .loose(),
    horario_atencion: horarioSchema.optional(),
    temas_sensibles: z.array(temaSensibleSchema).optional(),
    ia: iaSchema.optional(),
    campos: z.array(campoSchema).optional(),
    validacion: validacionSchema.optional(),
    seguimientos: seguimientosSchema.optional(),
    textos_editables: textosEditablesSchema.optional(),
    unidades: z.array(unidadSchema).min(1, "tiene que haber al menos una unidad"),
    sectores: z.array(sectorSchema).min(1, "tiene que haber al menos un sector"),
    derivacion: z.object({ sector_por_defecto: slug }).loose().optional(),
    agentes: z.array(agenteSchema).optional(),
    catalogo: catalogoSchema.optional(),
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

    const fieldIds = (config.campos ?? []).map((field) => field.id);
    (config.campos ?? []).forEach((field, index) => {
      if (fieldIds.indexOf(field.id) !== index) {
        ctx.addIssue({ code: "custom", path: ["campos", index, "id"], message: `el campo "${field.id}" está repetido` });
      }
      for (const unit of field.unidades ?? []) {
        if (!unitIds.includes(unit)) {
          ctx.addIssue({ code: "custom", path: ["campos", index, "unidades"], message: `el campo "${field.id}" apunta a la unidad "${unit}", que no está en la lista de unidades` });
        }
      }
      if (field.guardar_en !== "caso") {
        const other = (config.campos ?? []).findIndex((candidate) => candidate.guardar_en === field.guardar_en);
        if (other !== index) {
          ctx.addIssue({ code: "custom", path: ["campos", index, "guardar_en"], message: `hay más de un campo que se guarda en "${field.guardar_en}"` });
        }
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
