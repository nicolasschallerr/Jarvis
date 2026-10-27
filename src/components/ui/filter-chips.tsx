"use client";

import Link from "next/link";

export type FilterChip = { href: string; label: string; active: boolean; dot?: string };

// Filtro tipo píldora: el activo con el color de acento (el mismo patrón que la página de stock).
export function chipClass(active: boolean): string {
  return `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition ${
    active ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-zinc-400 hover:text-foreground"
  }`;
}

// Grupo de filtros con enlaces: cada combinación es una URL (se comparte y "Atrás" vuelve al filtro anterior).
// `aria-current` marca el activo para el lector de pantalla, igual que las pestañas.
export function FilterChips({ label, items }: { label: string; items: FilterChip[] }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.active ? "true" : undefined} className={chipClass(item.active)}>
          {item.dot ? <span className={`size-1.5 rounded-full ${item.dot}`} aria-hidden="true" /> : null}
          {item.label}
        </Link>
      ))}
    </div>
  );
}

// Selector compacto que se envía solo al cambiar (para listas largas, donde las píldoras ocuparían varias filas).
// Es un formulario GET común: sin JavaScript sigue funcionando con el botón "Ver", que se oculta cuando hay JS.
export function AutoSubmitSelect({
  action,
  label,
  name,
  value,
  placeholder,
  options,
  hidden,
}: {
  action: string;
  label: string;
  name: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  hidden: Record<string, string>;
}) {
  return (
    <form method="get" action={action} className="flex items-center gap-2">
      {Object.entries(hidden).map(([key, hiddenValue]) => (
        <input key={key} type="hidden" name={key} value={hiddenValue} />
      ))}
      <select
        name={name}
        defaultValue={value}
        aria-label={label}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className={`field !w-auto !rounded-full !py-1 text-sm ${value ? "!border-accent !text-accent" : ""}`}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn-secondary !py-1 text-sm">
          Ver
        </button>
      </noscript>
    </form>
  );
}
