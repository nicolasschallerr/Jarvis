import type { NextRequest } from "next/server";

import { deliverAreaAnswers } from "@/lib/agent/area-replies";
import { anthropicClientFromEnv } from "@/lib/ai/anthropic-client";
import { runCatalogSyncs } from "@/lib/catalog/sources";
import { runFollowups } from "@/lib/followups/run";
import { processPendingMessages } from "@/lib/inbound/process";
import { createAdminClient } from "@/lib/supabase/admin";
import { runBroadcasts } from "@/lib/broadcasts/service";
import { checkUsageAlerts } from "@/lib/usage/alerts";
import { isAuthorizedWorkerRequest } from "@/lib/worker-auth";

// Trabajador de mensajes. Lo invoca pg_cron (POST) con el secreto del trabajador. Procesa los mensajes
// entrantes (y el agente los contesta) y después envía al asociado las respuestas que dieron los
// sectores a las consultas del agente.
// Queda fuera del proxy de sesión: no tiene usuario, se protege con WORKER_SECRET.
//
// Tiempo máximo de una pasada (ADR-029). pg_cron la llama cada 10 s; si una pasada se alarga, las tareas que
// pueden esperar (respuestas del área y seguimientos) quedan para la próxima en vez de cortarse a mitad.
export const maxDuration = 60;
const OPTIONAL_WORK_BUDGET_MS = 30_000;

async function handle(request: NextRequest) {
  if (!process.env.WORKER_SECRET) {
    return new Response("Server misconfigured", { status: 500 });
  }

  if (!isAuthorizedWorkerRequest(request.headers.get("authorization"), process.env.WORKER_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const started = Date.now();
    const admin = createAdminClient();
    const modelClient = anthropicClientFromEnv();
    const result = await processPendingMessages(admin, 20, new Date(), modelClient);
    const hasTime = () => Date.now() - started < OPTIONAL_WORK_BUDGET_MS;
    const areaReplies = modelClient && hasTime() ? await deliverAreaAnswers(admin, modelClient) : null;
    // Los seguimientos no necesitan el modelo. Si fallan, los mensajes ya quedaron procesados: se informa y se sigue.
    const followups = hasTime()
      ? await runFollowups(admin).catch((error: unknown) => {
          console.error("worker seguimientos:", error instanceof Error ? error.message : error);
          return null;
        })
      : null;
    // Avisos de consumo: tampoco necesitan el modelo y no deben frenar nada si fallan.
    const usageAlerts = hasTime()
      ? await checkUsageAlerts(admin).catch((error: unknown) => {
          console.error("worker consumo:", error instanceof Error ? error.message : error);
          return null;
        })
      : null;
    // Envíos masivos: empiezan los programados y sale un lote de cada uno. Tampoco necesitan el modelo.
    const broadcasts = hasTime()
      ? await runBroadcasts(admin).catch((error: unknown) => {
          console.error("worker envíos masivos:", error instanceof Error ? error.message : error);
          return null;
        })
      : null;
    // Stock: vuelve a leer las planillas de Google que ya cumplieron su intervalo (ADR-045).
    const catalogSyncs = hasTime()
      ? await runCatalogSyncs(admin).catch((error: unknown) => {
          console.error("worker stock:", error instanceof Error ? error.message : error);
          return null;
        })
      : null;
    return Response.json({ ...result, areaReplies, followups, usageAlerts, broadcasts, catalogSyncs });
  } catch (error) {
    console.error("worker mensajes:", error instanceof Error ? error.message : error);
    return new Response("Error", { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

// GET habilitado para programadores de tareas que solo saben hacer GET.
export async function GET(request: NextRequest) {
  return handle(request);
}
