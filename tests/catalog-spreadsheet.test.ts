import { describe, expect, it } from "vitest";

import { describeItem, searchCatalog, type CatalogItem } from "@/lib/catalog/search";
import { googleSheetCsvUrl, parseCsv, parsePrice, parseSpreadsheet } from "@/lib/catalog/spreadsheet";
import { fetchSheetCsv } from "@/lib/catalog/sources";

describe("parseCsv", () => {
  it("lee comillas, comillas escapadas y saltos de línea dentro de una celda", () => {
    expect(parseCsv('a,b\n"x, y","dijo ""hola""\nchau"\n')).toEqual([
      ["a", "b"],
      ["x, y", 'dijo "hola"\nchau'],
    ]);
  });

  it("detecta el punto y coma que exporta Excel en castellano y descarta filas vacías", () => {
    expect(parseCsv("Nombre;Precio\r\nSilla;1.500,50\r\n;\r\n")).toEqual([
      ["Nombre", "Precio"],
      ["Silla", "1.500,50"],
    ]);
  });
});

describe("parsePrice", () => {
  it.each([
    ["$ 1.234,50", 1234.5],
    ["1,234.50", 1234.5],
    ["USD 99", 99],
    ["15.000", 15000],
    ["12,5", 12.5],
    ["Consultar", null],
  ])("%s → %s", (text, expected) => expect(parsePrice(text)).toBe(expected));
});

describe("parseSpreadsheet", () => {
  const csv = [
    "Código,Producto,Marca,Categoría,Precio,Stock,Color,Activo",
    'A-1,"Zapatilla Run, azul",Nike,Calzado,"$ 89.900",12,Azul,sí',
    "A-2,Remera lisa,Adidas,Ropa,USD 20,0,Negro,sí",
    "A-3,Campera vieja,Adidas,Ropa,$ 5.000,3,Gris,no",
    ",,,,,,,",
  ].join("\n");

  it("reconoce encabezados en castellano y arma los ítems", () => {
    const result = parseSpreadsheet(csv);
    if (!result.ok) throw new Error(result.errors.join());
    expect(result.items).toHaveLength(3);
    const [shoe, shirt, old] = result.items as [CatalogItem, CatalogItem, CatalogItem];
    expect(shoe).toMatchObject({ externalId: "A-1", sku: "A-1", title: "Zapatilla Run, azul", brand: "Nike", category: "Calzado", price: 89900, currency: "ARS", stockQuantity: 12 });
    expect(shoe.details).toEqual({ Color: "Azul" });
    expect(shirt).toMatchObject({ price: 20, currency: "USD", stockQuantity: 0 });
    expect(old.isAvailable).toBe(false);
  });

  it("pide una columna de nombre si falta", () => {
    expect(parseSpreadsheet("Precio,Stock\n10,1")).toEqual({ ok: false, errors: expect.arrayContaining([expect.stringContaining("nombre del producto")]) });
  });

  it("usa el nombre como id cuando no hay código y saltea repetidos", () => {
    const result = parseSpreadsheet("Nombre,Precio\nMesa,100\nMesa,120\nSilla,50");
    if (!result.ok) throw new Error(result.errors.join());
    expect(result.items.map((item) => item.externalId)).toEqual(["Mesa", "Silla"]);
    expect(result.skipped).toBe(1);
  });

  it("el agente ve el stock: agotado marcado y filtrable", () => {
    const result = parseSpreadsheet(csv);
    if (!result.ok) throw new Error(result.errors.join());
    const [shoe, shirt] = result.items as [CatalogItem, CatalogItem];
    expect(describeItem(shirt)).toContain("AGOTADO");
    expect(describeItem(shoe)).toContain("12 unidades en stock");
    expect(describeItem(shoe)).toContain("marca Nike");
    expect(searchCatalog(result.items, { inStockOnly: true }).total).toBe(1);
    expect(searchCatalog(result.items, { keywords: ["nike"] }).total).toBe(1);
  });
});

describe("googleSheetCsvUrl", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

  it("convierte el enlace de la barra de direcciones, con la pestaña", () => {
    expect(googleSheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=345`)).toEqual({
      ok: true,
      url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=345`,
    });
  });

  it("rechaza cualquier otro sitio, http y enlaces sin planilla", () => {
    expect(googleSheetCsvUrl("https://evil.example.com/spreadsheets/d/" + id).ok).toBe(false);
    expect(googleSheetCsvUrl(`http://docs.google.com/spreadsheets/d/${id}`).ok).toBe(false);
    expect(googleSheetCsvUrl("https://docs.google.com/document/d/abc").ok).toBe(false);
    expect(googleSheetCsvUrl("no es un enlace").ok).toBe(false);
  });
});

describe("fetchSheetCsv", () => {
  const url = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=csv";
  const reply = (body: string, init: ResponseInit & { url?: string } = {}) => {
    const response = new Response(body, { status: 200, headers: { "content-type": "text/csv" }, ...init });
    Object.defineProperty(response, "url", { value: init.url ?? url });
    return response;
  };

  it("devuelve el texto de una planilla pública", async () => {
    expect(await fetchSheetCsv(url, async () => reply("Nombre\nMesa"))).toEqual({ ok: true, text: "Nombre\nMesa" });
  });

  it("explica que la planilla no es pública cuando Google devuelve la página de ingreso", async () => {
    const result = await fetchSheetCsv(url, async () => reply("<html>", { headers: { "content-type": "text/html" } }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("no es pública") });
  });

  it("no lee nada si termina en un sitio que no es de Google", async () => {
    const result = await fetchSheetCsv(url, async () => reply("Nombre\nMesa", { url: "https://evil.example.com/x.csv" }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("inesperado") });
  });

  it("no se cuelga si la conexión falla", async () => {
    expect(await fetchSheetCsv(url, async () => Promise.reject(new Error("red")))).toMatchObject({ ok: false });
  });
});
