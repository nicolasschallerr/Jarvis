import Link from "next/link";

import { Logo } from "@/components/ui/logo";

import { PasswordForm } from "./password-form";

export const metadata = { title: "Elegir contraseña" };

// Elegir (o cambiar) la contraseña. Se llega con el enlace de acceso que genera quien administra la organización, o
// desde "Cambiar mi contraseña" estando adentro. El proxy exige sesión: sin ella, manda al ingreso.
export default function NuevaClavePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
      <div className="rise-in flex w-full max-w-sm flex-col gap-6">
        <Logo />
        <div className="flex flex-col gap-1">
          <p className="eyebrow">Tu cuenta</p>
          <h1 className="text-3xl font-bold tracking-tight">Elegí tu contraseña</h1>
          <p className="text-sm text-muted">Con ella vas a entrar a Orbita AI las próximas veces.</p>
        </div>
        <PasswordForm />
        <Link href="/inicio" className="text-sm text-muted underline-offset-2 hover:text-foreground hover:underline">
          Volver al panel
        </Link>
      </div>
    </main>
  );
}
