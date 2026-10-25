"use server";

import { redirect } from "next/navigation";

import { MIN_PASSWORD_LENGTH } from "@/lib/team/roles";
import { createClient } from "@/lib/supabase/server";

export type PasswordState = { error: string | null };

// Elegir una contraseña nueva. Pide sesión (la del enlace de acceso o la de quien ya está adentro).
export async function setPassword(_previous: PasswordState, formData: FormData): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH) return { error: `La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  if (password !== confirm) return { error: "Las dos contraseñas no coinciden." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const weak = /weak|pwned|leaked|compromised|same/i.test(error.message);
    return { error: weak ? "Esa contraseña no es segura o ya se usó antes. Probá con otra." : "No se pudo guardar la contraseña. Probá de nuevo." };
  }

  redirect("/inicio?bienvenida=1");
}
