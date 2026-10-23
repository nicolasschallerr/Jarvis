"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { addNote } from "@/lib/crm/notes";
import { createClient } from "@/lib/supabase/server";

export type NoteState = { error: string | null; savedAt: number | null };

export async function addNoteAction(conversationId: string, _previous: NoteState, formData: FormData): Promise<NoteState> {
  const result = await addNote({
    userClient: await createClient(),
    profile: await getCurrentProfile(),
    conversationId,
    body: String(formData.get("body") ?? ""),
  });

  if (!result.ok) return { error: result.error, savedAt: null };

  revalidatePath(`/conversaciones/${conversationId}`);
  return { error: null, savedAt: Date.now() };
}
