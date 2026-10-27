import { AlertIcon } from "./icons";

// Aviso de error de una página: un solo estilo en todo el CRM (antes había tres). Lo anuncia el lector de pantalla.
export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="m-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger sm:m-6">
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1">{children}</p>
      <a href="" className="shrink-0 font-medium underline-offset-2 hover:underline">
        Reintentar
      </a>
    </div>
  );
}
