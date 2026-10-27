import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/lib/supabase/database.types";

import type { CatalogItem } from "./search";

// Formato común del archivo de catálogo (ADR-043). El lector de cada cliente (en su carpeta privada) lee su web o
// su sistema y escribe un JSON así; scripts/cargar-catalogo.mts lo sube a la base. Ejemplo de un ítem:
//   { "id_externo": "584", "titulo": "Calle Falsa 123", "operacion": "venta", "tipo": "Departamento",
//     "zona": "Centro", "precio": 140000, "moneda": "USD", "precio_texto": "U$S 140.000", "dormitorios": 2, ... }

const nullableText = z.string().trim().nullish().transform((value) => (value ? value : null));
const nullableNumber = z.number().finite().nonnegative().nullish().transform((value) => value ?? null);

const itemSchema = z.object({
  id_externo: z.string().trim().min(1).max(100),
  titulo: z.string().trim().min(1).max(200),
  url: z.url().nullish().transform((value) => value ?? null),
  operacion: nullableText,
  tipo: nullableText,
  zona: nullableText,
  localidad: nullableText,
  precio: nullableNumber,
  moneda: nullableText,
  precio_texto: nullableText,
  superficie_m2: nullableNumber,
  dormitorios: z.number().int().nonnegative().nullish().transform((value) => value ?? null),
  banos: z.number().int().nonnegative().nullish().transform((value) => value ?? null),
  descripcion: z.string().max(10000).nullish().transform((value) => value?.trim() || null),
  detalles: z.record(z.string(), z.string()).default({}),
  fotos: z.array(z.url()).max(100).default([]),
  sku: nullableText,
  marca: nullableText,
  stock: z.number().int().nonnegative().nullish().transform((value) => value ?? null),
});

export const catalogFileSchema = z.object({
  fuente: z.string().optional(),
  leido_el: z.string().optional(),
  propiedades: z.array(itemSchema).optional(),
  items: z.array(itemSchema).optional(),
});

export type CatalogFileResult = { ok: true; items: CatalogItem[] } | { ok: false; errors: string[] };

// Lee el archivo. Acepta la lista bajo "items" o "propiedades" (el nombre que le dé cada rubro).
export function parseCatalogFile(text: string): CatalogFileResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["El archivo no es un JSON válido."] };
  }
  const parsed = catalogFileSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  const raw = parsed.data.items ?? parsed.data.propiedades;
  if (!raw) return { ok: false, errors: ['Falta la lista de ítems ("items" o "propiedades").'] };

  const ids = raw.map((item) => item.id_externo);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (repeated.length > 0) return { ok: false, errors: [`Hay ids repetidos: ${[...new Set(repeated)].join(", ")}`] };

  return {
    ok: true,
    items: raw.map((item) => ({
      externalId: item.id_externo,
      url: item.url,
      operation: item.operacion?.toLowerCase() ?? null,
      category: item.tipo,
      title: item.titulo,
      zone: item.zona,
      locality: item.localidad,
      price: item.precio,
      currency: item.moneda?.toUpperCase() ?? null,
      priceText: item.precio_texto,
      areaM2: item.superficie_m2,
      bedrooms: item.dormitorios,
      bathrooms: item.banos,
      description: item.descripcion,
      details: item.detalles,
      photos: item.fotos,
      sku: item.sku,
      brand: item.marca,
      stockQuantity: item.stock,
      isAvailable: true,
    })),
  };
}

export type CatalogSyncSummary = { upserted: number; deactivated: number };

// Sube el catálogo de una organización: alta o actualización de cada ítem del archivo, y baja lógica
// (is_available = false) de los que ya no vienen. Se puede repetir sin efectos de más.
export async function syncCatalog(
  admin: SupabaseClient<Database>,
  organizationId: string,
  items: CatalogItem[],
  now: Date = new Date(),
  // La fuente de la que vienen los ítems (ADR-045). Con fuente, la baja lógica alcanza solo a los ítems de esa fuente;
  // sin fuente (el script de carga por archivo), a todos los de la organización, como antes.
  sourceId: string | null = null,
): Promise<CatalogSyncSummary> {
  const syncedAt = now.toISOString();
  const rows = items.map((item) => ({
    organization_id: organizationId,
    external_id: item.externalId,
    url: item.url,
    operation: item.operation,
    category: item.category,
    title: item.title,
    zone: item.zone,
    locality: item.locality,
    price: item.price,
    currency: item.currency,
    price_text: item.priceText,
    area_m2: item.areaM2,
    bedrooms: item.bedrooms,
    bathrooms: item.bathrooms,
    description: item.description,
    details: item.details as Json,
    photos: item.photos,
    sku: item.sku ?? null,
    brand: item.brand ?? null,
    stock_quantity: item.stockQuantity ?? null,
    source_id: sourceId,
    is_available: true,
    synced_at: syncedAt,
  }));

  // De a tandas, para no armar un pedido gigante.
  for (let start = 0; start < rows.length; start += 200) {
    const { error } = await admin
      .from("catalog_items")
      .upsert(rows.slice(start, start + 200), { onConflict: "organization_id,external_id" });
    if (error) throw new Error(`No se pudo guardar el catálogo: ${error.message}`);
  }

  // Lo que estaba disponible y no vino en esta carga queda dado de baja.
  let goneQuery = admin.from("catalog_items").update({ is_available: false }).eq("organization_id", organizationId).eq("is_available", true).lt("synced_at", syncedAt);
  if (sourceId) goneQuery = goneQuery.eq("source_id", sourceId);
  const { data: gone, error: goneError } = await goneQuery.select("id");
  if (goneError) throw new Error(`No se pudieron dar de baja los ítems que ya no están: ${goneError.message}`);

  return { upserted: rows.length, deactivated: gone?.length ?? 0 };
}
