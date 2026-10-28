import { Suspense } from "react";

import { signOut } from "@/app/actions";
import Link from "next/link";

import { OrbitVisual } from "@/components/ui/orbit-visual";
import { LogoMark } from "@/components/ui/logo";

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
    <main className="flex flex-1 flex-col lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Columna de marca (escritorio): los agentes y una frase. */}
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

      {/* Celular y tablet: una franja oscura de marca arriba (órbitas que giran, luces que se mueven y la frase) y el
          formulario como una hoja que sube por encima. En escritorio se usa la columna de la izquierda. */}
      <section className="relative overflow-hidden bg-zinc-950 px-6 pt-8 pb-16 text-zinc-100 lg:hidden">
        <div
          className="aurora pointer-events-none absolute -top-24 -right-16 size-80 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgb(34 184 201 / 0.35), transparent)" }}
          aria-hidden="true"
        />
        <div
          className="aurora pointer-events-none absolute -bottom-24 -left-20 size-72 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--agent-sinapsis) 28%, transparent), transparent)", animationDelay: "-7s" }}
          aria-hidden="true"
        />
        <div className="relative flex items-center justify-between">
          <Link href="/" className="w-fit" aria-label="Orbita AI, volver a la página principal">
            <span className="flex items-center gap-2 text-lg">
              <LogoMark className="size-7" title="" />
              <span>
                orbita <strong className="text-[#22b8c9]">AI</strong>
              </span>
            </span>
          </Link>
          <span className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-300 backdrop-blur">
            <span className="relative inline-flex size-1.5" aria-hidden="true">
              <span className="live-ping absolute inset-0 rounded-full bg-[#22b8c9]" />
              <span className="relative size-1.5 rounded-full bg-[#22b8c9]" />
            </span>
            Agentes en línea
          </span>
        </div>
        <div className="rise-in relative mx-auto mt-6 flex max-w-sm flex-col items-center gap-5 text-center">
          <OrbitVisual className="w-44 text-zinc-500 sm:w-52" />
          <div className="flex flex-col gap-1.5">
            <p className="font-mono text-[11px] tracking-wider text-[#22b8c9] uppercase">Tu equipo, ampliado</p>
            <p className="text-2xl font-semibold tracking-tight">Los agentes atienden; tu equipo decide.</p>
          </div>
        </div>
      </section>

      <section className="relative z-10 -mt-8 flex flex-1 items-start justify-center rounded-t-[2rem] bg-background px-6 pt-8 pb-12 shadow-[0_-12px_32px_rgb(0_0_0/0.18)] sm:px-6 dark:border-t dark:border-white/10 lg:mt-0 lg:border-t-0 lg:items-center lg:rounded-none lg:py-16 lg:shadow-none">
        <div className="rise-in flex w-full max-w-sm flex-col gap-6" style={{ animationDelay: "0.12s" }}>
          <span className="mx-auto -mt-4 h-1.5 w-10 rounded-full bg-zinc-300 lg:hidden dark:bg-zinc-700" aria-hidden="true" />
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
