"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { recordAudit } from "@/lib/audit/record";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncTemplates } from "@/lib/whatsapp/service";

export type SyncState = { error: string | null; message: string | null; problems: string[] };

// Trae las plantillas de Meta. Solo el superadmin; la organización sale de su sesión, nunca del navegador.
export async function syncTemplatesAction(): Promise<SyncState> {
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return { error: "Solo un superadministrador puede sincronizar las plantillas.", message: null, problems: [] };

  try {
    const admin = createAdminClient();
    const result = await syncTemplates(admin, profile.organizationId);
    if (result.channels > 0) {
      await recordAudit(admin, { organizationId: profile.organizationId, actorId: profile.id, action: "template.synced", entityType: "template", data: { count: result.synced } });
    }
    revalidatePath("/plantillas");
    return {
      error: null,
      message: result.channels > 0 ? `Listo: ${result.synced} plantillas actualizadas desde Meta.` : null,
      problems: result.problems,
    };
  } catch (error) {
    console.error("sincronizar plantillas:", error instanceof Error ? error.message : "Error desconocido");
    return { error: "No se pudieron sincronizar las plantillas.", message: null, problems: [] };
  }
}
