import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jarvis</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Ingresá con tu cuenta para continuar.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
