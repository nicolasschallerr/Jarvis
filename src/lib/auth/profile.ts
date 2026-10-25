import "server-only";

import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type CurrentProfile = {
  id: string;
  fullName: string;
  role: "superadmin" | "operator" | "viewer";
  organizationId: string;
  organizationName: string;
};

type SessionProfile = { status: "ok"; profile: CurrentProfile } | { status: "no-session" } | { status: "inactive" };

// Lee la sesión y el perfil. No decide qué hacer si faltan: lo deciden quienes la usan (una página redirige, una
// descarga responde 401 o 403). Mira las cookies primero, así que solo corre al momento del pedido.
export async function profileFromSession(): Promise<SessionProfile> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (!userId) return { status: "no-session" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, organization_id, is_active, organizations(name)")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || !profile.is_active) return { status: "inactive" };

  return {
    status: "ok",
    profile: {
      id: profile.id,
      fullName: profile.full_name,
      role: profile.role,
      organizationId: profile.organization_id,
      organizationName: profile.organizations?.name ?? "",
    },
  };
}

// Quién está usando el CRM. Lee la sesión (cookies), así que solo se puede llamar dentro de un
// <Suspense> o de una acción de servidor. Si no hay sesión o el usuario no tiene perfil activo,
// lo manda al login: toda página y acción del CRM debe pasar por acá, no confiar solo en el proxy.
//
// `use cache: private`: leer la sesión compara su vencimiento con la hora actual, y con Cache Components eso
// solo puede pasar en un ámbito privado. En producción el resultado NO se guarda entre pedidos (solo se reusa
// dentro del mismo pedido); en el navegador vale 30 segundos, así un cambio de rol se ve enseguida.
async function loadCurrentProfile(): Promise<CurrentProfile> {
  "use cache: private";
  cacheLife({ stale: 30, revalidate: 30, expire: 60 });

  const result = await profileFromSession();
  if (result.status === "no-session") redirect("/login");
  // Con sesión pero sin perfil activo: el ingreso explica por qué (sin esto, /login lo devolvía al inicio y el
  // inicio otra vez a /login, en un bucle).
  if (result.status === "inactive") redirect("/login?motivo=sin-acceso");
  return result.profile;
}

// El menú, el bloque de usuario y la página piden el perfil a la vez. `cache` de React hace que, en un mismo pedido,
// las tres compartan una sola consulta en vez de hacer tres iguales en paralelo (`use cache: private` por sí solo no
// lo evita mientras la primera todavía no terminó).
export const getCurrentProfile = cache(loadCurrentProfile);
