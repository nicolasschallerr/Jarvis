import type { NextRequest } from "next/server";

import { recordAudit } from "@/lib/audit/record";
import { profileFromSession } from "@/lib/auth/profile";
import { auditCsv, canExport, casesCsv, consumptionCsv, contactsCsv, isExportType, type ExportResult } from "@/lib/export/datasets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Descarga de datos en CSV. Vuelve a comprobar la sesión y el rol acá (el botón es solo comodidad) y deja constancia
// en la auditoría de quién exportó qué. Nada se guarda en caché: son datos de la organización.
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest, context: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await context.params;
  if (!isExportType(tipo)) return new Response("No existe esa exportación", { status: 404, headers: NO_STORE });

  const session = await profileFromSession();
  if (session.status !== "ok") return new Response("Iniciá sesión para exportar", { status: 401, headers: NO_STORE });
  const { profile } = session;
  if (!canExport(profile.role, tipo)) return new Response("Tu rol no puede exportar esto", { status: 403, headers: NO_STORE });

  const userClient = await createClient();
  let result: ExportResult;
  try {
    if (tipo === "casos") result = await casesCsv(userClient);
    else if (tipo === "contactos") result = await contactsCsv(userClient);
    else if (tipo === "consumo") result = await consumptionCsv(userClient, request.nextUrl.searchParams.get("mes") ?? undefined);
    else result = await auditCsv(userClient);
  } catch (error) {
    console.error("exportar:", error instanceof Error ? error.message : "Error desconocido");
    return new Response("No se pudo preparar la exportación", { status: 500, headers: NO_STORE });
  }

  await recordAudit(createAdminClient(), {
    organizationId: profile.organizationId,
    actorId: profile.id,
    action: "export.created",
    entityType: "export",
    data: { type: tipo, rows: result.rows, truncated: result.truncated },
  });

  const day = new Date().toISOString().slice(0, 10);
  return new Response(result.csv, {
    headers: {
      ...NO_STORE,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="orbita-ai-${tipo}-${day}.csv"`,
      // Para que la pantalla avise si se cortó en el tope.
      "x-export-truncated": result.truncated ? "1" : "0",
    },
  });
}
