"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { addQuickReply, deleteQuickReply } from "@/lib/crm/quick-replies";
import { createClient } from "@/lib/supabase/server";

export type QuickReplyState = { error: string | null };

export async function saveQuickReply(conversationId: string, title: string, body: string): Promise<QuickReplyState> {
  const result = await addQuickReply({ userClient: await createClient(), profile: await getCurrentProfile(), title, body });
  if (!result.ok) return { error: result.error };
  revalidatePath(`/conversaciones/${conversationId}`);
  return { error: null };
}

export async function removeQuickReply(conversationId: string, id: string): Promise<QuickReplyState> {
  const result = await deleteQuickReply({ userClient: await createClient(), profile: await getCurrentProfile(), id });
  if (!result.ok) return { error: result.error };
  revalidatePath(`/conversaciones/${conversationId}`);
  return { error: null };
}
