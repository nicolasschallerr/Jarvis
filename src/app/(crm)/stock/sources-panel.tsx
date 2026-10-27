"use client";

import { useActionState, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { dateTime } from "@/lib/crm/format";

import { addFileAction, addSheetAction, deleteSourceAction, syncSourceAction, type SourceFormState } from "./actions";

export type SourceView = {
  id: string;
  kind: string;
  name: string;
  detail: string | null;
  syncEveryHours: number | null;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  itemCount: number;
};

const INITIAL: SourceFormState = { error: null, message: null };

const KIND_LABEL: Record<string, string> = { sheet: "Google Sheets", file: "Archivo CSV", web: "Sitio web", supabase: "Base de datos" };

function Feedback({ state }: { state: SourceFormState }) {
  if (state.error) return <p role="alert" className="text-sm text-danger">{state.error}</p>;
  if (state.message) return <p role="status" className="text-sm text-success">{state.message}</p>;
  return null;
}

function SourceRow({ source }: { source: SourceView }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SourceFormState>(INITIAL);
  const [fileState, fileAction, filePending] = useActionState(addFileAction, INITIAL);

  const run = (task: () => Promise<SourceFormState>) => startTransition(async () => setResult(await task()));

  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{source.name}</p>
        <Badge tone="neutral">{KIND_LABEL[source.kind] ?? source.kind}</Badge>
        {source.lastStatus === "error" ? <Badge tone="danger">Con error</Badge> : source.lastStatus === "ok" ? <Badge tone="success">Al día</Badge> : null}
        <span className="ml-auto text-sm text-muted">{source.itemCount} productos</span>
      </div>
      <p className="text-sm text-muted">
        {source.lastSyncedAt ? `Última lectura: ${dateTime(source.lastSyncedAt)}. ` : "Todavía no se leyó. "}
        {source.syncEveryHours ? `Se vuelve a leer cada ${source.syncEveryHours} h.` : source.kind === "file" ? "Se actualiza subiendo el archivo de nuevo." : "Se lee a mano."}
      </p>
      {source.lastMessage ? <p className={`text-sm ${source.lastStatus === "error" ? "text-danger" : "text-muted"}`}>{source.lastMessage}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {source.kind === "sheet" ? (
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(() => syncSourceAction(source.id))}>
            {pending ? "Leyendo..." : "Sincronizar ahora"}
          </button>
        ) : null}
        {source.kind === "file" ? (
          <form action={fileAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="sourceId" value={source.id} />
            <input type="file" name="file" accept=".csv,text/csv" required aria-label={`Archivo nuevo para ${source.name}`} className="text-sm" />
            <button type="submit" className="btn-secondary" disabled={filePending}>
              {filePending ? "Subiendo..." : "Actualizar"}
            </button>
          </form>
        ) : null}
        <button
          type="button"
          className="btn-secondary !text-danger"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`¿Quitar "${source.name}"? Sus productos dejan de estar disponibles para el agente.`)) run(() => deleteSourceAction(source.id));
          }}
        >
          Quitar
        </button>
      </div>
      <Feedback state={fileState.error || fileState.message ? fileState : result} />
    </li>
  );
}

export function SourcesPanel({ sources, canEdit }: { sources: SourceView[]; canEdit: boolean }) {
  const [sheetState, sheetAction, sheetPending] = useActionState(addSheetAction, INITIAL);
  const [fileState, fileAction, filePending] = useActionState(addFileAction, INITIAL);

  return (
    <section aria-labelledby="fuentes" className="flex flex-col gap-4 border-b border-line px-4 py-5 sm:px-6">
      <div>
        <h2 id="fuentes" className="font-display text-lg font-semibold">
          Fuentes de stock
        </h2>
        <p className="text-sm text-muted">
          De acá lee el agente. Podés conectar una planilla de Google Sheets (se vuelve a leer sola) o subir un CSV exportado de Excel. Con columnas como Nombre, SKU, Marca, Categoría, Precio, Stock,
          Descripción e Imagen alcanza: el resto de las columnas se guarda como detalle.
        </p>
      </div>

      {sources.length > 0 ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={sheetAction} className="card flex flex-col gap-3 p-4">
            <h3 className="font-medium">Conectar Google Sheets</h3>
            <label className="flex flex-col gap-1 text-sm">
              Nombre
              <input name="name" required maxLength={80} placeholder="Tienda online" className="field" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Enlace de la planilla
              <input name="url" type="url" required placeholder="https://docs.google.com/spreadsheets/d/…" className="field" />
              <span className="text-xs text-muted">En Google Sheets: Compartir → &ldquo;Cualquier persona con el enlace&rdquo; → Lector.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Cada cuánto se vuelve a leer
              <select name="syncEveryHours" defaultValue="6" className="field">
                <option value="1">Cada hora</option>
                <option value="6">Cada 6 horas</option>
                <option value="24">Una vez por día</option>
                <option value="0">Solo a mano</option>
              </select>
            </label>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={sheetPending} className="btn-primary">
                {sheetPending ? "Leyendo la planilla..." : "Conectar y leer"}
              </button>
              <Feedback state={sheetState} />
            </div>
          </form>

          <form action={fileAction} className="card flex flex-col gap-3 p-4">
            <h3 className="font-medium">Subir un archivo CSV</h3>
            <label className="flex flex-col gap-1 text-sm">
              Nombre (opcional)
              <input name="name" maxLength={80} placeholder="Lista de precios" className="field" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Archivo
              <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
              <span className="text-xs text-muted">En Excel: Archivo → Guardar como → CSV. Hasta 5 MB y 5.000 productos.</span>
            </label>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={filePending} className="btn-primary">
                {filePending ? "Subiendo..." : "Subir y leer"}
              </button>
              <Feedback state={fileState} />
            </div>
          </form>
        </div>
      ) : (
        <p className="text-sm text-muted">Las fuentes las administra quien tiene la cuenta de administración.</p>
      )}
    </section>
  );
}
