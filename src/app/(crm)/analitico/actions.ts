"use server";

import { getCurrentProfile } from "@/lib/auth/profile";
import { anthropicClientFromEnv } from "@/lib/ai/anthropic-client";
import { answerBusinessQuestion, type AnalystAnswer, type AnalystTurn } from "@/lib/analytics/ask";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Responde una pregunta de la administración. Las herramientas leen con la sesión de quien pregunta (RLS),
// así que el analista no ve más de lo que ve esa persona. La clave de servicio solo se usa para registrar el
// gasto en ai_calls.
export async function askAnalystAction(history: AnalystTurn[], question: string): Promise<AnalystAnswer> {
  const profile = await getCurrentProfile();

  return answerBusinessQuestion({
    userClient: await createClient(),
    admin: createAdminClient(),
    modelClient: anthropicClientFromEnv(),
    profile,
    question,
    history,
  });
}
