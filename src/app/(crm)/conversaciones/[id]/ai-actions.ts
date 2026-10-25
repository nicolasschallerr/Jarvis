"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { setConversationAi } from "@/lib/crm/ai-switch";
import { createClient } from "@/lib/supabase/server";

export type AiSwitchState = { error: string | null };

// Tomar el chat (enabled = false) o devolverlo a Jarvis (enabled = true). La autorización está en
// setConversationAi y en RLS.
export async function switchConversationAi(conversationId: string, enabled: boolean): Promise<AiSwitchState> {
  const result = await setConversationAi({
    userClient: await createClient(),
    profile: await getCurrentProfile(),
    conversationId,
    enabled,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/conversaciones/${conversationId}`);
  revalidatePath("/conversaciones");
  return { error: null };
}
