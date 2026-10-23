"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { changeCasePriority, changeCaseStatus, createCase, type CasePriority, type CaseResult, type CaseStatus } from "@/lib/crm/cases";
import { createClient } from "@/lib/supabase/server";

export type CaseState = { error: string | null };

// Cada acción verifica quién es el usuario y delega en lib/crm/cases.ts; además RLS decide en la
// base qué casos puede modificar. Se usa el cliente del usuario, no la clave de servicio.
async function context() {
  return { profile: await getCurrentProfile(), userClient: await createClient() };
}

function done(conversationId: string, result: CaseResult): CaseState {
  if (!result.ok) return { error: result.error };
  revalidatePath(`/conversaciones/${conversationId}`);
  return { error: null };
}

export async function createCaseAction(conversationId: string, _previous: CaseState, formData: FormData): Promise<CaseState> {
  const { profile, userClient } = await context();
  const sectorId = String(formData.get("sectorId") ?? "");

  return done(
    conversationId,
    await createCase({
      userClient,
      profile,
      conversationId,
      title: String(formData.get("title") ?? ""),
      sectorId: sectorId || null,
      priority: String(formData.get("priority") ?? "normal") as CasePriority,
    }),
  );
}

export async function changeStatusAction(
  conversationId: string,
  caseId: string,
  status: CaseStatus,
  resolution: string,
): Promise<CaseState> {
  const { profile, userClient } = await context();
  return done(conversationId, await changeCaseStatus({ userClient, profile, caseId, status, resolution }));
}

export async function changePriorityAction(conversationId: string, caseId: string, priority: CasePriority): Promise<CaseState> {
  const { profile, userClient } = await context();
  return done(conversationId, await changeCasePriority({ userClient, profile, caseId, priority }));
}
