import { describe, expect, it } from "vitest";

import { productsFromHtml, readSupabaseTable, readWebsite, recordsToRows, safeUrl, urlsFromSitemap } from "@/lib/catalog/connectors";
import { readSource } from "@/lib/catalog/sources";
import { configuredSources, parseClientConfig } from "@/lib/client-config/load";

// fetch falso: responde según la dirección pedida; lo demás es 404.
function fakeFetch(routes: Record<string, { body: unknown; type?: string; status?: number }>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const headers = new Headers(init?.headers);
    const route = Object.entries(routes).find(([pattern]) => url.startsWith(pattern))?.[1];
    if (route && routes.__auth && headers.get("apikey") !== "clave-buena") return withUrl(new Response("[]", { status: 401 }), url);
    if (!route) return withUrl(new Response("no", { status: 404, headers: { "content-type": "text/html" } }), url);
    const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return withUrl(new Response(body, { status: route.status ?? 200, headers: { "content-type": route.type ?? "application/json" } }), url);
  }) as typeof fetch;
}

function withUrl(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("safeUrl", () => {
  it("acepta https a dominios públicos", () => {
    expect(safeUrl("https://mitienda.com.ar/productos")?.origin).toBe("https://mitienda.com.ar");
  });

  it.each(["http://mitienda.com", "https://localhost/x", "https://127.0.0.1/", "https://10.0.0.5", "https://[::1]/", "https://intranet/", "https://a.internal", "https://user:pass@site.com", "https://site.com:8443", "ftp://site.com"])(
    "rechaza %s",
    (url) => expect(safeUrl(url)).toBeNull(),
  );
});

describe("sitio web", () => {
  it("lee una tienda Shopify: precio desde la variante más barata y agotado sin variantes disponibles", async () => {
    const fetchImpl = fakeFetch({
      "https://tienda.com/products.json?limit=250&page=1": {
        body: {
          products: [
            { id: 1, title: "Zapatilla", handle: "zapatilla", vendor: "Nike", product_type: "Calzado", body_html: "<p>Liviana &amp; cómoda</p>", variants: [{ price: "89900.00", sku: "Z-1", available: true }, { price: "95000.00", available: false }], images: [{ src: "https://cdn.shopify.com/a.jpg" }] },
            { id: 2, title: "Remera", handle: "remera", variants: [{ price: "15500", available: false }] },
          ],
        },
      },
    });
    const result = await readWebsite("https://tienda.com", { fetchImpl });
    if (!result.ok) throw new Error(result.error);
    expect(result.via).toBe("tienda Shopify");
    expect(result.items[0]).toMatchObject({ externalId: "1", title: "Zapatilla", brand: "Nike", category: "Calzado", sku: "Z-1", price: 89900, url: "https://tienda.com/products/zapatilla", description: "Liviana & cómoda", stockQuantity: null });
    expect(result.items[0]?.priceText).toContain("desde");
    expect(result.items[1]?.stockQuantity).toBe(0);
  });

  it("lee WooCommerce con precios en centavos y stock bajo", async () => {
    const fetchImpl = fakeFetch({
      "https://woo.com/wp-json/wc/store/v1/products?per_page=100&page=1": {
        body: [{ id: 7, name: "Mochila &amp; más", permalink: "https://woo.com/p/mochila", sku: "M-7", prices: { price: "4200000", currency_code: "ARS", currency_minor_unit: 2 }, is_in_stock: true, low_stock_remaining: 2, categories: [{ name: "Accesorios" }] }],
      },
    });
    const result = await readWebsite("https://woo.com", { fetchImpl });
    if (!result.ok) throw new Error(result.error);
    expect(result.via).toBe("tienda WooCommerce");
    expect(result.items[0]).toMatchObject({ title: "Mochila & más", price: 42000, currency: "ARS", stockQuantity: 2, category: "Accesorios" });
  });

  it("si no es una plataforma conocida, recorre el mapa del sitio y lee los datos de producto de cada ficha", async () => {
    const ficha = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"Product","name":"Termo 1L","sku":"T-1","brand":{"name":"Stanley"},"image":["https://img.com/t.jpg"],"offers":{"@type":"Offer","price":"65000","priceCurrency":"ARS","availability":"https://schema.org/OutOfStock"}}]}</script></html>`;
    const fetchImpl = fakeFetch({
      "https://otra.com/sitemap.xml": { type: "application/xml", body: '<sitemapindex><sitemap><loc>https://otra.com/sitemap-productos.xml</loc></sitemap></sitemapindex>' },
      "https://otra.com/sitemap-productos.xml": { type: "application/xml", body: "<urlset><url><loc>https://otra.com/productos/termo</loc></url><url><loc>https://evil.com/x</loc></url></urlset>" },
      "https://otra.com/productos/termo": { type: "text/html; charset=utf-8", body: ficha },
    });
    const result = await readWebsite("https://otra.com", { fetchImpl });
    if (!result.ok) throw new Error(result.error);
    expect(result.via).toBe("mapa del sitio");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ externalId: "T-1", title: "Termo 1L", brand: "Stanley", price: 65000, currency: "ARS", stockQuantity: 0, url: "https://otra.com/productos/termo" });
  });

  it("explica qué pasó cuando no encuentra productos", async () => {
    const result = await readWebsite("https://vacia.com", { fetchImpl: fakeFetch({}) });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("sitemap") });
  });

  it("con el tiempo vencido devuelve la lectura como incompleta (no se da de baja lo que falta)", async () => {
    const fetchImpl = fakeFetch({ "https://tienda.com/products.json?limit=250&page=1": { body: { products: [{ id: 1, title: "A", handle: "a" }] } } });
    const result = await readWebsite("https://tienda.com", { fetchImpl, deadline: Date.now() - 1 });
    expect(result).toMatchObject({ ok: true, complete: false });
  });

  it("separa el índice de mapas de las páginas", () => {
    expect(urlsFromSitemap("<urlset><url><loc> https://a.com/x?a=1&amp;b=2 </loc></url></urlset>").pages).toEqual(["https://a.com/x?a=1&b=2"]);
    expect(productsFromHtml("<html>sin datos</html>", "https://a.com")).toEqual([]);
  });
});

describe("base Supabase del cliente", () => {
  const config = { url: "https://abcd.supabase.co", table: "products", key: "clave-buena" };

  it("lee la tabla y reconoce las columnas; `columnas` traduce las de nombre raro", async () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch(
      { __auth: { body: "" }, "https://abcd.supabase.co/rest/v1/products": { body: [{ id: 10, nombre: "Silla", precio: 50000, cant_disp: 4, tags: ["madera"], meta: { x: 1 } }] } },
      calls,
    );
    const result = await readSupabaseTable({ ...config, columns: { stock: "cant_disp" } }, fetchImpl);
    if (!result.ok) throw new Error(result.error);
    expect(result.items[0]).toMatchObject({ externalId: "10", title: "Silla", price: 50000, stockQuantity: 4 });
    expect(result.items[0]?.details).toEqual({ tags: "madera" });
    expect(calls[0]).toContain("select=*&limit=1000&offset=0");
  });

  it("avisa si la clave es rechazada, y solo acepta proyectos de supabase.co con nombres de tabla válidos", async () => {
    const fetchImpl = fakeFetch({ __auth: { body: "" }, "https://abcd.supabase.co/rest/v1/products": { body: [] } });
    expect(await readSupabaseTable({ ...config, key: "otra" }, fetchImpl)).toMatchObject({ ok: false, error: expect.stringContaining("clave") });
    expect(await readSupabaseTable({ ...config, url: "https://evil.com" }, fetchImpl)).toMatchObject({ ok: false });
    expect(await readSupabaseTable({ ...config, table: "products;drop" }, fetchImpl)).toMatchObject({ ok: false });
  });

  it("recordsToRows arma encabezados con todas las columnas", () => {
    expect(recordsToRows([{ a: 1 }, { b: "x" }], { nombre: "a" })).toEqual([["nombre", "b"], ["1", ""], ["", "x"]]);
  });

  it("la clave sale de una variable CATALOGO_… y nunca de otra", async () => {
    const env = { CATALOGO_TIENDA: "clave-buena", SUPABASE_SERVICE_ROLE_KEY: "secreto" };
    const fetchImpl = fakeFetch({ __auth: { body: "" }, "https://abcd.supabase.co/rest/v1/products": { body: [{ nombre: "Mesa" }] } });
    expect(await readSource("supabase", { url: config.url, table: "products", keyEnv: "CATALOGO_TIENDA" }, { env, fetchImpl })).toMatchObject({ ok: true });
    expect(await readSource("supabase", { url: config.url, table: "products", keyEnv: "SUPABASE_SERVICE_ROLE_KEY" }, { env, fetchImpl })).toMatchObject({ ok: false, error: expect.stringContaining("CATALOGO_") });
    expect(await readSource("supabase", { url: config.url, table: "products", keyEnv: "CATALOGO_FALTA" }, { env, fetchImpl })).toMatchObject({ ok: false, error: expect.stringContaining("Falta") });
  });
});

describe("fuentes en la configuración del cliente", () => {
  const base = ["organizacion:", "  slug: tienda", "  nombre: Tienda", "unidades:", "  - { id: u, nombre: U, sector: s }", "sectores:", "  - { id: s, nombre: S }"];

  it("traduce las fuentes del YAML sin guardar claves", () => {
    const parsed = parseClientConfig(
      [
        ...base,
        "catalogo:",
        "  activo: true",
        "  fuentes:",
        "    - { tipo: supabase, nombre: Base, url: 'https://abcd.supabase.co', tabla: products, clave_env: CATALOGO_TIENDA, columnas: { stock: qty } }",
        "    - { tipo: web, nombre: Web, url: 'https://tienda.com', cada_horas: 12 }",
      ].join("\n"),
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    expect(configuredSources(parsed.config)).toEqual([
      { name: "Base", kind: "supabase", config: { url: "https://abcd.supabase.co", table: "products", keyEnv: "CATALOGO_TIENDA", columns: { stock: "qty" } }, syncEveryHours: 1 },
      { name: "Web", kind: "web", config: { url: "https://tienda.com" }, syncEveryHours: 12 },
    ]);
  });

  it("rechaza una clave escrita en el archivo, una variable sin prefijo y nombres repetidos", () => {
    const bad = (fuente: string) => parseClientConfig([...base, "catalogo:", "  fuentes:", `    - ${fuente}`, `    - ${fuente}`].join("\n"));
    expect(bad("{ tipo: supabase, nombre: B, url: 'https://abcd.supabase.co', tabla: t, clave_env: SUPABASE_SERVICE_ROLE_KEY }").ok).toBe(false);
    expect(bad("{ tipo: web, nombre: W, url: 'http://tienda.com' }").ok).toBe(false);
    expect(bad("{ tipo: web, nombre: W, url: 'https://tienda.com' }").ok).toBe(false);
  });
});
