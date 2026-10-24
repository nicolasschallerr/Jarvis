// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Board, type BoardCase } from "../src/components/kanban/board";

// La acción de servidor se reemplaza por un doble: acá se prueba el tablero, no la base.
const moveCaseAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/(crm)/casos/actions", () => ({ moveCaseAction }));

const base = { priority: "normal", sectorName: "Sector de prueba", assigneeName: null, contactName: "Ana Prueba", conversationId: "c1", updatedAt: "2026-10-23T12:00:00.000Z" };

const cases: BoardCase[] = [
  { ...base, id: "a", title: "Caso A", status: "new" },
  { ...base, id: "b", title: "Caso B", status: "new", priority: "urgent" },
  { ...base, id: "c", title: "Caso C", status: "in_progress", assigneeName: "Beto Prueba" },
  { ...base, id: "d", title: "Caso D", status: "resolved" },
];

const column = (name: RegExp) => screen.getByRole("region", { name });
const moveSelect = (title: string) => screen.getByRole("combobox", { name: new RegExp(`Mover el caso ${title} a otro estado`) });

describe("tablero de casos", () => {
  beforeEach(() => {
    moveCaseAction.mockReset();
    moveCaseAction.mockResolvedValue({ error: null });
  });

  afterEach(() => cleanup());

  it("reparte los casos en cinco columnas con su cantidad", () => {
    render(<Board cases={cases} canEdit />);

    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(column(/^Nuevo: 2 casos/)).not.toBeNull();
    expect(within(column(/^Nuevo/)).getByText("Caso A")).not.toBeNull();
    expect(within(column(/^Nuevo/)).getByText("Caso B")).not.toBeNull();
    expect(within(column(/^En curso/)).getByText("Caso C")).not.toBeNull();
    expect(within(column(/^Resuelto/)).getByText("Caso D")).not.toBeNull();
    expect(within(column(/^Esperando al contacto/)).getByText("Soltá un caso acá")).not.toBeNull();
  });

  it("enlaza cada caso con su conversación", () => {
    render(<Board cases={cases} canEdit />);
    expect(screen.getByRole("link", { name: "Caso A" }).getAttribute("href")).toBe("/conversaciones/c1");
  });

  it("con el selector mueve el caso al instante y llama a la acción", async () => {
    let finish!: (value: { error: string | null }) => void;
    moveCaseAction.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<Board cases={cases} canEdit />);

    fireEvent.change(moveSelect("Caso A"), { target: { value: "in_progress" } });

    // Optimista: ya está en la columna nueva aunque el servidor todavía no contestó.
    await waitFor(() => expect(within(column(/^En curso/)).getByText("Caso A")).not.toBeNull());
    expect(within(column(/^Nuevo/)).queryByText("Caso A")).toBeNull();
    expect(moveCaseAction).toHaveBeenCalledWith("a", "in_progress", "");

    await act(async () => finish({ error: null }));
  });

  it("si el servidor lo rechaza, el caso vuelve a su columna y se avisa el motivo", async () => {
    let finish!: (value: { error: string | null }) => void;
    moveCaseAction.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<Board cases={cases} canEdit />);

    fireEvent.change(moveSelect("Caso B"), { target: { value: "waiting_area" } });
    await waitFor(() => expect(within(column(/^Esperando al área/)).getByText("Caso B")).not.toBeNull());

    await act(async () => finish({ error: "El caso no existe o no tenés permiso para modificarlo." }));

    await waitFor(() => expect(within(column(/^Nuevo/)).getByText("Caso B")).not.toBeNull());
    expect(within(column(/^Esperando al área/)).queryByText("Caso B")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("no tenés permiso");
  });

  it("al resolver pregunta cómo se resolvió y recién entonces llama a la acción", async () => {
    render(<Board cases={cases} canEdit />);

    fireEvent.change(moveSelect("Caso C"), { target: { value: "resolved" } });
    expect(moveCaseAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Se entregó la documentación" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Marcar como resuelto" }));
    });

    expect(moveCaseAction).toHaveBeenCalledWith("c", "resolved", "Se entregó la documentación");
  });

  it("cancelar la pregunta no mueve nada", () => {
    render(<Board cases={cases} canEdit />);

    fireEvent.change(moveSelect("Caso C"), { target: { value: "resolved" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(moveCaseAction).not.toHaveBeenCalled();
    expect(within(column(/^En curso/)).getByText("Caso C")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Marcar como resuelto" })).toBeNull();
  });

  it("quien solo consulta ve el tablero pero no tiene manijas ni selectores", () => {
    render(<Board cases={cases} canEdit={false} />);

    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Mover el caso/ })).toBeNull();
    expect(within(column(/^Nuevo/)).getByText("Caso A")).not.toBeNull();
    expect(within(column(/^Esperando al contacto/)).getByText("Sin casos")).not.toBeNull();
  });

  it("cada caso con permiso tiene una manija accesible para arrastrar o mover con el teclado", () => {
    render(<Board cases={cases} canEdit />);
    expect(screen.getAllByRole("button", { name: /^Mover el caso/ })).toHaveLength(4);
  });
});
