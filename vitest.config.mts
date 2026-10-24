import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      // "server-only" falla a propósito fuera de Next.js; en las pruebas se reemplaza por un vacío.
      "server-only": fromRoot("./tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // Pausa el trabajador real de mensajes mientras corren las pruebas y lo reanuda al terminar.
    globalSetup: ["./tests/helpers/pause-worker.ts"],
    // Los archivos corren de a uno: comparten la misma base y el trabajador toma eventos de cualquier prueba.
    fileParallelism: false,
    // Las pruebas de integración hablan con Supabase por red.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
