import { describe, expect, it } from "vitest";

import { byCategory, formatMoneyShort, monthBounds, monthlyTotals, pending, periodTotals, toMovement, type Movement } from "@/lib/finance/summary";

const move = (overrides: Partial<Movement>): Movement => ({
  kind: "income",
  category: "Ventas",
  description: "Venta",
  counterparty: null,
  amount: 100,
  occurredOn: "2026-10-10",
  dueOn: null,
  status: "paid",
  ...overrides,
});

describe("finanzas", () => {
  it("suma lo cobrado y lo pagado del período, sin los pendientes", () => {
    const totals = periodTotals(
      [
        move({ amount: 1000 }),
        move({ kind: "expense", amount: 400, category: "Sueldos" }),
        move({ amount: 500, status: "pending", dueOn: "2026-10-20" }),
        move({ amount: 999, occurredOn: "2026-09-30" }),
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect(totals).toEqual({ ingresos: 1000, egresos: 400, resultado: 600, margen: 60, movimientos: 2 });
  });

  it("sin ingresos el margen es null", () => {
    expect(periodTotals([move({ kind: "expense" })], "2026-10-01", "2026-10-31").margen).toBeNull();
  });

  it("agrupa por categoría con porcentajes, de mayor a menor", () => {
    const result = byCategory(
      [move({ kind: "expense", category: "Sueldos", amount: 300 }), move({ kind: "expense", category: "Alquiler", amount: 100 }), move({ category: "Ventas" })],
      "expense",
      "2026-10-01",
      "2026-10-31",
    );
    expect(result).toEqual([
      { categoria: "Sueldos", total: 300, porcentaje: 75 },
      { categoria: "Alquiler", total: 100, porcentaje: 25 },
    ]);
  });

  it("arma los últimos meses con cero en los vacíos, cruzando el año", () => {
    const months = monthlyTotals([move({ occurredOn: "2027-01-05", amount: 50 }), move({ occurredOn: "2026-11-02", kind: "expense", amount: 20 })], "2027-01-15", 3);
    expect(months).toEqual([
      { mes: "2026-11", ingresos: 0, egresos: 20, resultado: -20 },
      { mes: "2026-12", ingresos: 0, egresos: 0, resultado: 0 },
      { mes: "2027-01", ingresos: 50, egresos: 0, resultado: 50 },
    ]);
  });

  it("ordena los pendientes: vencidos primero, del más atrasado al menos", () => {
    const summary = pending(
      [
        move({ status: "pending", dueOn: "2026-10-30", amount: 10, description: "futuro" }),
        move({ status: "pending", dueOn: "2026-10-01", amount: 20, description: "muy vencido" }),
        move({ status: "pending", dueOn: "2026-10-10", amount: 30, description: "vencido" }),
        move({ status: "pending", dueOn: "2026-10-01", kind: "expense", amount: 99 }),
      ],
      "income",
      "2026-10-15",
    );
    expect(summary.items.map((item) => [item.descripcion, item.dias, item.vencido])).toEqual([
      ["muy vencido", 14, true],
      ["vencido", 5, true],
      ["futuro", -15, false],
    ]);
    expect(summary).toMatchObject({ total: 60, vencido: 50, cantidad: 3 });
  });

  it("convierte las filas de la base (el monto llega como texto)", () => {
    expect(toMovement({ kind: "expense", category: "X", description: "Y", counterparty: null, amount: "12.50", occurred_on: "2026-10-01", due_on: null, status: "paid" }).amount).toBe(12.5);
  });

  it("calcula el mes y abrevia montos", () => {
    expect(monthBounds("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(formatMoneyShort(18_450_000)).toBe("$ 18,5 M");
    expect(formatMoneyShort(-950_000)).toBe("−$ 950 mil");
  });
});
