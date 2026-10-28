import Link from "next/link";

export type TabItem = { href: string; label: string; active: boolean; count?: number };

// Pestañas que son enlaces (cada una es una URL: se puede compartir y volver con "Atrás"). Un solo estilo de
// "seleccionado" para todo el CRM.
export function LinkTabs({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition duration-150 ${
            item.active ? "bg-accent-soft text-accent" : "text-muted hover:bg-zinc-200/60 hover:text-foreground dark:hover:bg-zinc-800"
          }`}
        >
          {item.label}
          {item.count !== undefined ? (
            <span className={`rounded-full px-1.5 text-xs tabular-nums ${item.active ? "bg-accent text-accent-foreground" : "bg-zinc-200 dark:bg-zinc-800"}`}>
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

// Selector de pocas opciones (por ejemplo, Tablero / Lista), también con enlaces. Si no entra en el ancho (en celular,
// los canales), se desliza de costado en vez de salirse de la pantalla.
export function SegmentedLinks({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface p-0.5 [scrollbar-width:none]">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition duration-150 ${
            item.active ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
