import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type TeamResult = { ok: true } | { ok: false; error: string };

type TeamParams = {
  // Cliente que actúa como el usuario: RLS (sectors_write, sector_members_write) también exige superadmin.
  userClient: SupabaseClient<Database>;
  profile: { id: string; role: "superadmin" | "operator" | "viewer"; organizationId: string };
};

const NOT_ALLOWED: TeamResult = { ok: false, error: "Solo un superadministrador puede cambiar los equipos." };

// Suma a una persona al equipo de un sector. Solo superadmin. La persona tiene que ser de la misma
// organización, estar activa y poder trabajar casos (superadmin u operador).
export async function addSectorMember(params: TeamParams & { sectorId: string; profileId: string }): Promise<TeamResult> {
  if (params.profile.role !== "superadmin") return NOT_ALLOWED;

  const { data: sector } = await params.userClient.from("sectors").select("id, is_active").eq("id", params.sectorId).maybeSingle();
  if (!sector) return { ok: false, error: "El sector no existe." };
  if (!sector.is_active) return { ok: false, error: "El sector está desactivado." };

  const { data: person } = await params.userClient
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", params.profileId)
    .maybeSingle();
  if (!person) return { ok: false, error: "La persona no existe." };
  if (!person.is_active) return { ok: false, error: "La persona está desactivada." };
  if (person.role === "viewer") return { ok: false, error: "Un usuario de consulta y reportes no trabaja casos, no se suma a un sector." };

  const { error } = await params.userClient.from("sector_members").insert({
    sector_id: params.sectorId,
    profile_id: params.profileId,
    organization_id: params.profile.organizationId,
  });

  if (error) {
    // 23505 = ya está en el sector.
    if (error.code === "23505") return { ok: false, error: "La persona ya está en este sector." };
    return { ok: false, error: "No se pudo agregar a la persona." };
  }
  return { ok: true };
}

export async function removeSectorMember(params: TeamParams & { sectorId: string; profileId: string }): Promise<TeamResult> {
  if (params.profile.role !== "superadmin") return NOT_ALLOWED;

  const { data, error } = await params.userClient
    .from("sector_members")
    .delete()
    .eq("sector_id", params.sectorId)
    .eq("profile_id", params.profileId)
    .select("profile_id");

  if (error) return { ok: false, error: "No se pudo quitar a la persona." };
  if (!data?.length) return { ok: false, error: "La persona no estaba en este sector." };
  return { ok: true };
}

// Marca o desmarca a una persona como responsable del sector.
export async function setSectorLead(
  params: TeamParams & { sectorId: string; profileId: string; isLead: boolean },
): Promise<TeamResult> {
  if (params.profile.role !== "superadmin") return NOT_ALLOWED;

  const { data, error } = await params.userClient
    .from("sector_members")
    .update({ is_lead: params.isLead })
    .eq("sector_id", params.sectorId)
    .eq("profile_id", params.profileId)
    .select("profile_id");

  if (error) return { ok: false, error: "No se pudo cambiar el responsable." };
  if (!data?.length) return { ok: false, error: "La persona no está en este sector." };
  return { ok: true };
}
