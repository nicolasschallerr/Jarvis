import type { NextRequest } from "next/server";

import { receiveMetaWebhook, verifyMetaWebhook } from "@/lib/meta/webhook";

// Dirección original del webhook de WhatsApp: sigue funcionando y hace lo mismo que /api/webhooks/meta.
export async function GET(request: NextRequest) {
  return verifyMetaWebhook(request);
}

export async function POST(request: NextRequest) {
  return receiveMetaWebhook(request);
}
