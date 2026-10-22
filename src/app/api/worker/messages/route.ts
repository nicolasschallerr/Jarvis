import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingMessages } from "@/lib/inbound/process";
import { isAuthorizedWorkerRequest } from "@/lib/worker-auth";

// Trabajador de mensajes entrantes. Lo invoca pg_cron (POST) con el secreto del trabajador.
// Queda fuera del proxy de sesión: no tiene usuario, se protege con WORKER_SECRET.
async function handle(request: NextRequest) {
  if (!process.env.WORKER_SECRET) {
    return new Response("Server misconfigured", { status: 500 });
  }

  if (!isAuthorizedWorkerRequest(request.headers.get("authorization"), process.env.WORKER_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await processPendingMessages(createAdminClient());
    return Response.json(result);
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
