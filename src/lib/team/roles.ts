import type { Database } from "@/lib/supabase/database.types";

// Roles y reglas de contraseña que comparten el servidor y el navegador. Va aparte de members.ts porque ese archivo usa
// módulos solo de servidor (node:crypto) y no puede entrar al código que corre en el navegador.

export type Role = Database["public"]["Enums"]["app_role"];

export const ROLES: Role[] = ["superadmin", "operator", "viewer"];
export const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Superadministrador",
  operator: "Operador",
  viewer: "Consulta y reportes",
};

export const MIN_PASSWORD_LENGTH = 12;
// Tiempo de vida del enlace de acceso: lo define Supabase (por defecto 1 hora).
export const ACCESS_LINK_MINUTES = 60;
