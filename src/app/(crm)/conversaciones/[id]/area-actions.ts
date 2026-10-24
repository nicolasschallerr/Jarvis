"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { answerAreaQuery } from "@/lib/crm/area-queries";
import { createClient } from "@/lib/supabase/server";

export type AreaAnswerState = { error: string | null; savedAt: number | null };

export async function answerAreaQueryAction(
  conversationId: string,
  queryId: string,
  _previous: AreaAnswerState,
  formData: FormData,
): Promise<AreaAnswerState> {
  const result = await answerAreaQuery({
    userClient: await createClient(),
    profile: await getCurrentProfile(),
    queryId,
    answer: String(formData.get("answer") ?? ""),
  });

  if (!result.ok) return { error: result.error, savedAt: null };

  revalidatePath(`/conversaciones/${conversationId}`);
  return { error: null, savedAt: Date.now() };
}
