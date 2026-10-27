import { z } from "zod";

import type { CatalogSource } from "@/lib/catalog/source";
import { describeItem, searchCatalog } from "@/lib/catalog/search";

import type { AgentTool } from "./loop";

// Herramientas del "agente de stock" (ADR-043): son del agente de atención, que así responde con el catálogo real
// del cliente en vez de inventar. Solo leen: no guardan nada.

const searchSchema = z.object({
  operacion: z.string().trim().max(40).optional(),
  tipo: z.string().trim().max(60).optional(),
  zona: z.string().trim().max(80).optional(),
  dormitorios_minimo: z.number().int().min(0).max(20).optional(),
  precio_maximo: z.number().positive().optional(),
  moneda: z.enum(["USD", "ARS"]).optional(),
  palabras_clave: z.array(z.string().trim().min(2).max(40)).max(5).optional(),
  cantidad: z.number().int().min(1).max(8).default(5),
  solo_con_stock: z.boolean().optional(),
});

const detailSchema = z.object({ id: z.string().trim().min(1).max(100) });

function invalid(error: z.ZodError): { output: string; isError: true } {
  return { output: `Datos inválidos: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, isError: true };
}

const MAX_DESCRIPTION = 1500;

export function createCatalogTools(source: CatalogSource, options: { label: string }): AgentTool[] {
  return [
    {
      name: "buscar_en_catalogo",
      description: `Busca en el catálogo de ${options.label} disponibles del cliente. Usala siempre antes de responder sobre disponibilidad, precios o características: no inventes ni supongas. Todos los filtros son opcionales; usá solo los que la persona mencionó. Devuelve cuántos hay y los más accesibles primero, cada uno con su id.`,
      inputSchema: {
        type: "object",
        properties: {
          operacion: { type: "string", description: 'Tipo de operación, por ejemplo "venta" o "alquiler".' },
          tipo: { type: "string", description: 'Tipo de ítem, por ejemplo "Departamento", "Casa", "Terreno".' },
          zona: { type: "string", description: "Barrio, zona o localidad." },
          dormitorios_minimo: { type: "integer", description: "Cantidad mínima de dormitorios." },
          precio_maximo: { type: "number", description: "Precio tope, como número (150 mil → 150000)." },
          moneda: { type: "string", enum: ["USD", "ARS"], description: "Moneda del precio tope: USD (dólares) o ARS (pesos)." },
          palabras_clave: {
            type: "array",
            items: { type: "string" },
            description: 'Características que tiene que tener, una palabra por elemento (ej. ["pileta"], ["cochera"]).',
          },
          cantidad: { type: "integer", description: "Cuántos resultados devolver (por defecto 5, máximo 8)." },
          solo_con_stock: {
            type: "boolean",
            description: "true para dejar afuera lo agotado. Sin esto, lo agotado aparece marcado como AGOTADO: decíselo a la persona, no lo ofrezcas como disponible.",
          },
        },
      },
      async run(input) {
        const parsed = searchSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error);
        const filters = parsed.data;

        const items = await source.list();
        const result = searchCatalog(
          items,
          {
            operation: filters.operacion,
            category: filters.tipo,
            zone: filters.zona,
            minBedrooms: filters.dormitorios_minimo,
            maxPrice: filters.precio_maximo,
            currency: filters.moneda,
            keywords: filters.palabras_clave,
            inStockOnly: filters.solo_con_stock,
          },
          filters.cantidad,
        );

        if (result.total === 0) {
          return {
            output: `No hay ${options.label} disponibles con esos filtros. Decíselo con claridad y ofrecé aflojar algún filtro (zona, precio, dormitorios) o que el equipo le avise cuando ingrese algo así.`,
            decision: { action: "catalog_search", results: 0 },
          };
        }
        const lines = result.items.map(describeItem);
        const more = result.total > result.items.length ? ` (se muestran ${result.items.length}; hay más si pide)` : "";
        return {
          output: `${result.total} resultado${result.total === 1 ? "" : "s"}${more}:\n${lines.join("\n")}`,
          decision: { action: "catalog_search", results: result.total },
        };
      },
    },
    {
      name: "ver_ficha_del_catalogo",
      description: `Trae la ficha completa de un ítem del catálogo de ${options.label} por su id (el que devuelve buscar_en_catalogo, o el número que da la persona). Usala cuando pregunten por uno en particular o pidan más detalles.`,
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Id del ítem." } },
        required: ["id"],
      },
      async run(input) {
        const parsed = detailSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error);
        const id = parsed.data.id.replace(/^#/, "");

        const item = (await source.list()).find((candidate) => candidate.externalId === id);
        if (!item) return { output: `No existe un ítem con id ${id} en el catálogo. Pedile que lo confirme o buscá por sus características.`, isError: true };
        if (!item.isAvailable) {
          return {
            output: `El ítem ${id} (${item.title}) ya no está disponible. Decíselo y ofrecé buscar opciones parecidas.`,
            decision: { action: "catalog_detail", id, available: false },
          };
        }

        const description = (item.description ?? "").slice(0, MAX_DESCRIPTION);
        const details = Object.entries(item.details).map(([key, value]) => `${key}: ${value}`).join("; ");
        return {
          output: [
            describeItem(item),
            description ? `Descripción: ${description}` : null,
            details ? `Detalles: ${details}` : null,
            `Fotos: ${item.photos.length}${item.url ? " (en la ficha)" : ""}`,
          ]
            .filter(Boolean)
            .join("\n"),
          decision: { action: "catalog_detail", id, available: true },
        };
      },
    },
  ];
}
