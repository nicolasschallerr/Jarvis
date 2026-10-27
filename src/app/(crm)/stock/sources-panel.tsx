import { StatusDot } from "@/components/agents/agent-card";
import { Badge } from "@/components/ui/badge";
import { dateTime } from "@/lib/crm/format";

export type SourceView = {
  id: string;
  kind: string;
  name: string;
  syncEveryHours: number | null;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  itemCount: number;
};

const KIND_LABEL: Record<string, string> = { sheet: "Planilla de Google", file: "Archivo", web: "Sitio web", supabase: "Base de datos" };

function every(hours: number | null): string {
  if (!hours) return "Sin actualización automática";
  if (hours === 1) return "Se actualiza cada hora";
  if (hours % 24 === 0) return hours === 24 ? "Se actualiza una vez por día" : `Se actualiza cada ${hours / 24} días`;
  return `Se actualiza cada ${hours} horas`;
}

// De dónde sale el stock (ADR-047). Lo configura el equipo de Orbita AI y el CRM lo lee solo: acá el cliente ve qué
// está conectado, cuándo se leyó y si algo falló. No hay nada para conectar a mano.
export function SourcesPanel({ sources }: { sources: SourceView[] }) {
  if (sources.length === 0) return null;

  return (
    <section aria-labelledby="conexiones" className="border-b border-line px-4 py-4 sm:px-6">
      <h2 id="conexiones" className="eyebrow mb-3">
        Conectado a
      </h2>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sources.map((source) => {
          const failed = source.lastStatus === "error";
          return (
            <li key={source.id} className="card flex items-start gap-3 p-4">
              <span className="mt-1.5">
                <StatusDot tone={failed ? "waiting" : source.lastStatus === "ok" ? "ready" : "off"} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium">{source.name}</p>
                  <Badge tone="neutral">{KIND_LABEL[source.kind] ?? source.kind}</Badge>
                </div>
                <p className="text-sm text-muted">
                  {source.lastSyncedAt ? `Última lectura ${dateTime(source.lastSyncedAt)}` : "Conectando: la primera lectura está en camino"} · {every(source.syncEveryHours)}
                </p>
                {failed ? (
                  <p className="text-sm text-warning">No se pudo leer la última vez: {source.lastMessage}. El equipo de Orbita AI ya lo ve.</p>
                ) : source.lastMessage ? (
                  <p className="text-sm text-muted">{source.lastMessage}</p>
                ) : null}
              </div>
              <span className="font-mono text-sm tabular-nums text-muted">{source.itemCount.toLocaleString("es-AR")}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
