"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { addSectorMember, removeSectorMember, setSectorLead, type TeamResult } from "@/lib/crm/team";
import { createClient } from "@/lib/supabase/server";

export type TeamState = { error: string | null };

// Cada acción verifica quién es el usuario y delega en lib/crm/team.ts, que exige superadmin; además
// RLS (políticas *_write) lo exige en la base. Se usa el cliente del usuario, no la clave de servicio.
async function context() {
  return { profile: await getCurrentProfile(), userClient: await createClient() };
}

function done(result: TeamResult): TeamState {
  if (!result.ok) return { error: result.error };
  revalidatePath("/equipo");
  return { error: null };
}

export async function addMember(sectorId: string, _previous: TeamState, formData: FormData): Promise<TeamState> {
  const profileId = String(formData.get("profileId") ?? "");
  if (!profileId) return { error: "Elegí a una persona." };

  const { profile, userClient } = await context();
  return done(await addSectorMember({ userClient, profile, sectorId, profileId }));
}

export async function removeMember(sectorId: string, profileId: string): Promise<TeamState> {
  const { profile, userClient } = await context();
  return done(await removeSectorMember({ userClient, profile, sectorId, profileId }));
}

export async function toggleLead(sectorId: string, profileId: string, isLead: boolean): Promise<TeamState> {
  const { profile, userClient } = await context();
  return done(await setSectorLead({ userClient, profile, sectorId, profileId, isLead }));
}
