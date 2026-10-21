import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Las pruebas de integración hablan con Supabase por red.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
