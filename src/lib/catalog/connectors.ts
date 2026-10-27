import { parsePrice, parseTable } from "./spreadsheet";
import type { CatalogItem } from "./search";

// Conectores de stock (ADR-047): leen la base o la web del cliente y devuelven ítems del catálogo. Los configura el
// proveedor en la carpeta privada del cliente (nunca el cliente desde el CRM) y corren en el servidor, así que cada
// pedido sale acotado: solo https, solo a un nombre de dominio público, con tiempo y tamaño máximos.

export type ConnectorResult =
  // complete = false cuando la lectura se cortó por tiempo: se guarda lo leído pero no se da de baja lo que faltó.
  { ok: true; items: CatalogItem[]; complete: boolean; via: string } | { ok: false; error: string };

type Fetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_CONNECTOR_ITEMS = 5000;
const USER_AGENT = "OrbitaAI-Catalogo/1.0 (+lectura de stock del cliente)";

// https y un nombre de dominio público: nada de IPs, localhost ni nombres internos (riesgo de pedidos a la red propia).
export function safeUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  return url;
}

async function getText(url: string, fetchImpl: Fetch, headers: Record<string, string> = {}): Promise<{ status: number; type: string; text: string; finalUrl: string } | null> {
  if (!safeUrl(url)) return null;
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, ...headers },
      redirect: "follow",
    });
    // Una redirección no puede llevar a un destino que no se aceptaría de entrada.
    const finalUrl = response.url || url;
    if (!safeUrl(finalUrl)) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) return null;
    return { status: response.status, type: response.headers.get("content-type") ?? "", text: new TextDecoder("utf-8").decode(buffer), finalUrl };
  } catch {
    return null;
  }
}

async function getJson(url: string, fetchImpl: Fetch, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await getText(url, fetchImpl, { Accept: "application/json", ...headers });
  if (!response || response.status !== 200) return undefined;
  try {
    return JSON.parse(response.text);
  } catch {
    return undefined;
  }
}

const decodeEntities = (text: string) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));

export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return text ? text.slice(0, 10000) : null;
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" ? parsePrice(value) : null);

