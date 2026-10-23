import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type CurrentProfile = {
  id: string;
  fullName: string;
  role: "superadmin" | "operator" | "viewer";
  organizationId: string;
  organizationName: string;
};

// Quién está usando el CRM. Lee la sesión (cookies), así que solo se puede llamar dentro de un
// <Suspense> o de una acción de servidor. Si no hay sesión o el usuario no tiene perfil activo,
// lo manda al login: toda página y acción del CRM debe pasar por acá, no confiar solo en el proxy.
export async function getCurrentProfile(): Promise<CurrentProfile> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, organization_id, is_active, organizations(name)")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || !profile.is_active) redirect("/login");

  return {
    id: profile.id,
    fullName: profile.full_name,
    role: profile.role,
    organizationId: profile.organization_id,
    organizationName: profile.organizations?.name ?? "",
  };
}
