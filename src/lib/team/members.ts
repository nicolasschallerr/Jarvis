import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { recordAudit } from "@/lib/audit/record";

import { ROLES, type Role } from "./roles";

export { ACCESS_LINK_MINUTES, MIN_PASSWORD_LENGTH, ROLES, ROLE_LABELS, type Role } from "./roles";

// Personas de la organización (ADR-033). Todo lo hace un superadmin con el cliente de servicio, así que cada función
// verifica por su cuenta que la persona sea de la misma organización que quien actúa. Sin servicio de email: en vez
// de mandar un correo, se genera un enlace de acceso de un solo uso que el superadmin le pasa a la persona.

type Admin = SupabaseClient<Database>;
export type MemberResult = { ok: true; link?: string } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isRole(value: string): value is Role {
  return (ROLES as string[]).includes(value);
}

// Enlace de acceso: lleva a /auth/confirmar, que lo canjea por una sesión y manda a elegir la contraseña.
export async function accessLink(admin: Admin, email: string, siteUrl: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  const token = data?.properties?.hashed_token;
  if (error || !token) return null;
  return `${siteUrl.replace(/\/$/, "")}/auth/confirmar?token_hash=${encodeURIComponent(token)}&type=recovery`;
}

async function memberOf(admin: Admin, organizationId: string, userId: string) {
  const { data } = await admin.from("profiles").select("id, role, is_active, full_name").eq("id", userId).eq("organization_id", organizationId).maybeSingle();
  return data;
}

// ¿Queda otra persona superadmin activa además de esta? Una organización nunca se queda sin quien la administre.
async function otherActiveSuperadmin(admin: Admin, organizationId: string, exceptId: string): Promise<boolean> {
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "superadmin")
    .eq("is_active", true)
    .neq("id", exceptId);
  return (count ?? 0) > 0;
}

// Alta de una persona. La contraseña inicial es al azar y no se muestra a nadie: la persona elige la suya con el enlace.
export async function createMember(
  admin: Admin,
  params: { organizationId: string; email: string; fullName: string; role: string; siteUrl: string; actorId?: string | null },
): Promise<MemberResult> {
  const email = params.email.trim().toLowerCase();
  const fullName = params.fullName.trim();
  if (!EMAIL.test(email) || email.length > 200) return { ok: false, error: "Escribí un email válido." };
  if (fullName.length < 2 || fullName.length > 120) return { ok: false, error: "Escribí el nombre y apellido (hasta 120 caracteres)." };
  if (!isRole(params.role)) return { ok: false, error: "Elegí un rol." };

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
  });
  if (error || !created.user) {
    const exists = /already|registered|exists/i.test(error?.message ?? "");
    return { ok: false, error: exists ? "Ya hay una cuenta con ese email." : "No se pudo crear la cuenta." };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: created.user.id, organization_id: params.organizationId, full_name: fullName, role: params.role });
  if (profileError) {
    // Sin perfil la cuenta no sirve: se deshace para no dejar una cuenta huérfana.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "No se pudo crear la persona." };
  }

  await recordAudit(admin, {
    organizationId: params.organizationId,
    actorId: params.actorId ?? null,
    action: "person.created",
    entityType: "person",
    entityId: created.user.id,
    data: { name: fullName, role: params.role },
  });

  const link = await accessLink(admin, email, params.siteUrl);
  if (!link) return { ok: false, error: "La persona se creó, pero no se pudo generar su enlace. Generalo desde su fila." };
  return { ok: true, link };
}

// Enlace nuevo para entrar o para elegir otra contraseña (olvidó la suya).
export async function resetMemberAccess(
  admin: Admin,
  params: { organizationId: string; userId: string; siteUrl: string; actorId?: string | null },
): Promise<MemberResult> {
  const member = await memberOf(admin, params.organizationId, params.userId);
  if (!member) return { ok: false, error: "La persona no existe." };
  if (!member.is_active) return { ok: false, error: "La persona está desactivada: reactivala primero." };

  const { data } = await admin.auth.admin.getUserById(params.userId);
  const email = data.user?.email;
  if (!email) return { ok: false, error: "La persona no tiene email." };

  const link = await accessLink(admin, email, params.siteUrl);
  if (!link) return { ok: false, error: "No se pudo generar el enlace." };
  await recordAudit(admin, {
    organizationId: params.organizationId,
    actorId: params.actorId ?? null,
    action: "person.access_link",
    entityType: "person",
    entityId: params.userId,
    data: { name: member.full_name },
  });
  return { ok: true, link };
}

export async function setMemberRole(admin: Admin, params: { organizationId: string; actorId: string; userId: string; role: string }): Promise<MemberResult> {
  if (!isRole(params.role)) return { ok: false, error: "Elegí un rol." };
  if (params.userId === params.actorId) return { ok: false, error: "No podés cambiar tu propio rol: pedíselo a otro superadministrador." };

  const member = await memberOf(admin, params.organizationId, params.userId);
  if (!member) return { ok: false, error: "La persona no existe." };
  if (member.role === params.role) return { ok: true };
  if (member.role === "superadmin" && member.is_active && !(await otherActiveSuperadmin(admin, params.organizationId, params.userId))) {
    return { ok: false, error: "Tiene que quedar al menos un superadministrador activo." };
  }

  const { error } = await admin.from("profiles").update({ role: params.role }).eq("id", params.userId).eq("organization_id", params.organizationId);
  if (error) return { ok: false, error: "No se pudo cambiar el rol." };
  await recordAudit(admin, {
    organizationId: params.organizationId,
    actorId: params.actorId,
    action: "person.role_changed",
    entityType: "person",
    entityId: params.userId,
    data: { name: member.full_name, from: member.role, to: params.role },
  });
  return { ok: true };
}

// Desactivar corta el acceso al CRM y bloquea el ingreso (una sesión abierta deja de servir); reactivar lo devuelve.
export async function setMemberActive(admin: Admin, params: { organizationId: string; actorId: string; userId: string; active: boolean }): Promise<MemberResult> {
  if (params.userId === params.actorId) return { ok: false, error: "No podés desactivar tu propia cuenta." };

  const member = await memberOf(admin, params.organizationId, params.userId);
  if (!member) return { ok: false, error: "La persona no existe." };
  if (member.is_active === params.active) return { ok: true };
  if (!params.active && member.role === "superadmin" && !(await otherActiveSuperadmin(admin, params.organizationId, params.userId))) {
    return { ok: false, error: "Tiene que quedar al menos un superadministrador activo." };
  }

  const { error } = await admin.from("profiles").update({ is_active: params.active }).eq("id", params.userId).eq("organization_id", params.organizationId);
  if (error) return { ok: false, error: "No se pudo cambiar el estado." };

  // Bloquear el ingreso en Supabase (casi 100 años) o levantarlo.
  await admin.auth.admin.updateUserById(params.userId, { ban_duration: params.active ? "none" : "876000h" });
  await recordAudit(admin, {
    organizationId: params.organizationId,
    actorId: params.actorId,
    action: params.active ? "person.reactivated" : "person.deactivated",
    entityType: "person",
    entityId: params.userId,
    data: { name: member.full_name },
  });
  return { ok: true };
}

// Emails de las personas (viven en el sistema de cuentas, no en el perfil). Equipos chicos: una consulta por persona.
export async function memberEmails(admin: Admin, userIds: string[]): Promise<Map<string, string>> {
  const entries = await Promise.all(
    userIds.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      return [id, data.user?.email ?? ""] as const;
    }),
  );
  return new Map(entries);
}
