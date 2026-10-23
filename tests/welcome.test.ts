import { describe, expect, it } from "vitest";

import { dayKey, welcomeLine } from "../src/lib/crm/welcome";

const counts = (overrides: Partial<Parameters<typeof welcomeLine>[1]> = {}) => ({
  awaitingReply: 0,
  myOpenCases: 0,
  unassignedCases: 0,
  urgentCases: 0,
  ...overrides,
});

describe("clave del día de la bienvenida", () => {
  it("usa la fecha de Argentina, no la del servidor", () => {
    // 02:30 UTC del 24 todavía es 23:30 del 23 en Argentina (UTC-3).
    expect(dayKey(new Date("2026-10-24T02:30:00.000Z"))).toBe("2026-10-23");
    expect(dayKey(new Date("2026-10-24T03:00:00.000Z"))).toBe("2026-10-24");
  });
});

describe("frases de los agentes al dar la bienvenida", () => {
  it("el agente de atención cuenta las conversaciones que esperan respuesta", () => {
    expect(welcomeLine("attention", counts())).toBe("No hay conversaciones esperando respuesta.");
    expect(welcomeLine("attention", counts({ awaitingReply: 1 }))).toBe("Hay 1 conversación esperando respuesta.");
    expect(welcomeLine("attention", counts({ awaitingReply: 14 }))).toBe("Hay 14 conversaciones esperando respuesta.");
  });

  it("el agente analítico resume los casos propios, los sin asignar y los urgentes", () => {
    expect(welcomeLine("analytic", counts())).toBe("No hay casos pendientes por ahora.");
    expect(welcomeLine("analytic", counts({ myOpenCases: 1 }))).toBe("Tenés 1 caso abierto.");
    expect(welcomeLine("analytic", counts({ myOpenCases: 3, unassignedCases: 2 }))).toBe("Tenés 3 casos abiertos y 2 sin asignar.");
    expect(welcomeLine("analytic", counts({ myOpenCases: 0, unassignedCases: 4 }))).toBe("Tenés 0 casos abiertos y 4 sin asignar.");
    expect(welcomeLine("analytic", counts({ myOpenCases: 2, urgentCases: 1 }))).toBe("Tenés 2 casos abiertos. 1 es urgente.");
    expect(welcomeLine("analytic", counts({ myOpenCases: 2, unassignedCases: 1, urgentCases: 3 }))).toBe(
      "Tenés 2 casos abiertos y 1 sin asignar. 3 son urgentes.",
    );
  });

  it("ninguna frase afirma una acción del agente (todavía no responden solos)", () => {
    const samples = [counts(), counts({ awaitingReply: 5, myOpenCases: 2, unassignedCases: 1, urgentCases: 1 })];
    for (const sample of samples) {
      for (const kind of ["attention", "analytic"] as const) {
        expect(welcomeLine(kind, sample)).not.toMatch(/respond[ií]|resolv[ií]|envi[eé]|atend[ií]/i);
      }
    }
  });
});
