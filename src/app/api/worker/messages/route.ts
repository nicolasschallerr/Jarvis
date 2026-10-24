import type { NextRequest } from "next/server";

import { deliverAreaAnswers } from "@/lib/agent/area-replies";
import { anthropicClientFromEnv } from "@/lib/ai/anthropic-client";
import { processPendingMessages } from "@/lib/inbound/process";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedWorkerRequest } from "@/lib/worker-auth";

// Trabajador de mensajes. Lo invoca pg_cron (POST) con el secreto del trabajador. Procesa los mensajes
// entrantes (y el agente los contesta) y después envía al asociado las respuestas que dieron los
// sectores a las consultas del agente.
// Queda fuera del proxy de sesión: no tiene usuario, se protege con WORKER_SECRET.
async function handle(request: NextRequest) {
  if (!process.env.WORKER_SECRET) {
    return new Response("Server misconfigured", { status: 500 });
  }

  if (!isAuthorizedWorkerRequest(request.headers.get("authorization"), process.env.WORKER_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const modelClient = anthropicClientFromEnv();
    const result = await processPendingMessages(admin, 20, new Date(), modelClient);
    const areaReplies = modelClient ? await deliverAreaAnswers(admin, modelClient) : null;
    return Response.json({ ...result, areaReplies });
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
