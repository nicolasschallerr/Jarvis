"use server";

import { anthropicClientFromEnv } from "@/lib/ai/anthropic-client";
import type { AnalystAnswer, AnalystTurn } from "@/lib/analytics/ask";
import { getCurrentProfile } from "@/lib/auth/profile";
import { answerFinanceQuestion } from "@/lib/finance/ask";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Pregunta al agente financiero. Igual que el analítico: las herramientas leen con la sesión de quien pregunta (RLS) y
// la clave de servicio solo registra el gasto.
export async function askFinanceAction(history: AnalystTurn[], question: string): Promise<AnalystAnswer> {
  const profile = await getCurrentProfile();

  return answerFinanceQuestion({
    userClient: await createClient(),
    admin: createAdminClient(),
    modelClient: anthropicClientFromEnv(),
    profile,
    question,
    history,
  });
}
