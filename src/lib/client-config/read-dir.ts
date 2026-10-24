import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AttentionFiles } from "./attention";

// Lee de la carpeta de un cliente el prompt del agente (agente-prompt.md) y su conocimiento
// (conocimiento/<unidad>.md). Es para scripts: usa el disco, no se importa desde la aplicación web.
// Devuelve null si no hay prompt.
export function readAttentionFiles(directory: string): AttentionFiles | null {
  const promptFile = join(directory, "agente-prompt.md");
  if (!existsSync(promptFile)) return null;

  const knowledge: Record<string, string> = {};
  const knowledgeDir = join(directory, "conocimiento");
  if (existsSync(knowledgeDir)) {
    for (const name of readdirSync(knowledgeDir)) {
      if (name.endsWith(".md")) knowledge[name.slice(0, -3)] = readFileSync(join(knowledgeDir, name), "utf8");
    }
  }

  return { prompt: readFileSync(promptFile, "utf8"), knowledge };
}
