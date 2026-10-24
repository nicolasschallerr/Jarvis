import { Suspense } from "react";

import { signOut } from "@/app/actions";
import { Logo } from "@/components/ui/logo";
import { MotionToggle } from "@/components/ui/motion-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { getCurrentProfile } from "@/lib/auth/profile";

import { NavLink } from "./nav-link";
import { Shell } from "./shell";

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
      <ThemeToggle />
      <MotionToggle />
      <form action={signOut}>
        <button type="submit" className="btn-secondary w-full">
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}

// El menú depende del rol: "Equipo" y "Agentes" son solo para superadministradores, y "Consumo" para superadmin y consulta y reportes. Ocultarlo es comodidad; la
// seguridad real está en la página, en las acciones y en RLS.
async function MainNav() {
  const profile = await getCurrentProfile();

  return (
    <nav className="flex flex-col gap-1" aria-label="Principal">
      <NavLink href="/">Inicio</NavLink>
      <NavLink href="/conversaciones">Conversaciones</NavLink>
      <NavLink href="/casos">Casos</NavLink>
      {profile.role === "superadmin" ? <NavLink href="/equipo">Equipo</NavLink> : null}
      {profile.role === "superadmin" ? <NavLink href="/agentes">Agentes</NavLink> : null}
      {profile.role !== "operator" ? <NavLink href="/analitico">Analítico</NavLink> : null}
      {profile.role !== "operator" ? <NavLink href="/consumo">Consumo</NavLink> : null}
    </nav>
  );
}

function Sidebar() {
  return (
    <>
      <div className="flex flex-col gap-6">
        <Logo className="px-3" />
        {/* El rol y usePathname() son datos de pedido: van dentro de <Suspense>. */}
        <Suspense fallback={<div className="h-9" />}>
          <MainNav />
        </Suspense>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando...</p>}>
        <UserBlock />
      </Suspense>
    </>
  );
}

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell sidebar={<Sidebar />}>
      <Suspense fallback={<p className="p-6 text-sm text-zinc-600 dark:text-zinc-400">Cargando...</p>}>
        {children}
      </Suspense>
    </Shell>
  );
}
