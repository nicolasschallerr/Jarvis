import { normalize, type CatalogItem } from "./search";

// Lector de planillas de stock (ADR-045): un CSV (el que exporta Google Sheets, o un Excel guardado como CSV) pasa a
// ítems del catálogo. Reconoce los encabezados más comunes en español e inglés, así la tienda no tiene que
// reformatear su planilla.

// Separa el CSV en filas y celdas (RFC 4180: comillas dobles, comillas escapadas duplicadas, saltos de línea dentro
// de una celda). Detecta si el separador es coma o punto y coma (Excel en castellano exporta con punto y coma).
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

type Field = "id" | "title" | "sku" | "brand" | "category" | "price" | "currency" | "stock" | "description" | "photo" | "url" | "available";

// Encabezado normalizado (sin tildes, mayúsculas ni signos) → campo.
const HEADERS: Record<Field, string[]> = {
  id: ["id", "id externo", "idexterno", "codigo interno", "external id"],
  title: ["titulo", "nombre", "producto", "articulo", "item", "title", "name", "product", "descripcion corta"],
  sku: ["sku", "codigo", "cod", "referencia", "ref", "code"],
  brand: ["marca", "brand", "fabricante"],
  category: ["categoria", "rubro", "tipo", "familia", "category", "type"],
  price: ["precio", "precio venta", "precio de venta", "pvp", "price", "importe"],
  currency: ["moneda", "currency", "divisa"],
  stock: ["stock", "cantidad", "unidades", "existencias", "disponible", "qty", "quantity", "inventario"],
  description: ["descripcion", "detalle", "description", "detalles"],
  photo: ["imagen", "foto", "imagenes", "fotos", "image", "photo", "url imagen", "url foto"],
  url: ["url", "link", "enlace", "web", "url producto", "pagina"],
  available: ["activo", "publicado", "visible", "habilitado", "active", "published"],
};

function headerKey(raw: string): string {
  return normalize(raw).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Cada columna del encabezado se asigna al primer campo que la reconoce; las demás quedan como "detalles".
function mapColumns(header: string[]): { fields: Partial<Record<Field, number>>; extra: { name: string; index: number }[] } {
  const fields: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(HEADERS) as Field[]) {
    const index = header.findIndex((name, position) => !used.has(position) && HEADERS[field].includes(headerKey(name)));
    if (index >= 0) {
      fields[field] = index;
      used.add(index);
    }
  }
  const extra = header.map((name, index) => ({ name: name.trim(), index })).filter(({ name, index }) => name && !used.has(index));
  return { fields, extra };
}

// "$ 1.234,50" → 1234.5, "1,234.50" → 1234.5, "USD 99" → 99. Devuelve null si no hay un número claro.
export function parsePrice(text: string): number | null {
  const digits = text.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(digits)) return null;
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // El último separador es el decimal.
    normalized = lastComma > lastDot ? digits.replace(/\./g, "").replace(",", ".") : digits.replace(/,/g, "");
  } else if (lastComma >= 0 || lastDot >= 0) {
    // Un solo tipo de separador: con exactamente tres dígitos después es de miles ("89.900" son noventa mil), si no
    // es el decimal ("12,5"). Los precios con tres decimales no existen.
    const separator = lastComma >= 0 ? "," : ".";
    const decimals = digits.length - digits.lastIndexOf(separator) - 1;
    normalized = decimals === 3 ? digits.split(separator).join("") : digits.split(separator).join(".");
  } else normalized = digits;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function detectCurrency(priceCell: string, currencyCell: string | undefined): string | null {
  const text = `${currencyCell ?? ""} ${priceCell}`.toUpperCase();
  if (/USD|U\$S|US\$|DOLAR|DÓLAR/.test(text)) return "USD";
  if (/ARS|\$|PESO/.test(text)) return "ARS";
  return null;
}

const FALSE_VALUES = new Set(["no", "false", "0", "inactivo", "oculto", "n", "baja"]);

export type SpreadsheetResult = { ok: true; items: CatalogItem[]; skipped: number } | { ok: false; errors: string[] };

