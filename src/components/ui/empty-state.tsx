import { LockIcon } from "./icons";

// Estado vacío: un ícono, qué pasa y, si corresponde, qué se puede hacer. Mejor que una línea gris suelta.
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${compact ? "px-4 py-6" : "px-6 py-14"}`}>
      {icon ? <div className="mb-1 grid size-11 place-items-center rounded-full bg-accent-soft text-accent">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

// Página para quien no tiene permiso: el mismo encabezado que el resto y una explicación clara.
export function NoAccess({ title, reason }: { title: string; reason: string }) {
  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-line px-4 pt-5 pb-4 sm:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
      </header>
      <EmptyState icon={<LockIcon className="size-5" />} title="No tenés acceso a esta sección" description={reason} />
    </main>
  );
}
