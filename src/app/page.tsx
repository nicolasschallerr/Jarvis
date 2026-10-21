import { Suspense } from "react";

import { signOut } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";

const ROLE_LABELS = {
  superadmin: "Superadministrador",
  operator: "Operador",
  viewer: "Consulta y reportes",
} as const;

// Leer la sesión (cookies) es un dato de pedido: con Cache Components va dentro de <Suspense>.
async function ProfileCard() {
  const supabase = await createClient();

  // El proxy ya exige sesión; acá se lee quién es para mostrar su perfil. RLS hace que solo
  // se vea el perfil de la propia organización.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;

  const { data: profile } = userId
    ? await supabase
        .from("profiles")
        .select("full_name, role, organizations(name)")
        .eq("id", userId)
        .maybeSingle()
    : { data: null };

  if (!profile) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Tu usuario todavía no tiene un perfil asignado a una organización. Pedile a un
        administrador que lo configure.
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-zinc-600 dark:text-zinc-400">Nombre</dt>
      <dd>{profile.full_name}</dd>
      <dt className="text-zinc-600 dark:text-zinc-400">Organización</dt>
      <dd>{profile.organizations?.name}</dd>
      <dt className="text-zinc-600 dark:text-zinc-400">Rol</dt>
      <dd>{ROLE_LABELS[profile.role]}</dd>
    </dl>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Jarvis</h1>

        <Suspense
          fallback={
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando tu perfil...</p>
          }
        >
          <ProfileCard />
        </Suspense>

        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
