// Búsqueda en el catálogo de stock (ADR-043). Es una función pura sobre los ítems disponibles de una organización:
// la usan las herramientas del agente, con los ítems de la base o, en los evals, de memoria.

export type CatalogItem = {
  externalId: string;
  url: string | null;
  operation: string | null;
  category: string | null;
  title: string;
  zone: string | null;
  locality: string | null;
  price: number | null;
  currency: string | null;
  priceText: string | null;
  areaM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  description: string | null;
  details: Record<string, string>;
  photos: string[];
  isAvailable: boolean;
  // Propios de una tienda (ADR-045). Opcionales: un catálogo inmobiliario no los usa. stockQuantity null = la
  // fuente no informa unidades; 0 = agotado.
  sku?: string | null;
  brand?: string | null;
  stockQuantity?: number | null;
};

export type CatalogFilters = {
  operation?: string;
  category?: string;
  zone?: string;
  minBedrooms?: number;
  maxPrice?: number;
  currency?: string;
  // Palabras que tienen que aparecer en el título, la descripción o los detalles (ej. "pileta", "cochera").
  keywords?: string[];
  // Deja afuera lo agotado (stock en 0). Sin esto, lo agotado aparece y se describe como agotado.
  inStockOnly?: boolean;
};

export type CatalogSearchResult = { total: number; items: CatalogItem[] };

// Sin tildes ni mayúsculas: "Galpón" y "galpon" son lo mismo.
export function normalize(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// ¿El texto contiene la palabra completa? Evita que "rio" coincida dentro de "dormitorios".
function hasWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

// Abreviaturas comunes en castellano que la gente escribe por chat.
const ABBREVIATIONS: Record<string, string> = { depto: "departamento", dpto: "departamento", dto: "departamento", mono: "monoambiente" };

// Coincidencia flexible para tipo y zona: "depto" encuentra "Departamento" y "norte" encuentra "Barrio Norte".
function matchesLoosely(value: string | null, wanted: string): boolean {
  const have = normalize(value);
  const raw = normalize(wanted);
  const want = ABBREVIATIONS[raw] ?? raw;
  if (!want) return true;
  if (!have) return false;
  return have.includes(want) || want.includes(have) || (want.length >= 4 && have.startsWith(want.slice(0, 4)));
}

function searchableText(item: CatalogItem): string {
  return normalize([item.title, item.description, item.zone, item.locality, item.sku, item.brand, ...Object.entries(item.details).flat()].join(" "));
}

export function searchCatalog(items: CatalogItem[], filters: CatalogFilters, limit = 5): CatalogSearchResult {
  const keywords = (filters.keywords ?? []).map(normalize).filter(Boolean);

  const matches = items.filter((item) => {
    if (!item.isAvailable) return false;
    if (filters.inStockOnly && item.stockQuantity === 0) return false;
    if (filters.operation && normalize(item.operation) !== normalize(filters.operation)) return false;
    if (filters.category && !matchesLoosely(item.category, filters.category)) return false;
    if (filters.zone && !matchesLoosely(item.zone, filters.zone) && !matchesLoosely(item.locality, filters.zone)) return false;
    if (filters.minBedrooms !== undefined && (item.bedrooms ?? 0) < filters.minBedrooms) return false;
    if (filters.maxPrice !== undefined) {
      // Un precio tope solo compara ítems con precio y en la misma moneda: dólares y pesos no se mezclan.
      if (item.price === null) return false;
      if (filters.currency && normalize(item.currency) !== normalize(filters.currency)) return false;
      if (item.price > filters.maxPrice) return false;
    }
    if (keywords.length > 0) {
      const text = searchableText(item);
      if (!keywords.every((word) => hasWord(text, word))) return false;
    }
    return true;
  });

  // Los más accesibles primero; los que no publican precio, al final.
  matches.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
  return { total: matches.length, items: matches.slice(0, limit) };
}

// Línea corta de un ítem para que el modelo la lea (y, si quiere, se la muestre a la persona).
export function describeItem(item: CatalogItem): string {
  const facts = [
    item.areaM2 ? `${item.areaM2.toLocaleString("es-AR")} m²` : null,
    item.bedrooms ? `${item.bedrooms} dorm.` : null,
    item.bathrooms ? `${item.bathrooms} baño${item.bathrooms > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  const where = [item.zone, item.locality].filter(Boolean).join(", ");
  const stock =
    item.stockQuantity === undefined || item.stockQuantity === null
      ? null
      : item.stockQuantity === 0
        ? "AGOTADO"
        : `${item.stockQuantity} unidad${item.stockQuantity === 1 ? "" : "es"} en stock`;
  return [
    `[id ${item.externalId}] ${[item.category, item.operation ? `en ${item.operation}` : null].filter(Boolean).join(" ")}: ${item.title}`,
    item.brand ? `(marca ${item.brand})` : null,
    item.sku ? `(SKU ${item.sku})` : null,
    where ? `(${where})` : null,
    `· ${item.priceText || "precio a consultar"}`,
    stock ? `· ${stock}` : null,
    facts.length ? `· ${facts.join(", ")}` : null,
    item.url ? `· ficha: ${item.url}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}
