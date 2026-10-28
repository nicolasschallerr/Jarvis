"use server";

import { anthropicClientFromEnv } from "@/lib/ai/anthropic-client";
import type { AnalystAnswer, AnalystTurn } from "@/lib/analytics/ask";
import { answerAssistantQuestion } from "@/lib/assistant/ask";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Pregunta al Asistente. Las herramientas leen con la sesión de quien pregunta (RLS); la clave de servicio solo
// registra el gasto.
export async function askAssistantAction(history: AnalystTurn[], question: string): Promise<AnalystAnswer> {
  const profile = await getCurrentProfile();

  return answerAssistantQuestion({
    userClient: await createClient(),
    admin: createAdminClient(),
    modelClient: anthropicClientFromEnv(),
    profile,
    question,
    history,
  });
}
