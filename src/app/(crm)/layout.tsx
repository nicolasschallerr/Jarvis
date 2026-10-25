import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { signOut } from "@/app/actions";
import { Avatar } from "@/components/ui/avatar";
import { BotIcon, CaseIcon, ChartIcon, ChatIcon, ContactsIcon, HomeIcon, InboxIcon, LockIcon, SparkIcon, TeamIcon } from "@/components/ui/icons";
import { Logo } from "@/components/ui/logo";
import { MotionToggle } from "@/components/ui/motion-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { getCurrentProfile } from "@/lib/auth/profile";
import { countUnreadNotifications } from "@/lib/crm/notifications";
import { createClient } from "@/lib/supabase/server";

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
    <div className="flex flex-col gap-2 border-t border-line pt-4 text-sm">
      <div className="flex items-center gap-3 px-1">
        <Avatar name={profile.fullName} />
        <div className="min-w-0">
          <p className="truncate font-medium">{profile.fullName}</p>
          <p className="truncate text-xs text-muted">
            {ROLE_LABELS[profile.role]} · {profile.organizationName}
          </p>
        </div>
      </div>
      {/* Las preferencias de pantalla no ocupan lugar fijo: se abren cuando se necesitan. */}
      <details className="group rounded-lg">
        <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-muted transition hover:bg-zinc-200/60 hover:text-foreground dark:hover:bg-zinc-800 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between">
            Preferencias
            <span aria-hidden="true" className="transition group-open:rotate-180">
              ▾
            </span>
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-2 px-1">
          <ThemeToggle />
          <MotionToggle />
          <Link href="/nueva-clave" className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-zinc-200/60 hover:text-foreground dark:hover:bg-zinc-800">
            Cambiar mi contraseña
          </Link>
        </div>
      </details>
      <form action={signOut}>
        <button type="submit" className="btn-secondary w-full">
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}

// Todo el CRM depende de la sesión (cookies), que con Cache Components se lee en el momento del pedido. La
// navegación hacia el CRM bloquea en el servidor hasta tener la sesión; es lo esperable en una app con
// login. Migrar más lecturas a `use cache: private` haría las navegaciones instantáneas (deuda).
export const instant = false;

// El menú depende del rol: "Equipo" y "Agentes" son solo del superadmin; "Analítico" y "Consumo", del superadmin
// y de consulta y reportes. Ocultarlo es comodidad: la seguridad real está en la página, las acciones y RLS.
async function MainNav() {
  // El contador de avisos se lee en cada pedido (la hora y la sesión cambian): connection() lo deja claro.
  await connection();
  const profile = await getCurrentProfile();
  const unread = await countUnreadNotifications({ userClient: await createClient(), userId: profile.id });

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Principal">
      <NavLink href="/inicio" icon={<HomeIcon />} count={unread} countLabel={`${unread} avisos sin leer`}>
        Inicio
      </NavLink>
      <NavLink href="/conversaciones" icon={<ChatIcon />}>
        Conversaciones
      </NavLink>
      <NavLink href="/casos" icon={<CaseIcon />}>
        Casos
      </NavLink>
      <NavLink href="/contactos" icon={<ContactsIcon />}>
        Contactos
      </NavLink>
      {profile.role === "superadmin" ? (
        <>
          <p className="mt-4 mb-1 px-3 text-xs font-semibold tracking-wide text-muted uppercase">Administración</p>
          <NavLink href="/equipo" icon={<TeamIcon />}>
            Equipo
          </NavLink>
          <NavLink href="/agentes" icon={<BotIcon />}>
            Agentes
          </NavLink>
          <NavLink href="/plantillas" icon={<InboxIcon />}>
            Plantillas
          </NavLink>
          <NavLink href="/auditoria" icon={<LockIcon />}>
            Auditoría
          </NavLink>
        </>
      ) : null}
      {profile.role !== "operator" ? (
        <>
          {profile.role !== "superadmin" ? <p className="mt-4 mb-1 px-3 text-xs font-semibold tracking-wide text-muted uppercase">Reportes</p> : null}
          <NavLink href="/analitico" icon={<SparkIcon />}>
            Analítico
          </NavLink>
          <NavLink href="/consumo" icon={<ChartIcon />}>
            Consumo
          </NavLink>
        </>
      ) : null}
    </nav>
  );
}

function NavSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-3" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="skeleton h-7" />
      ))}
    </div>
  );
}

function Sidebar() {
  return (
    <>
      <div className="flex flex-col gap-6">
        <Logo className="px-3" />
        {/* El rol y usePathname() son datos de pedido: van dentro de <Suspense>. */}
        <Suspense fallback={<NavSkeleton />}>
          <MainNav />
        </Suspense>
      </div>
      <Suspense fallback={<div className="skeleton h-12" />}>
        <UserBlock />
      </Suspense>
    </>
  );
}

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell sidebar={<Sidebar />}>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </Shell>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6" aria-busy="true" aria-label="Cargando">
      <div className="skeleton h-8 w-56" />
      <div className="skeleton h-4 w-80" />
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="skeleton h-24" />
        ))}
      </div>
      <div className="skeleton h-64" />
    </div>
  );
}
