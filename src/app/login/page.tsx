import { Logo } from "@/components/ui/logo";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
      <div className="card flex w-full max-w-sm flex-col gap-6 p-6 sm:p-8">
        <Logo />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Bienvenido</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Ingresá con tu cuenta para continuar.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
