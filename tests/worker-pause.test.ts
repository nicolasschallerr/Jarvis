import { describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./helpers/supabase-test";

// Pausa del trabajador real durante las pruebas (ver tests/helpers/pause-worker.ts). Se prueba la función de la
// base y que, mientras corre la suite, el trabajador esté realmente pausado. Deja el estado como lo encontró.

const admin = adminClient();
const optedOut = process.env.JARVIS_NO_PAUSAR_TRABAJADOR === "1";

async function state() {
  const { data, error } = await admin.rpc("set_worker_active");
  if (error) throw new Error(error.message);
  return data;
}

describe("pausa del trabajador", () => {
  it.skipIf(optedOut)("durante la suite el trabajador está pausado", async () => {
    expect(await state()).toBe(false);
  });

  it("la función cambia el estado, devuelve el anterior y consultar no lo cambia", async () => {
    const initial = await state();
    try {
      expect(await state()).toBe(initial);

      const previousOnEnable = await admin.rpc("set_worker_active", { p_active: true });
      expect(previousOnEnable.data).toBe(initial);
      expect(await state()).toBe(true);

      const previousOnPause = await admin.rpc("set_worker_active", { p_active: false });
      expect(previousOnPause.data).toBe(true);
      expect(await state()).toBe(false);
    } finally {
      await admin.rpc("set_worker_active", { p_active: initial });
    }
    expect(await state()).toBe(initial);
  });

  it("nadie sin la clave de servicio la puede llamar", async () => {
    const { error } = await anonClient().rpc("set_worker_active", { p_active: false });
    expect(error).not.toBeNull();
  });
});
