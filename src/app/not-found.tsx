import Link from "next/link";

import { Logo } from "@/components/ui/logo";

export const metadata = { title: "No encontrado" };

// Página para direcciones que no existen (o conversaciones y casos a los que no se tiene acceso).
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="card flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
        <Logo />
        <h1 className="font-display text-2xl font-semibold tracking-tight">No encontramos lo que buscás</h1>
        <p className="text-sm text-muted">
          La dirección no existe o no tenés acceso a ese contenido. Puede que se haya movido o que el enlace esté incompleto.
        </p>
        <Link href="/" className="btn-primary">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
