"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { mergeContacts } from "@/lib/crm/contact-merge";
import { createClient } from "@/lib/supabase/server";

export type MergeState = { error: string | null; message: string | null };

// Une el contacto candidato (removeId) al de esta conversación (keepId). Solo superadmin; la base lo exige también.
export async function mergeContactAction(
  keepId: string,
  removeId: string,
  conversationId: string,
): Promise<MergeState> {
  const result = await mergeContacts({
    userClient: await createClient(),
    profile: await getCurrentProfile(),
    keepId,
    removeId,
  });

  if (!result.ok) return { error: result.error, message: null };

  revalidatePath(`/conversaciones/${conversationId}`);
  revalidatePath("/conversaciones");
  revalidatePath("/casos");

  const { identitiesMoved, conversationsMoved, conversationsMerged, casesMoved } = result.summary;
  return {
    error: null,
    message: `Contactos unidos: ${identitiesMoved} medio(s) de contacto, ${conversationsMoved + conversationsMerged} conversación(es) y ${casesMoved} caso(s) pasaron a este contacto.`,
  };
}
