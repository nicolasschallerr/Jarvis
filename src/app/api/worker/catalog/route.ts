import type { NextRequest } from "next/server";

import { runCatalogSyncs } from "@/lib/catalog/sources";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedWorkerRequest } from "@/lib/worker-auth";

// Trabajador de stock (ADR-047). Lo invoca pg_cron cada 10 minutos con el secreto del trabajador y vuelve a leer las
// fuentes de stock (base del cliente, sitio web, planilla) cuyo intervalo se cumplió. Va aparte del trabajador de
// mensajes porque leer un sitio entero puede tardar minutos y no debe demorar las respuestas a los clientes.
export const maxDuration = 300;
const BUDGET_MS = 270_000;

async function handle(request: NextRequest) {
  if (!process.env.WORKER_SECRET) return new Response("Server misconfigured", { status: 500 });
  if (!isAuthorizedWorkerRequest(request.headers.get("authorization"), process.env.WORKER_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await runCatalogSyncs(createAdminClient(), { deadline: Date.now() + BUDGET_MS });
    return Response.json(result);
  } catch (error) {
    console.error("worker stock:", error instanceof Error ? error.message : error);
    return new Response("Error", { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
