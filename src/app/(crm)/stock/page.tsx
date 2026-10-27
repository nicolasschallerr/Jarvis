import Link from "next/link";
import { connection } from "next/server";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchIcon, StockIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { normalize, type CatalogItem } from "@/lib/catalog/search";
import { rowToItem } from "@/lib/catalog/source";
import { dateTime } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Stock" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const PAGE_SIZE = 24;

// Catálogo de stock que consulta el agente de atención (ADR-043): el equipo ve exactamente lo mismo que el agente,
// y cuándo se actualizó por última vez. Solo lectura: se carga con scripts/cargar-catalogo.mts.

function stockHref(params: { op?: string; q?: string; ver?: number; bajas?: boolean }): string {
  const search = new URLSearchParams();
  if (params.op) search.set("op", params.op);
  if (params.q) search.set("q", params.q);
  if (params.ver) search.set("ver", String(params.ver));
  if (params.bajas) search.set("bajas", "1");
  const text = search.toString();
  return text ? `/stock?${text}` : "/stock";
}

// Filtro tipo píldora: el activo con el color de acento.
function pill(active: boolean): string {
  return `rounded-full border px-3 py-1 text-sm font-medium transition ${
    active ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-zinc-400 hover:text-foreground"
  }`;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function matchesText(item: CatalogItem, text: string): boolean {
  if (!text) return true;
  const haystack = normalize([item.externalId, item.title, item.category, item.zone, item.locality, item.description].join(" "));
  return normalize(text).split(/\s+/).every((word) => haystack.includes(word));
}

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  await connection();
  const params = await searchParams;
  const operation = first(params.op);
  const text = first(params.q).slice(0, 80);
  const showGone = first(params.bajas) === "1";
  const limit = Math.min(Math.max(Number(first(params.ver)) || PAGE_SIZE, PAGE_SIZE), 500);

  const supabase = await createClient();
  const [{ data: rows, error }, { data: agent }] = await Promise.all([
    supabase.from("catalog_items").select("*").order("synced_at", { ascending: false }).limit(5000),
    supabase.from("agents").select("name").eq("kind", "attention").maybeSingle(),
  ]);

  const all = (rows ?? []).map(rowToItem);
  const lastSync = rows?.reduce<string | null>((latest, row) => (!latest || row.synced_at > latest ? row.synced_at : latest), null) ?? null;
  const available = all.filter((item) => item.isAvailable);
  const operations = [...new Set(available.map((item) => item.operation).filter((value): value is string => Boolean(value)))].sort();
  const filtered = (showGone ? all.filter((item) => !item.isAvailable) : available)
    .filter((item) => !operation || item.operation === operation)
    .filter((item) => matchesText(item, text))
    .sort((a, b) => Number(b.externalId) - Number(a.externalId) || a.title.localeCompare(b.title, "es"));
  const gone = all.length - available.length;

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader
        title="Stock"
        description={`El catálogo que consulta ${agent?.name ?? "el agente"} para responder. ${lastSync ? `Última actualización: ${dateTime(lastSync)}.` : ""}`}
        actions={
          <form action="/stock" className="relative w-full sm:w-80" role="search">
            {operation ? <input type="hidden" name="op" value={operation} /> : null}
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input type="search" name="q" defaultValue={text} placeholder="Dirección, zona, tipo o número de ficha" aria-label="Buscar en el stock" className="field w-full !pl-9" />
          </form>
        }
      />

      {error ? (
        <p role="alert" className="m-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger sm:m-6">
          No se pudo cargar el stock. Probá recargar la página.
        </p>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<StockIcon className="size-5" />}
          title="Todavía no hay stock cargado"
          description="Cuando se cargue el catálogo del cliente, el agente lo va a usar para responder y lo vas a ver acá."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-6">
            <Link href={stockHref({ q: text })} className={pill(!operation && !showGone)}>
              Disponibles · {available.length}
            </Link>
            {operations.map((op) => (
              <Link key={op} href={stockHref({ op, q: text })} className={pill(operation === op && !showGone)}>
                {op.charAt(0).toUpperCase() + op.slice(1)} · {available.filter((item) => item.operation === op).length}
              </Link>
            ))}
            {gone > 0 ? (
              <Link href={stockHref({ bajas: true, q: text })} className={pill(showGone)}>
                Ya no publicadas · {gone}
              </Link>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={<SearchIcon className="size-5" />} title="No hay nada con esa búsqueda" description="Probá con otra palabra o sacá el filtro." />
          ) : (
            <ul className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3 2xl:grid-cols-4">
              {filtered.slice(0, limit).map((item) => (
                <li key={item.externalId} className="overflow-hidden rounded-xl border border-line bg-surface">
                  <div className="relative aspect-[4/3] bg-zinc-200/60 dark:bg-zinc-800">
                    {item.photos[0] ? (
                      // Fotos de la web del cliente: se muestran tal cual, sin pasar por el optimizador de imágenes.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.photos[0]} alt="" loading="lazy" className="size-full object-cover" />
                    ) : null}
                    <span className="absolute top-2 left-2 flex gap-1.5">
                      {item.operation ? <Badge tone={item.operation === "alquiler" ? "info" : "accent"}>{item.operation}</Badge> : null}
                      {!item.isAvailable ? <Badge tone="warning">Ya no publicada</Badge> : null}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 p-3.5">
                    <p className="text-lg font-semibold">{item.priceText || "Precio a consultar"}</p>
                    <p className="truncate font-medium">{item.title}</p>
                    <p className="truncate text-sm text-muted">
                      {[item.category, item.zone === "Otra" ? item.locality : item.zone].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-sm text-muted">
                      {[
                        item.areaM2 ? `${item.areaM2.toLocaleString("es-AR")} m²` : null,
                        item.bedrooms ? `${item.bedrooms} dorm.` : null,
                        item.bathrooms ? `${item.bathrooms} baño${item.bathrooms > 1 ? "s" : ""}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || " "}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted">
                      <span>Ficha #{item.externalId}</span>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
                          Ver en la web
                        </a>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {filtered.length > limit ? (
            <div className="flex justify-center p-4">
              <Link href={stockHref({ op: operation, q: text, ver: limit + PAGE_SIZE, bajas: showGone })} className="btn-secondary" scroll={false}>
                Ver más
              </Link>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
