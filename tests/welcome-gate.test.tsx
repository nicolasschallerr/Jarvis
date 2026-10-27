// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeGate } from "../src/components/welcome/welcome-gate";

// next/dynamic carga el componente de forma diferida; en las pruebas se reemplaza por React.lazy, que se
// resuelve con los mismos relojes falsos.
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
      const Lazy = React.lazy(loader);
      return function Dynamic(props: Record<string, unknown>) {
        return React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
      };
    },
  };
});

const TODAY = "2026-10-23";
const STORAGE_KEY = "jarvis-welcome-day";

const agents = [
  { kind: "attention" as const, name: "Jarvis", status: "paused" as const, line: "Hay 3 conversaciones esperando respuesta." },
  { kind: "analytic" as const, name: "Sinapsis", status: "paused" as const, line: "Tenés 2 casos abiertos y 1 sin asignar." },
];

function mockReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mount(play: boolean) {
  return render(<WelcomeGate play={play} todayKey={TODAY} greeting="Buen día" firstName="Nicolás" agents={agents} />);
}

describe("bienvenida animada", () => {
  // La animación se importa de forma diferida (I/O real); se precarga para que React.lazy la resuelva sin esperar.
  beforeAll(async () => {
    await import("../src/components/welcome/welcome-overlay");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    localStorage.clear();
    delete document.documentElement.dataset.welcome;
    delete document.documentElement.dataset.motion;
    window.history.replaceState(null, "", "/?bienvenida=1");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("sin el parámetro de bienvenida no muestra nada ni toca la página", async () => {
    const { container } = mount(false);
    await advance(5000);

    expect(container.innerHTML).toBe("");
    expect(document.documentElement.dataset.welcome).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("la primera vez del día pone la cortina, marca la bienvenida y quita el parámetro", async () => {
    const { container } = mount(true);

    // Antes de decidir ya hay una cortina (el servidor la dibuja).
    expect(container.querySelector(".welcome-fallback")).not.toBeNull();
    expect(document.documentElement.dataset.welcome).toBe("playing");

    await advance(50);
    expect(window.location.search).toBe("");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(TODAY);
  });

  it("la versión completa muestra a los dos agentes, escribe el saludo y termina sola a los 3,3 s", async () => {
    mount(true);
    await advance(50);

    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Saltar" })).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/Hay 3 conversaciones esperando respuesta/)).not.toBeNull();
    expect(screen.getByText(/Tenés 2 casos abiertos y 1 sin asignar/)).not.toBeNull();

    // La escritura va letra por letra: al principio no está completa y a los 2 s sí.
    const typedText = () => screen.getByRole("heading").querySelector("[aria-hidden=true]")?.textContent ?? "";
    expect(typedText().length).toBeLessThan("Buen día, Nicolás".length);
    await advance(2000);
    expect(typedText()).toBe("Buen día, Nicolás");

    // Un lector de pantalla recibe el saludo completo desde el principio.
    expect(screen.getByRole("heading").querySelector(".sr-only")?.textContent).toBe("Buen día, Nicolás");

    await advance(1400);
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.documentElement.dataset.welcome).toBeUndefined();
  });

  it("el resto del día es la versión corta: sin agentes y termina a los 0,8 s", async () => {
    localStorage.setItem(STORAGE_KEY, TODAY);
    mount(true);
    await advance(50);

    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("heading").textContent).toContain("Buen día, Nicolás");

    await advance(850);
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.documentElement.dataset.welcome).toBeUndefined();
  });

  it("al día siguiente vuelve a ser la versión completa", async () => {
    localStorage.setItem(STORAGE_KEY, "2026-10-22");
    mount(true);
    await advance(50);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(TODAY);
  });

  it("Saltar la termina enseguida", async () => {
    mount(true);
    await advance(800);
    expect(screen.queryByRole("status")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Saltar" }));
    await advance(300);

    expect(screen.queryByRole("status")).toBeNull();
    expect(document.documentElement.dataset.welcome).toBeUndefined();
  });

  it("Esc también la salta", async () => {
    mount(true);
    await advance(500);

    fireEvent.keyDown(document, { key: "Escape" });
    await advance(300);

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("con movimiento reducido no se muestra y la página queda como siempre", async () => {
    mockReducedMotion(true);
    const { container } = mount(true);
    await advance(100);

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector(".welcome-fallback")).toBeNull();
    expect(document.documentElement.dataset.welcome).toBeUndefined();
  });

  it("si la persona eligió siempre activas, se muestra aunque el sistema pida menos movimiento", async () => {
    mockReducedMotion(true);
    document.documentElement.dataset.motion = "full";
    mount(true);
    await advance(50);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("si la persona eligió reducidas, no se muestra aunque el sistema permita animaciones", async () => {
    mockReducedMotion(false);
    document.documentElement.dataset.motion = "reduce";
    mount(true);
    await advance(100);

    expect(screen.queryByRole("status")).toBeNull();
    expect(document.documentElement.dataset.welcome).toBeUndefined();
  });

  it("si el almacenamiento falla (modo privado), igual muestra la versión completa", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    mount(true);
    await advance(50);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    getItem.mockRestore();
  });

  it("al desmontarse devuelve la página a su estado normal", async () => {
    const { unmount } = mount(true);
    await advance(50);
    expect(document.documentElement.dataset.welcome).toBe("playing");

    unmount();
    expect(document.documentElement.dataset.welcome).toBeUndefined();
  });
});