export const MAX_SPREADSHEET_ITEMS = 5000;

export function parseSpreadsheet(text: string): SpreadsheetResult {
  return parseTable(parseCsv(text));
}

// Una tabla cualquiera (la primera fila son los encabezados) pasa a ítems. La usan la planilla y la base del cliente.
export function parseTable(rows: string[][]): SpreadsheetResult {
  if (rows.length < 2) return { ok: false, errors: ["La planilla está vacía: tiene que tener una fila de encabezados y al menos un producto."] };

  const [header = [], ...body] = rows;
  const { fields, extra } = mapColumns(header);
  if (fields.title === undefined) {
    return { ok: false, errors: ['No encuentro la columna con el nombre del producto. Llamala "Nombre", "Producto" o "Título".'] };
  }
  if (body.length > MAX_SPREADSHEET_ITEMS) return { ok: false, errors: [`La planilla tiene más de ${MAX_SPREADSHEET_ITEMS} productos: dividila en dos.`] };

  const cell = (row: string[], field: Field): string => (fields[field] === undefined ? "" : (row[fields[field]] ?? "").trim());
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const row of body) {
    const title = cell(row, "title");
    // Id estable: el id de la planilla, si no el SKU, si no el nombre (así volver a cargar no duplica).
    const externalId = cell(row, "id") || cell(row, "sku") || title;
    if (!title || seen.has(externalId)) {
      skipped++;
      continue;
    }
    seen.add(externalId);

    const priceCell = cell(row, "price");
    const stockText = cell(row, "stock");
    const stockNumber = stockText === "" ? null : parsePrice(stockText);
    const availableCell = normalize(cell(row, "available"));
    const details: Record<string, string> = {};
    for (const { name, index } of extra) {
      const value = (row[index] ?? "").trim();
      if (value) details[name] = value.slice(0, 300);
    }

    const price = priceCell ? parsePrice(priceCell) : null;
    const currency = price === null ? null : detectCurrency(priceCell, cell(row, "currency"));
    const url = cell(row, "url");
    const photos = cell(row, "photo")
      .split(/[\s,;|]+/)
      .filter((value) => /^https?:\/\//i.test(value))
      .slice(0, 10);

    items.push({
      externalId: externalId.slice(0, 100),
      url: /^https?:\/\//i.test(url) ? url : null,
      operation: null,
      category: cell(row, "category") || null,
      title: title.slice(0, 200),
      zone: null,
      locality: null,
      price,
      currency,
      priceText: priceCell || null,
      areaM2: null,
      bedrooms: null,
      bathrooms: null,
      description: cell(row, "description").slice(0, 10000) || null,
      details,
      photos,
      // Una columna "activo/publicado" con no/false/0 da de baja el producto sin borrarlo de la planilla.
      isAvailable: !FALSE_VALUES.has(availableCell),
      sku: cell(row, "sku") || null,
      brand: cell(row, "brand") || null,
      stockQuantity: stockNumber === null ? null : Math.floor(stockNumber),
    });
  }

  if (items.length === 0) return { ok: false, errors: ["No encontré productos con nombre en la planilla."] };
  return { ok: true, items, skipped };
}

// Dirección de exportación a CSV de una planilla de Google Sheets. Acepta el enlace de la barra de direcciones
// (con /edit#gid=…) o el de "Compartir". La planilla tiene que estar compartida como "cualquiera con el enlace puede
// ver". Solo acepta docs.google.com: nunca una dirección cualquiera (ver ADR-045, sobre pedidos del servidor).
export function googleSheetCsvUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { ok: false, error: "Eso no parece un enlace." };
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "docs.google.com") {
    return { ok: false, error: "Tiene que ser un enlace de Google Sheets (docs.google.com)." };
  }
  const id = parsed.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  if (!id) return { ok: false, error: "No encuentro el identificador de la planilla en el enlace." };
  const gid = (parsed.hash.match(/gid=(\d+)/) ?? parsed.search.match(/gid=(\d+)/))?.[1];
  return { ok: true, url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}` };
}