function priceText(price: number | null, currency: string | null): string | null {
  if (price === null) return null;
  const symbol = currency === "USD" ? "US$" : "$";
  return `${symbol} ${price.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}

function baseItem(partial: Partial<CatalogItem> & Pick<CatalogItem, "externalId" | "title">): CatalogItem {
  return {
    url: null,
    operation: null,
    category: null,
    zone: null,
    locality: null,
    price: null,
    currency: null,
    priceText: null,
    areaM2: null,
    bedrooms: null,
    bathrooms: null,
    description: null,
    details: {},
    photos: [],
    isAvailable: true,
    sku: null,
    brand: null,
    stockQuantity: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Base Supabase del cliente: su API REST (PostgREST), de solo lectura, con la clave que el proveedor deja en una
// variable de entorno. Las columnas se reconocen igual que los encabezados de una planilla; `columnas` permite
// decir cuál es cuál cuando tienen nombres raros.
// ---------------------------------------------------------------------------------------------------------------

export type SupabaseSourceConfig = { url: string; table: string; key: string; columns?: Record<string, string> };

const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const PAGE = 1000;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(" ");
  if (typeof value === "object") return "";
  return String(value);
}

export function recordsToRows(records: Record<string, unknown>[], columns: Record<string, string> = {}): string[][] {
  // columnas: { campo_de_orbita: columna_del_cliente } → la columna del cliente se lee como ese campo.
  const rename = new Map(Object.entries(columns).map(([field, column]) => [column, field]));
  const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const header = keys.map((key) => rename.get(key) ?? key);
  return [header, ...records.map((record) => keys.map((key) => cellText(record[key])))];
}

export async function readSupabaseTable(config: SupabaseSourceConfig, fetchImpl: Fetch = fetch): Promise<ConnectorResult> {
  const base = safeUrl(config.url);
  if (!base || !base.hostname.endsWith(".supabase.co")) return { ok: false, error: "La dirección de la base tiene que ser https://<proyecto>.supabase.co." };
  if (!TABLE_NAME.test(config.table)) return { ok: false, error: "El nombre de la tabla no es válido." };

  const records: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX_CONNECTOR_ITEMS; offset += PAGE) {
    const url = `${base.origin}/rest/v1/${config.table}?select=*&limit=${PAGE}&offset=${offset}`;
    const response = await getText(url, fetchImpl, { apikey: config.key, Authorization: `Bearer ${config.key}`, Accept: "application/json" });
    if (!response) return { ok: false, error: "No pude conectarme con la base del cliente." };
    if (response.status === 401 || response.status === 403) return { ok: false, error: "La base rechazó la clave: revisá la variable de entorno de la fuente." };
    if (response.status === 404) return { ok: false, error: `La base no tiene la tabla "${config.table}" (o la clave no puede verla).` };
    if (response.status !== 200) return { ok: false, error: `La base respondió ${response.status}.` };
    let page: unknown;
    try {
      page = JSON.parse(response.text);
    } catch {
      return { ok: false, error: "La base devolvió algo que no es una lista." };
    }
    if (!Array.isArray(page)) return { ok: false, error: "La base devolvió algo que no es una lista." };
    records.push(...(page as Record<string, unknown>[]));
    if (page.length < PAGE) break;
  }

  if (records.length === 0) return { ok: false, error: "La tabla está vacía." };
  const parsed = parseTable(recordsToRows(records, config.columns));
  if (!parsed.ok) return { ok: false, error: parsed.errors[0] ?? "No se pudieron leer los productos de la tabla." };
  return { ok: true, items: parsed.items, complete: true, via: "base Supabase" };
}

// ---------------------------------------------------------------------------------------------------------------
// Sitio web de la tienda. Primero las plataformas con catálogo público en JSON (Shopify, WooCommerce); si no es
// ninguna, el mapa del sitio y los datos de producto (schema.org) que publican las fichas para los buscadores.
// ---------------------------------------------------------------------------------------------------------------

type ShopifyVariant = { price?: string; sku?: string; available?: boolean };
type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  vendor?: string;
  product_type?: string;
  body_html?: string;
  tags?: string[] | string;
  variants?: ShopifyVariant[];
  images?: { src?: string }[];
};

export function shopifyToItems(products: ShopifyProduct[], origin: string): CatalogItem[] {
  return products.map((product) => {
    const variants = product.variants ?? [];
    const prices = variants.map((variant) => num(variant.price)).filter((value): value is number => value !== null);
    const price = prices.length ? Math.min(...prices) : null;
    const anyAvailable = variants.length === 0 || variants.some((variant) => variant.available !== false);
    return baseItem({
      externalId: String(product.id),
      title: product.title.slice(0, 200),
      url: `${origin}/products/${product.handle}`,
      brand: str(product.vendor),
      category: str(product.product_type),
      sku: str(variants[0]?.sku),
      price,
      currency: null,
      priceText: price === null ? null : `$ ${price.toLocaleString("es-AR", { maximumFractionDigits: 2 })}${prices.length > 1 && Math.max(...prices) !== price ? " (desde)" : ""}`,
      description: htmlToText(product.body_html),
      photos: (product.images ?? []).map((image) => image.src).filter((src): src is string => Boolean(src)).slice(0, 10),
      // Shopify no publica unidades: se sabe si hay o no. Sin ninguna variante disponible, figura agotado.
      stockQuantity: anyAvailable ? null : 0,
      details: variants.length > 1 ? { Variantes: String(variants.length) } : {},
    });
  });
}

async function readShopify(origin: string, fetchImpl: Fetch, deadline: number): Promise<ConnectorResult | null> {
  const products: ShopifyProduct[] = [];
  for (let page = 1; page <= 20; page++) {
    if (Date.now() > deadline) return { ok: true, items: shopifyToItems(products, origin), complete: false, via: "tienda Shopify" };
    const data = (await getJson(`${origin}/products.json?limit=250&page=${page}`, fetchImpl)) as { products?: ShopifyProduct[] } | undefined;
    if (!data || !Array.isArray(data.products)) return page === 1 ? null : { ok: true, items: shopifyToItems(products, origin), complete: true, via: "tienda Shopify" };
    products.push(...data.products);
    if (data.products.length < 250 || products.length >= MAX_CONNECTOR_ITEMS) break;
  }
  return products.length ? { ok: true, items: shopifyToItems(products, origin), complete: true, via: "tienda Shopify" } : null;
}

type WooProduct = {
  id: number;
  name: string;
  permalink?: string;
  sku?: string;
  short_description?: string;
  description?: string;
  prices?: { price?: string; currency_code?: string; currency_minor_unit?: number };
  is_in_stock?: boolean;
  low_stock_remaining?: number | null;
  images?: { src?: string }[];
  categories?: { name?: string }[];
  brands?: { name?: string }[];
};

export function wooToItems(products: WooProduct[]): CatalogItem[] {
  return products.map((product) => {
    const minor = product.prices?.currency_minor_unit ?? 2;
    const raw = product.prices?.price;
    const price = raw && /^\d+$/.test(raw) ? Number(raw) / 10 ** minor : null;
    const currency = str(product.prices?.currency_code)?.toUpperCase() ?? null;
    return baseItem({
      externalId: String(product.id),
      title: decodeEntities(product.name).slice(0, 200),
      url: str(product.permalink),
      sku: str(product.sku),
      brand: str(product.brands?.[0]?.name),
      category: str(product.categories?.[0]?.name),
      price,
      currency,
      priceText: priceText(price, currency),
      description: htmlToText(product.short_description || product.description),
      photos: (product.images ?? []).map((image) => image.src).filter((src): src is string => Boolean(src)).slice(0, 10),
      stockQuantity: product.is_in_stock === false ? 0 : typeof product.low_stock_remaining === "number" ? product.low_stock_remaining : null,
    });
  });
}

async function readWoo(origin: string, fetchImpl: Fetch, deadline: number): Promise<ConnectorResult | null> {
  const products: WooProduct[] = [];
  for (let page = 1; page <= 50; page++) {
    if (Date.now() > deadline) return { ok: true, items: wooToItems(products), complete: false, via: "tienda WooCommerce" };
    const data = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, fetchImpl);
    if (!Array.isArray(data)) return page === 1 ? null : { ok: true, items: wooToItems(products), complete: true, via: "tienda WooCommerce" };
    products.push(...(data as WooProduct[]));
    if (data.length < 100 || products.length >= MAX_CONNECTOR_ITEMS) break;
  }
  return products.length ? { ok: true, items: wooToItems(products), complete: true, via: "tienda WooCommerce" } : null;
}

// Datos de producto (schema.org) de una ficha: los bloques JSON-LD con @type Product, sueltos o dentro de @graph.
export function productsFromHtml(html: string, pageUrl: string): CatalogItem[] {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1] ?? "");
  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) found.push(record);
    if (record["@graph"]) visit(record["@graph"]);
  };
  for (const block of blocks) {
    try {
      visit(JSON.parse(block.trim()));
    } catch {
      // Un bloque mal escrito no corta la lectura de la página.
    }
  }

  return found.flatMap((product) => {
    const title = str(product.name);
    if (!title) return [];
    const offersRaw = product.offers;
    const offers = (Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : []) as Record<string, unknown>[];
    const offer = offers[0] ?? {};
    const price = num(offer.price) ?? num(offer.lowPrice);
    const currency = str(offer.priceCurrency)?.toUpperCase() ?? null;
    const availability = offers.map((item) => String(item.availability ?? "")).join(" ");
    const outOfStock = /OutOfStock|SoldOut|Discontinued/i.test(availability) && !/InStock/i.test(availability);
    const brand = product.brand;
    const image = product.image;
    const photos = (Array.isArray(image) ? image : image ? [image] : [])
      .map((entry) => (typeof entry === "string" ? entry : str((entry as Record<string, unknown>)?.url)))
      .filter((src): src is string => Boolean(src && /^https?:\/\//.test(src)))
      .slice(0, 10);
    const url = str(product.url) ?? str(offer.url) ?? pageUrl;
    const sku = str(product.sku) ?? str(product.mpn);
    return [
      baseItem({
        externalId: (sku ?? str(product.productID) ?? url).slice(0, 100),
        title: decodeEntities(title).slice(0, 200),
        url,
        sku,
        brand: typeof brand === "string" ? brand : str((brand as Record<string, unknown> | undefined)?.name),
        category: str(product.category),
        price,
        currency,
        priceText: priceText(price, currency),
        description: htmlToText(str(product.description)),
        photos,
        stockQuantity: outOfStock ? 0 : null,
      }),
    ];
  });
}

const PRODUCT_PATH = /\/(products?|productos?|p|item|articulo|tienda)\//i;

export function urlsFromSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => decodeEntities(match[1] ?? ""));
  const isIndex = /<sitemapindex/i.test(xml);
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}

async function readSitemapProducts(origin: string, fetchImpl: Fetch, deadline: number, maxPages: number): Promise<ConnectorResult> {
  const queue = [`${origin}/sitemap.xml`];
  const seen = new Set<string>();
  const pages: string[] = [];
  while (queue.length && seen.size < 20 && Date.now() < deadline) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    const response = await getText(next, fetchImpl, { Accept: "application/xml,text/xml" });
    if (!response || response.status !== 200) continue;
    const { pages: found, sitemaps } = urlsFromSitemap(response.text);
    // Primero los mapas de productos.
    queue.push(...sitemaps.sort((a, b) => Number(/product/i.test(b)) - Number(/product/i.test(a))));
    pages.push(...found.filter((page) => safeUrl(page)?.origin === origin));
  }
  if (pages.length === 0) return { ok: false, error: "No encontré productos: el sitio no es Shopify ni WooCommerce y no tiene un mapa del sitio (sitemap.xml) legible." };

  // Las fichas de producto primero; el resto (páginas institucionales) al final, por si la tienda usa otras rutas.
  const ordered = [...new Set(pages)].sort((a, b) => Number(PRODUCT_PATH.test(b)) - Number(PRODUCT_PATH.test(a))).slice(0, maxPages);
  const items = new Map<string, CatalogItem>();
  let index = 0;
  let complete = true;
  const worker = async () => {
    while (index < ordered.length) {
      if (Date.now() > deadline) {
        complete = false;
        return;
      }
      const page = ordered[index++] as string;
      const response = await getText(page, fetchImpl, { Accept: "text/html" });
      if (!response || response.status !== 200 || !response.type.includes("html")) continue;
      for (const item of productsFromHtml(response.text, page)) items.set(item.externalId, item);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (pages.length > maxPages) complete = false;

  if (items.size === 0) return { ok: false, error: "Leí el sitio pero sus páginas no publican datos de producto (schema.org). Conviene conectar la base o una planilla." };
  return { ok: true, items: [...items.values()], complete, via: "mapa del sitio" };
}

export async function readWebsite(siteUrl: string, options: { fetchImpl?: Fetch; deadline?: number; maxPages?: number } = {}): Promise<ConnectorResult> {
  const site = safeUrl(siteUrl);
  if (!site) return { ok: false, error: "La dirección del sitio tiene que empezar con https:// y ser un dominio público." };
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = options.deadline ?? Date.now() + 120_000;
  const origin = site.origin;

  return (
    (await readShopify(origin, fetchImpl, deadline)) ??
    (await readWoo(origin, fetchImpl, deadline)) ??
    (await readSitemapProducts(origin, fetchImpl, deadline, options.maxPages ?? 400))
  );
}
