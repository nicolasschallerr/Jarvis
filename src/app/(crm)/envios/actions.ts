"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/profile";
import { localToUtc } from "@/lib/broadcasts/rules";
import { cancelBroadcast, createBroadcast, scheduleBroadcast } from "@/lib/broadcasts/service";
import { createAdminClient } from "@/lib/supabase/admin";

export type BroadcastState = { error: string | null };

const ONLY_ADMIN: BroadcastState = { error: "Solo un superadministrador puede crear y programar envíos masivos." };

// Todas las acciones vuelven a comprobar el rol acá (la pantalla es solo comodidad) y la organización sale de la sesión.
export async function createBroadcastAction(_previous: BroadcastState, formData: FormData): Promise<BroadcastState> {
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return ONLY_ADMIN;

  // Las variables vienen como "var:<nombre>"; solo se toman claves simples.
  const variables: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("var:") && typeof value === "string" && /^[a-z0-9_]{1,40}$/i.test(key.slice(4))) variables[key.slice(4)] = value.slice(0, 300);
  }

  const result = await createBroadcast(createAdminClient(), {
    organizationId: profile.organizationId,
    actorId: profile.id,
    name: String(formData.get("name") ?? ""),
    templateId: String(formData.get("templateId") ?? ""),
    variables,
    locality: String(formData.get("locality") ?? ""),
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/envios");
  redirect(`/envios/${result.id}`);
}

export async function scheduleBroadcastAction(broadcastId: string, _previous: BroadcastState, formData: FormData): Promise<BroadcastState> {
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return ONLY_ADMIN;

  const admin = createAdminClient();
  let at: Date | null = null;
  if (formData.get("when") === "later") {
    const { data: organization } = await admin.from("organizations").select("timezone").eq("id", profile.organizationId).maybeSingle();
    at = localToUtc(String(formData.get("at") ?? ""), organization?.timezone ?? "America/Argentina/Buenos_Aires");
    if (!at) return { error: "Elegí la fecha y la hora." };
  }

  const result = await scheduleBroadcast(admin, { organizationId: profile.organizationId, actorId: profile.id, broadcastId, at });
  revalidatePath(`/envios/${broadcastId}`);
  revalidatePath("/envios");
  return result.ok ? { error: null } : { error: result.error };
}

export async function cancelBroadcastAction(broadcastId: string): Promise<BroadcastState> {
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return ONLY_ADMIN;

  const result = await cancelBroadcast(createAdminClient(), { organizationId: profile.organizationId, actorId: profile.id, broadcastId });
  revalidatePath(`/envios/${broadcastId}`);
  revalidatePath("/envios");
  return result.ok ? { error: null } : { error: result.error };
}
