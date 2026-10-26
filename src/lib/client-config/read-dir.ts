import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { AttentionFiles } from "./attention";

function markdownFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b, "es"));
}

// Los comentarios HTML (<!-- ... -->) son notas para el equipo (por ejemplo, una DECISIÓN PENDIENTE): no le llegan al modelo.
export function withoutComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n");
}

// Lee de la carpeta de un cliente el prompt del agente (agente-prompt.md) y su conocimiento. El
// conocimiento de cada unidad (o "rama") puede estar de dos formas, y se pueden mezclar:
//   conocimiento/<unidad>.md           un solo archivo
//   conocimiento/<unidad>/*.md         una carpeta con varios archivos (información, datos a juntar,
//                                      mensajes fijos...), que se unen en orden alfabético
// Si existen las dos, primero va el archivo suelto y después la carpeta.
//
// Es para scripts: usa el disco, no se importa desde la aplicación web. Devuelve null si no hay prompt.
export function readAttentionFiles(directory: string): AttentionFiles | null {
  const promptFile = join(directory, "agente-prompt.md");
  if (!existsSync(promptFile)) return null;

  const pieces = new Map<string, string[]>();
  const add = (unit: string, text: string) => pieces.set(unit, [...(pieces.get(unit) ?? []), withoutComments(text).trim()]);

  const knowledgeDir = join(directory, "conocimiento");
  if (existsSync(knowledgeDir)) {
    const entries = readdirSync(knowledgeDir).sort((a, b) => a.localeCompare(b, "es"));

    // Primero los archivos sueltos, después las carpetas.
    for (const name of entries) {
      const path = join(knowledgeDir, name);
      if (name.endsWith(".md") && statSync(path).isFile()) add(name.slice(0, -3), readFileSync(path, "utf8"));
    }
    for (const name of entries) {
      const path = join(knowledgeDir, name);
      if (!statSync(path).isDirectory()) continue;
      for (const file of markdownFiles(path)) add(name, readFileSync(join(path, file), "utf8"));
    }
  }

  const knowledge: Record<string, string> = {};
  for (const [unit, texts] of pieces) {
    const joined = texts.filter(Boolean).join("\n\n");
    if (joined) knowledge[unit] = joined;
  }

  return { prompt: withoutComments(readFileSync(promptFile, "utf8")).trim(), knowledge };
}
