import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type { CatalogItem } from "./search";

// De dónde salen los ítems del catálogo: en producción, la base; en los evals y las pruebas, una lista en memoria.
export type CatalogSource = {
  // Todos los ítems de la organización, disponibles y dados de baja (la herramienta de ficha necesita saber si
  // un ítem existió aunque ya no esté disponible).
  list(): Promise<CatalogItem[]>;
};

// Tope de ítems que se leen por consulta. Un catálogo de una inmobiliaria tiene cientos; ver ADR-043.
const MAX_ITEMS = 5000;

type Row = Database["public"]["Tables"]["catalog_items"]["Row"];

export function rowToItem(row: Row): CatalogItem {
  const details: Record<string, string> = {};
  if (row.details && typeof row.details === "object" && !Array.isArray(row.details)) {
    for (const [key, value] of Object.entries(row.details)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") details[key] = String(value);
    }
  }
  return {
    externalId: row.external_id,
    url: row.url,
    operation: row.operation,
    category: row.category,
    title: row.title,
    zone: row.zone,
    locality: row.locality,
    price: row.price,
    currency: row.currency,
    priceText: row.price_text,
    areaM2: row.area_m2,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    description: row.description,
    details,
    photos: row.photos,
    isAvailable: row.is_available,
    sku: row.sku,
    brand: row.brand,
    stockQuantity: row.stock_quantity,
  };
}

export function createSupabaseCatalog(admin: SupabaseClient<Database>, organizationId: string): CatalogSource {
  return {
    async list() {
      const { data, error } = await admin
        .from("catalog_items")
        .select("*")
        .eq("organization_id", organizationId)
        .limit(MAX_ITEMS);
      if (error) throw new Error(`No se pudo leer el catálogo: ${error.message}`);
      return (data ?? []).map(rowToItem);
    },
  };
}

export function createMemoryCatalog(items: CatalogItem[]): CatalogSource {
  return {
    async list() {
      return items;
    },
  };
}
