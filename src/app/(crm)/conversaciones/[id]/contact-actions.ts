"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { updateContactCard } from "@/lib/crm/contact-card";
import { createClient } from "@/lib/supabase/server";

export type ContactState = { error: string | null; warning: string | null; savedAt: number | null };

export async function updateContactAction(
  contactId: string,
  conversationId: string,
  _previous: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const result = await updateContactCard({
    userClient: await createClient(),
    profile: await getCurrentProfile(),
    contactId,
    input: {
      displayName: String(formData.get("displayName") ?? ""),
      documentNumber: String(formData.get("documentNumber") ?? ""),
      locality: String(formData.get("locality") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    },
  });

  if (!result.ok) return { error: result.error, warning: null, savedAt: null };

  if (conversationId) revalidatePath(`/conversaciones/${conversationId}`);
  revalidatePath(`/contactos/${contactId}`);
  return { error: null, warning: result.warning, savedAt: Date.now() };
}
