"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
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
