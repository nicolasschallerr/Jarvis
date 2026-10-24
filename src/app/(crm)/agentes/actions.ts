"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { updateAgent } from "@/lib/crm/agents";
import { createClient } from "@/lib/supabase/server";

export type AgentFormState = { error: string | null; saved: boolean };

// Verifica quién es el usuario y delega en lib/crm/agents.ts, que exige superadmin; RLS también.
export async function saveAgent(agentId: string, _previous: AgentFormState, formData: FormData): Promise<AgentFormState> {
  const profile = await getCurrentProfile();
  const result = await updateAgent({
    userClient: await createClient(),
    profile,
    agentId,
    name: String(formData.get("name") ?? ""),
    tagline: String(formData.get("tagline") ?? ""),
    isEnabled: formData.get("isEnabled") === "on",
  });

  if (!result.ok) return { error: result.error, saved: false };
  revalidatePath("/agentes");
  revalidatePath("/");
  return { error: null, saved: true };
}
