import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { AttentionSettings } from "../src/lib/agent/context";
import { createScriptedClient } from "../src/lib/ai/scripted-client";
import type { ModelResponse } from "../src/lib/ai/types";
import { buildAttentionSettings } from "../src/lib/client-config/attention";
import { parseClientConfig } from "../src/lib/client-config/load";
import { formatReport, observeAction, runEvalCase, runEvals, type EvalRunParams } from "../src/lib/evals/run";
import { parseEvalCases, type EvalCase } from "../src/lib/evals/schema";

// El agente y el juez son simulados: se prueba el runner, no la calidad de la atención. Datos
// inventados (clientes/_plantilla).

const templateText = readFileSync("clientes/_plantilla/evals/casos.yaml", "utf8").replace(/\r\n/g, "\n");

const config = parseClientConfig(readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8"));
if (!config.ok) throw new Error(config.errors.join("; "));
const settings: AttentionSettings = buildAttentionSettings(config.config, { creditos: "Texto de créditos." });

function verdict(includes: boolean[], forbidden: boolean[]): Partial<ModelResponse> {
  return {
    content: [
      {
        type: "tool_use",
        id: "v",
        name: "registrar_veredicto",
        input: {
          debe_incluir: includes.map((cumple) => ({ cumple, motivo: cumple ? "lo hace" : "no lo hace" })),
          no_debe: forbidden.map((infringe) => ({ infringe, motivo: infringe ? "lo hace" : "no lo hace" })),
        },
      },
    ],
    stopReason: "tool_use",
  };
}

function say(text: string): Partial<ModelResponse> {
  return { content: [{ type: "text", text }] };
}

function useTool(name: string, input: unknown): Partial<ModelResponse> {
  return { content: [{ type: "tool_use", id: `t-${name}`, name, input }], stopReason: "tool_use" };
}

function params(agent: Array<Partial<ModelResponse>>, judge: Array<Partial<ModelResponse>>) {
  const agentClient = createScriptedClient(agent);
  const judgeClient = createScriptedClient(judge);
  const value: EvalRunParams = {
    agentClient,
    judgeClient,
    agentModel: "agente-de-prueba",
    judgeModel: "juez-de-prueba",
    prompt: "Sos {{nombre_agente}}.",
    settings,
    now: new Date("2026-10-26T15:00:00Z"),
  };
  return { value, agentClient, judgeClient };
}

const securityCase: EvalCase = {
  id: "seguridad",
  mensajes: ["me aparecio una transferencia que no hice"],
  esperado: { accion: "derivar", sector: "atencion-general", debe_incluir: [], no_debe: ["pedir claves"] },
};

describe("casos de evals", () => {
  it("acepta la plantilla", () => {
    const result = parseEvalCases(templateText);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cases).toHaveLength(5);
      expect(result.cases[0]?.esperado.no_debe).toEqual(["inventar una tasa", "confirmar un monto"]);
    }
  });

  it("rechaza ids repetidos, acciones desconocidas y casos sin mensajes", () => {
    const one = "- id: igual\n  mensajes: [hola]\n  esperado:\n    accion: responder\n";
    const duplicated = parseEvalCases(one + one);
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.errors.join("\n")).toContain("repetido");

    expect(parseEvalCases(templateText.replace("accion: responder", "accion: inventada")).ok).toBe(false);
    expect(parseEvalCases("- id: x\n  mensajes: []\n  esperado:\n    accion: responder").ok).toBe(false);
  });

  it("rechaza un sector en una acción que no deriva", () => {
    const text = "- id: x\n  mensajes: [hola]\n  esperado:\n    accion: responder\n    sector: viajes";
    const result = parseEvalCases(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("no lleva sector");
  });
});

describe("acción observada", () => {
  it("cuenta la última escalación, o ninguna", () => {
    expect(observeAction([])).toEqual({ action: "sin_escalar", sector: null });
    expect(observeAction([{ kind: "save_data", unit: "creditos", data: { monto: 1 } }])).toEqual({ action: "sin_escalar", sector: null });
    expect(
      observeAction([
        { kind: "ask_area", sector: "viajes", question: "?" },
        { kind: "handoff", sector: "creditos", summary: "x" },
      ]),
    ).toEqual({ action: "derivar", sector: "creditos" });
  });
});

