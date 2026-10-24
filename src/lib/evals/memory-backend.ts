import type { CaseBackend, CaseSnapshot } from "@/lib/agent/tools";

// Lo que el agente pidió hacer sobre el caso, en orden. En los evals no se escribe en ninguna base:
// las herramientas anotan el pedido y guardan el estado en memoria.
export type RecordedAction =
  | { kind: "save_data"; unit: string; data: Record<string, string | number | boolean> }
  | { kind: "save_contact"; data: { name?: string; document?: string; locality?: string } }
  | { kind: "handoff"; sector: string; summary: string }
  | { kind: "ask_area"; sector: string; question: string };

// Backend en memoria: se comporta como la base (los datos se suman, los reintentos se cuentan y se
// borran al validar) para que los evals ejerciten el guardián de datos y los límites de reintentos igual
// que en producción.
export function createMemoryBackend(actions: RecordedAction[]): CaseBackend & { state: CaseSnapshot } {
  const state: CaseSnapshot = { unit: null, data: {}, contact: { name: null, document: null, locality: null } };
  const attempts = new Map<string, number>();

  return {
    state,
    async saveCaseData(input) {
      actions.push({ kind: "save_data", unit: input.unit, data: input.data });
      if (input.unit) state.unit = input.unit;
      Object.assign(state.data, input.data);
      return null;
    },
    async saveContactData(input) {
      actions.push({ kind: "save_contact", data: input });
      if (input.name) state.contact.name = input.name;
      if (input.document) state.contact.document = input.document;
      if (input.locality) state.contact.locality = input.locality;
      return null;
    },
    async recordFieldAttempt(field, ok) {
      if (ok) {
        attempts.delete(field);
        return 0;
      }
      const next = (attempts.get(field) ?? 0) + 1;
      attempts.set(field, next);
      return next;
    },
    async snapshot() {
      return { unit: state.unit, data: { ...state.data }, contact: { ...state.contact } };
    },
    async handoff(input) {
      actions.push({ kind: "handoff", sector: input.sector, summary: input.summary });
      return null;
    },
    async askArea(input) {
      actions.push({ kind: "ask_area", sector: input.sector, question: input.question });
      return null;
    },
  };
}
