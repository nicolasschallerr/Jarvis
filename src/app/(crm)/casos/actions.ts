"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { changeCaseStatus, type CaseStatus } from "@/lib/crm/cases";
import { createClient } from "@/lib/supabase/server";

export type MoveState = { error: string | null };

// Mueve un caso a otra columna del tablero. Es el mismo cambio de estado que se hace desde la
// conversación: verifica quién es el usuario y delega en lib/crm/cases.ts; RLS decide en la base si puede
// modificar ese caso. Se usa el cliente del usuario, no la clave de servicio.
export async function moveCaseAction(caseId: string, status: CaseStatus, resolution: string): Promise<MoveState> {
  const result = await changeCaseStatus({
    userClient: await createClient(),
    profile: await getCurrentProfile(),
    caseId,
    status,
    resolution,
  });

  if (!result.ok) return { error: result.error };

  revalidatePath("/casos");
  return { error: null };
}
