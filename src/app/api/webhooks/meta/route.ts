import type { NextRequest } from "next/server";

import { receiveMetaWebhook, verifyMetaWebhook } from "@/lib/meta/webhook";

// Webhook de Meta para WhatsApp, Messenger e Instagram (ver src/lib/meta/webhook.ts).
export async function GET(request: NextRequest) {
  return verifyMetaWebhook(request);
}

export async function POST(request: NextRequest) {
  return receiveMetaWebhook(request);
}
