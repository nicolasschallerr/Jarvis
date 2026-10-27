import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { loadAttentionAgent } from "@/lib/agent/load";
import type { Database } from "@/lib/supabase/database.types";
import { welcomeLine } from "@/lib/crm/welcome";
import { toAgentKind } from "@/components/agents/agent-card";

// Una base mínima en memoria: cada consulta se resuelve por tabla y tipo de agente.
function fakeAdmin(rows: { attentionEnabled: boolean; stock: { is_enabled: boolean } | null; catalogInConfig: boolean }) {
  const settings = {
    organizationName: "Tienda",
    agentName: "Sofía",
    timeZone: "America/Argentina/Buenos_Aires",
    businessHours: null,
    units: [],
    sectors: [],
    defaultSector: null,
    sensitiveTopics: [],
    knowledge: {},
    catalog: { enabled: rows.catalogInConfig, label: "productos" },
  };
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq(column: string, value: string) {
          filters[column] = value;
          return builder;
        },
        async maybeSingle() {
          if (table === "agents" && filters.kind === "attention") return { data: { id: "agent-1", is_enabled: rows.attentionEnabled } };
          if (table === "agents" && filters.kind === "stock") return { data: rows.stock };
          if (table === "agent_configs") return { data: { id: "config-1", model: "m", prompt: "p", settings } };
          return { data: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}

async function catalogEnabled(rows: Parameters<typeof fakeAdmin>[0]) {
  const result = await loadAttentionAgent(fakeAdmin(rows), "org-1");
  if (!result.ok) throw new Error(`no cargó: ${result.reason}`);
  return result.agent.settings.catalog.enabled;
}

describe("agente de stock: interruptor del catálogo", () => {
  it("encendido, el agente de atención consulta el catálogo aunque su configuración no lo pida", async () => {
    expect(await catalogEnabled({ attentionEnabled: true, stock: { is_enabled: true }, catalogInConfig: false })).toBe(true);
  });

  it("apagado, no lo consulta aunque la configuración lo tuviera activado", async () => {
    expect(await catalogEnabled({ attentionEnabled: true, stock: { is_enabled: false }, catalogInConfig: true })).toBe(false);
  });

  it("sin fila de stock (organización anterior) sigue lo que diga la configuración", async () => {
    expect(await catalogEnabled({ attentionEnabled: true, stock: null, catalogInConfig: true })).toBe(true);
    expect(await catalogEnabled({ attentionEnabled: true, stock: null, catalogInConfig: false })).toBe(false);
  });
});

describe("agentes visibles", () => {
  it("reconoce atención, analítico y stock; ignora los tipos internos", () => {
    expect(["attention", "analytic", "stock", "copilot", "summarizer"].map(toAgentKind)).toEqual(["attention", "analytic", "stock", null, null]);
  });

  it("el agente de stock saluda con el tamaño del catálogo", () => {
    const counts = { awaitingReply: 0, myOpenCases: 0, unassignedCases: 0, urgentCases: 0 };
    expect(welcomeLine("stock", counts, 0)).toBe("Todavía no hay stock cargado.");
    expect(welcomeLine("stock", counts, 1)).toBe("Tengo 1 producto en el catálogo.");
    expect(welcomeLine("stock", counts, 120)).toBe("Tengo 120 productos en el catálogo.");
  });
});