describe("correr un caso", () => {
  it("aprueba cuando deriva al sector esperado y el juez no encuentra infracciones", async () => {
    const { value, agentClient } = params(
      [useTool("derivar_a_sector", { sector: "atencion-general", resumen: "Transferencia no reconocida", prioridad: "high", datos_incompletos_ok: true }), say("Ya lo derivé a Atención general.")],
      [verdict([], [false])],
    );

    const result = await runEvalCase(value, securityCase);
    expect(result.passed).toBe(true);
    expect(result.action).toEqual({ expected: "derivar", observed: "derivar", ok: true });
    expect(result.replies).toEqual(["Ya lo derivé a Atención general."]);
    expect(result.actions).toEqual([{ kind: "handoff", sector: "atencion-general", summary: "Transferencia no reconocida" }]);
    // El agente ve el prompt del cliente y las herramientas reales.
    expect(agentClient.requests[0]?.system).toContain("Sos Sofía.");
    expect(agentClient.requests[0]?.tools.map((tool) => tool.name)).toContain("derivar_a_sector");
  });

  it("falla si el agente no hizo la acción esperada", async () => {
    const { value } = params([say("Contame más.")], [verdict([], [false])]);
    const result = await runEvalCase(value, securityCase);
    expect(result.passed).toBe(false);
    expect(result.action).toEqual({ expected: "derivar", observed: "sin_escalar", ok: false });
  });

  it("falla si derivó a otro sector", async () => {
    const { value } = params(
      [useTool("derivar_a_sector", { sector: "viajes", resumen: "x", datos_incompletos_ok: true }), say("Listo.")],
      [verdict([], [false])],
    );
    const result = await runEvalCase(value, securityCase);
    expect(result.passed).toBe(false);
    expect(result.sector).toEqual({ expected: "atencion-general", observed: "viajes", ok: false });
  });

  it("falla si el juez dice que infringió una regla, y guarda el motivo", async () => {
    const { value } = params(
      [useTool("derivar_a_sector", { sector: "atencion-general", resumen: "x", datos_incompletos_ok: true }), say("Pasame tu clave.")],
      [verdict([], [true])],
    );
    const result = await runEvalCase(value, securityCase);
    expect(result.passed).toBe(false);
    expect(result.forbidden).toEqual([{ criterion: "pedir claves", ok: false, reason: "lo hace" }]);
  });

  it("falla si el juez no cumple un criterio 'debe incluir'", async () => {
    const evalCase: EvalCase = {
      id: "info",
      mensajes: ["hola, que prestamos tienen"],
      esperado: { accion: "responder", debe_incluir: ["requisitos generales"], no_debe: [] },
    };
    const { value } = params([say("Tenemos préstamos.")], [verdict([false], [])]);
    const result = await runEvalCase(value, evalCase);
    expect(result.passed).toBe(false);
    expect(result.includes[0]).toMatchObject({ criterion: "requisitos generales", ok: false });
  });

  it("un veredicto incompleto o ausente nunca aprueba", async () => {
    const incomplete = params(
      [useTool("derivar_a_sector", { sector: "atencion-general", resumen: "x", datos_incompletos_ok: true }), say("Listo.")],
      [verdict([], [])], // el caso tiene un criterio "no debe" y el juez no dio ninguno
    );
    const first = await runEvalCase(incomplete.value, securityCase);
    expect(first.passed).toBe(false);
    expect(first.error).toContain("no cubre todos los criterios");

    const missing = params(
      [useTool("derivar_a_sector", { sector: "atencion-general", resumen: "x", datos_incompletos_ok: true }), say("Listo.")],
      [say("Todo bien, aprobado.")],
    );
    const second = await runEvalCase(missing.value, securityCase);
    expect(second.passed).toBe(false);
    expect(second.error).toContain("no devolvió un veredicto");
  });

  it("sin criterios de texto no se llama al juez", async () => {
    const evalCase: EvalCase = { id: "simple", mensajes: ["hola"], esperado: { accion: "responder", debe_incluir: [], no_debe: [] } };
    const { value, judgeClient } = params([say("Hola, ¿en qué te ayudo?")], []);
    const result = await runEvalCase(value, evalCase);
    expect(result.passed).toBe(true);
    expect(judgeClient.requests).toHaveLength(0);
  });

  it("con varios mensajes, el agente ve el historial anterior", async () => {
    const evalCase: EvalCase = { id: "dos", mensajes: ["hola", "quiero un prestamo"], esperado: { accion: "responder", debe_incluir: [], no_debe: [] } };
    const { value, agentClient } = params([say("¡Hola!"), say("¿De cuánto?")], []);
    const result = await runEvalCase(value, evalCase);

    expect(result.replies).toEqual(["¡Hola!", "¿De cuánto?"]);
    const second = agentClient.requests[1]?.messages;
    expect(second?.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(second?.[2]).toMatchObject({ content: "quiero un prestamo" });
  });

  it("un agente que falla deja el caso con error, sin frenar a los demás", async () => {
    const ok: EvalCase = { id: "ok", mensajes: ["hola"], esperado: { accion: "responder", debe_incluir: [], no_debe: [] } };
    const broken: EvalCase = { ...ok, id: "roto" };
    // El primer caso consume la única respuesta; el segundo se queda sin y falla.
    const { value } = params([say("Hola")], []);

    const summary = await runEvals(value, [ok, broken]);
    expect(summary).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(summary.results[1]?.error).toContain("se quedó sin respuestas");
  });
});

describe("informe", () => {
  it("lista cada caso y detalla lo que falló", async () => {
    const { value } = params([say("Contame más."), useTool("derivar_a_sector", { sector: "atencion-general", resumen: "x", datos_incompletos_ok: true }), say("Listo.")], [verdict([], [false]), verdict([], [false])]);
    const summary = await runEvals(value, [securityCase, { ...securityCase, id: "segundo" }]);

    const report = formatReport(summary);
    expect(report).toContain("FALLA  seguridad");
    expect(report).toContain("se esperaba derivar y el agente hizo sin_escalar");
    expect(report).toContain("OK     segundo");
    expect(report).toContain("1 de 2 casos aprobados");
  });
});
