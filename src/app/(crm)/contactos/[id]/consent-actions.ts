"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { setConsent } from "@/lib/consent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ConsentState = { error: string | null; savedAt: number | null };

// Registrar que un contacto aceptó recibir mensajes o que pidió dejar de recibirlos. Lo hace el superadmin o un operador
// (el rol de consulta, no). La columna la escribe solo el servidor (ADR-027); acá se comprueba el rol y que la persona
// vea ese contacto con su propia sesión (RLS) antes de escribir con el cliente de servicio.
export async function setConsentAction(contactId: string, action: "give" | "withdraw", _previous: ConsentState, formData: FormData): Promise<ConsentState> {
  const profile = await getCurrentProfile();
  if (profile.role === "viewer") return { error: "Tu rol es de consulta: no puede registrar el consentimiento.", savedAt: null };

  const { data: visible } = await (await createClient()).from("contacts").select("id").eq("id", contactId).maybeSingle();
  if (!visible) return { error: "El contacto no existe.", savedAt: null };

  const result = await setConsent(createAdminClient(), {
    organizationId: profile.organizationId,
    contactId,
    actorId: profile.id,
    action: action === "give" ? "give" : "withdraw",
    source: String(formData.get("source") ?? ""),
  });
  if (!result.ok) return { error: result.error, savedAt: null };

  revalidatePath(`/contactos/${contactId}`);
  return { error: null, savedAt: Date.now() };
}
