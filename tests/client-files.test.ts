import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { readAttentionFiles } from "../src/lib/client-config/read-dir";

// Lectura de la carpeta de un cliente, con archivos temporales inventados.

const roots: string[] = [];

function makeClient(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "jarvis-cliente-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text, "utf8");
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("conocimiento por unidad", () => {
  it("lee un archivo suelto por unidad", () => {
    const root = makeClient({ "agente-prompt.md": "Prompt", "conocimiento/viajes.md": "Texto de viajes" });
    expect(readAttentionFiles(root)).toEqual({ prompt: "Prompt", knowledge: { viajes: "Texto de viajes" } });
  });

  it("une los archivos de una carpeta en orden alfabético", () => {
    const root = makeClient({
      "agente-prompt.md": "Prompt",
      "conocimiento/hotel/2-datos.md": "Datos a juntar",
      "conocimiento/hotel/1-info.md": "Información",
      "conocimiento/hotel/notas.txt": "no es markdown, se ignora",
    });
    expect(readAttentionFiles(root)?.knowledge).toEqual({ hotel: "Información\n\nDatos a juntar" });
  });

  it("permite mezclar archivo suelto y carpeta de la misma unidad, y varias unidades", () => {
    const root = makeClient({
      "agente-prompt.md": "Prompt",
      "conocimiento/creditos.md": "General",
      "conocimiento/creditos/extra.md": "Extra",
      "conocimiento/viajes/info.md": "Viajes",
    });
    expect(readAttentionFiles(root)?.knowledge).toEqual({ creditos: "General\n\nExtra", viajes: "Viajes" });
  });

  it("ignora archivos y carpetas vacíos", () => {
    const root = makeClient({ "agente-prompt.md": "Prompt", "conocimiento/vacio/a.md": "   \n", "conocimiento/vacio2/.keep": "" });
    expect(readAttentionFiles(root)?.knowledge).toEqual({});
  });

  it("funciona sin carpeta de conocimiento y devuelve null sin prompt", () => {
    expect(readAttentionFiles(makeClient({ "agente-prompt.md": "Prompt" }))?.knowledge).toEqual({});
    expect(readAttentionFiles(makeClient({ "otra-cosa.md": "x" }))).toBeNull();
  });

  it("la plantilla del producto se lee completa", () => {
    const files = readAttentionFiles("clientes/_plantilla");
    expect(Object.keys(files?.knowledge ?? {}).sort()).toEqual(["creditos", "viajes"]);
    expect(files?.knowledge.creditos).toContain("6 meses de antigüedad");
  });

  it("quita los comentarios HTML: son notas del equipo, no contenido para el modelo", () => {
    const root = makeClient({
      "agente-prompt.md": "Sos el asistente.\n<!-- nota interna -->\nRespondé breve.",
      "conocimiento/viajes.md": "Hasta 12 cuotas.\n\n<!-- DECISIÓN PENDIENTE: confirmar el tope -->\n\n\nSalidas en enero.",
    });
    const files = readAttentionFiles(root);
    expect(files?.prompt).not.toContain("nota interna");
    expect(files?.knowledge.viajes).not.toContain("DECISIÓN PENDIENTE");
    expect(files?.knowledge.viajes).toBe("Hasta 12 cuotas.\n\nSalidas en enero.");
  });
});
