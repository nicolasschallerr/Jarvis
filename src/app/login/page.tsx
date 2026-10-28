import { Suspense } from "react";

import { signOut } from "@/app/actions";
import Link from "next/link";

import { OrbitVisual } from "@/components/ui/orbit-visual";
import { Logo, LogoMark } from "@/components/ui/logo";

import { LoginForm } from "./login-form";

// Aviso cuando el CRM mandó acá a alguien con sesión pero sin acceso (usuario desactivado o sin perfil). Lee los
// parámetros de la URL, que son del pedido: va dentro de <Suspense>.
async function AccessNotice({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { motivo } = await searchParams;
  if (motivo === "enlace-invalido") {
    return (
      <p role="alert" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
        <strong>Ese enlace ya no sirve.</strong> Los enlaces de acceso se usan una sola vez y duran una hora. Pedile a quien administra tu organización que te genere
        uno nuevo.
      </p>
    );
  }
  if (motivo !== "sin-acceso") return null;

  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
      <p>
        <strong>Tu usuario no tiene acceso a Orbita AI.</strong> Puede estar desactivado o todavía sin configurar. Pedile a
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

export const metadata = { title: "Ingresar" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid grid-cols-1 flex-1 lg:grid-cols-[1.05fr_1fr]">
      {/* Columna de marca: los agentes y una frase. En celulares se oculta para ir directo al formulario. */}
      <section className="relative hidden overflow-hidden bg-zinc-950 text-zinc-100 lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div
          className="pointer-events-none absolute -bottom-40 -left-20 h-[32rem] w-[32rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgb(34 184 201 / 0.28), transparent)" }}
          aria-hidden="true"
        />
        <Link href="/" className="relative z-10 w-fit" aria-label="Orbita AI, volver a la página principal">
          <span className="flex items-center gap-2 text-xl">
            <LogoMark className="size-8" title="" />
            <span>
              orbita <strong className="text-[#22b8c9]">AI</strong>
            </span>
          </span>
        </Link>
        <OrbitVisual className="relative z-10 mx-auto w-full max-w-sm text-zinc-500" />
        <div className="relative z-10 flex flex-col gap-2">
          <p className="font-mono text-xs tracking-wider text-[#22b8c9] uppercase">Tu equipo, ampliado</p>
          <p className="max-w-sm text-2xl font-semibold tracking-tight">Los agentes atienden; tu equipo decide.</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-16 sm:px-6">
        <div className="rise-in flex w-full max-w-sm flex-col gap-6">
          <Link href="/" className="w-fit lg:hidden" aria-label="Orbita AI, volver a la página principal">
            <Logo />
          </Link>
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Panel de Orbita AI</p>
            <h1 className="text-3xl font-bold tracking-tight">Te damos la bienvenida</h1>
            <p className="text-sm text-muted">Ingresá con tu cuenta para continuar.</p>
          </div>
          <Suspense fallback={null}>
            <AccessNotice searchParams={searchParams} />
          </Suspense>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
