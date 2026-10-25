"use client";

import { AlertIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";

// Si una sección del CRM falla al cargar, se ve esto en vez de la pantalla genérica: el menú sigue disponible y
// se puede reintentar. El detalle técnico no se muestra (puede tener datos); queda en el registro del servidor.
export default function CrmError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex flex-1 flex-col justify-center">
      <EmptyState
        icon={<AlertIcon className="size-5" />}
        title="No pudimos cargar esta sección"
        description="Puede ser un corte momentáneo de conexión. Probá de nuevo en unos segundos; si sigue pasando, avisale a quien administra Jarvis."
        action={
          <button type="button" onClick={() => retry()} className="btn-primary">
            Reintentar
          </button>
        }
      />
    </main>
  );
}
