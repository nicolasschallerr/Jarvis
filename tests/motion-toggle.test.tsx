// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MotionToggle } from "../src/components/ui/motion-toggle";

function mockSystemReducedMotion(reduced: boolean) {
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

describe("selector de animaciones", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.motion;
  });

  afterEach(() => cleanup());

  it("por defecto es automático y no guarda nada", () => {
    mockSystemReducedMotion(true);
    render(<MotionToggle />);

    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("auto");
    expect(localStorage.getItem("jarvis-motion")).toBeNull();
  });

  it("'siempre activas' anula la preferencia del sistema y se recuerda", () => {
    mockSystemReducedMotion(true);
    render(<MotionToggle />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "on" } });

    expect(document.documentElement.dataset.motion).toBe("full");
    expect(localStorage.getItem("jarvis-motion")).toBe("on");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("on");
  });

  it("'reducidas' reduce el movimiento aunque el sistema permita animaciones", () => {
    mockSystemReducedMotion(false);
    render(<MotionToggle />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "off" } });

    expect(document.documentElement.dataset.motion).toBe("reduce");
    expect(localStorage.getItem("jarvis-motion")).toBe("off");
  });

  it("volver a automático borra la elección y vuelve a seguir al sistema", () => {
    mockSystemReducedMotion(true);
    render(<MotionToggle />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "on" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "auto" } });

    expect(localStorage.getItem("jarvis-motion")).toBeNull();
    expect(document.documentElement.dataset.motion).toBe("reduce");
  });

  it("recuerda la elección guardada al volver a abrirse", () => {
    mockSystemReducedMotion(true);
    localStorage.setItem("jarvis-motion", "on");
    render(<MotionToggle />);

    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("on");
  });
});
