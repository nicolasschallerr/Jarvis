import { Suspense } from "react";

import { signOut } from "@/app/actions";
import { getCurrentProfile } from "@/lib/auth/profile";

import { NavLink } from "./nav-link";

const ROLE_LABELS = {
  superadmin: "Superadministrador",
  operator: "Operador",
  viewer: "Consulta y reportes",
} as const;

// Leer la sesión es un dato de pedido: va dentro de <Suspense> (Cache Components).
async function UserBlock() {
  const profile = await getCurrentProfile();

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
      <div>
        <p className="font-medium">{profile.fullName}</p>
        <p className="text-zinc-600 dark:text-zinc-400">{ROLE_LABELS[profile.role]}</p>
        <p className="text-zinc-600 dark:text-zinc-400">{profile.organizationName}</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1">
      <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-col gap-6">
          <p className="px-3 text-lg font-semibold tracking-tight">Jarvis</p>
          <nav className="flex flex-col gap-1" aria-label="Principal">
            <NavLink href="/conversaciones">Conversaciones</NavLink>
          </nav>
        </div>
        <Suspense fallback={<p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando...</p>}>
          <UserBlock />
        </Suspense>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<p className="p-6 text-sm text-zinc-600 dark:text-zinc-400">Cargando...</p>}>
          {children}
        </Suspense>
      </div>
    </div>
  );
}
