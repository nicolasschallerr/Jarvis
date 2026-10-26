"use server";

import { revalidatePath } from "next/cache";

import { anthropicClientFromEnv } from "@/lib/ai/anthropic-client";
import { getCurrentProfile } from "@/lib/auth/profile";
import { suggestReply } from "@/lib/copilot/suggest";
import { sendOperatorReply } from "@/lib/crm/reply";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// `aiPaused`: este envío tomó el chat (Jarvis estaba atendiendo y quedó en pausa).
export type ReplyState = { error: string | null; sentAt: number | null; aiPaused?: boolean };

export async function sendReply(
  conversationId: string,
  _previousState: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const profile = await getCurrentProfile();

  const result = await sendOperatorReply({
    userClient: await createClient(),
    admin: createAdminClient(),
    profile,
    conversationId,
    text: String(formData.get("text") ?? ""),
  });

  if (!result.ok) return { error: result.error, sentAt: null };

  revalidatePath(`/conversaciones/${conversationId}`);
  if (result.aiPaused) revalidatePath("/conversaciones");
  return { error: null, sentAt: Date.now(), aiPaused: result.aiPaused };
}

export type SuggestState = { text: string | null; error: string | null };

// Borrador de respuesta del copiloto para la conversación abierta. No envía nada: el texto va al cuadro de respuesta.
export async function suggestReplyAction(conversationId: string): Promise<SuggestState> {
  const profile = await getCurrentProfile();
  const result = await suggestReply({
    userClient: await createClient(),
    admin: createAdminClient(),
    modelClient: anthropicClientFromEnv(),
    profile,
    conversationId,
  });
  return result.ok ? { text: result.text, error: null } : { text: null, error: result.error };
}
