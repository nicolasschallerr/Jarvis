import { Suspense } from "react";

import { signOut } from "@/app/actions";
import { Logo } from "@/components/ui/logo";

import { LoginForm } from "./login-form";

// Aviso cuando el CRM mandó acá a alguien con sesión pero sin acceso (usuario desactivado o sin perfil). Lee los
// parámetros de la URL, que son del pedido: va dentro de <Suspense>.
async function AccessNotice({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { motivo } = await searchParams;
  if (motivo !== "sin-acceso") return null;

  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
      <p>
        <strong>Tu usuario no tiene acceso a Jarvis.</strong> Puede estar desactivado o todavía sin configurar. Pedile a
        quien administra tu organización que lo revise.
      </p>
      <form action={signOut}>
        <button type="submit" className="btn-secondary w-full">
          Salir e ingresar con otra cuenta
        </button>
      </form>
    </div>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
      <div className="card flex w-full max-w-sm flex-col gap-6 p-6 sm:p-8">
        <Logo />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Te damos la bienvenida</h1>
          <p className="text-sm text-muted">Ingresá con tu cuenta para continuar.</p>
        </div>
        <Suspense fallback={null}>
          <AccessNotice searchParams={searchParams} />
        </Suspense>
        <LoginForm />
      </div>
    </main>
  );
}
