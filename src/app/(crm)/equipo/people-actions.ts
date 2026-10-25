"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getCurrentProfile } from "@/lib/auth/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { createMember, resetMemberAccess, setMemberActive, setMemberRole, type MemberResult } from "@/lib/team/members";

export type PeopleState = { error: string | null; link: string | null; notice: string | null };

const NO_PERMISSION: PeopleState = { error: "Solo un superadministrador puede administrar a las personas.", link: null, notice: null };

// De dónde se abre el enlace de acceso: el sitio desde el que está trabajando quien lo genera.
async function siteUrl(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

function toState(result: MemberResult, notice: string): PeopleState {
  return result.ok ? { error: null, link: result.link ?? null, notice } : { error: result.error, link: null, notice: null };
}

// Todas las acciones vuelven a comprobar el rol acá: el formulario es solo comodidad. La organización sale de la
// sesión de quien actúa, nunca del navegador.
export async function addMemberAction(_previous: PeopleState, formData: FormData): Promise<PeopleState> {
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return NO_PERMISSION;

  const result = await createMember(createAdminClient(), {
    organizationId: profile.organizationId,
    email: String(formData.get("email") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    role: String(formData.get("role") ?? ""),
    siteUrl: await siteUrl(),
    actorId: profile.id,
  });
  revalidatePath("/equipo");
  return toState(result, "Persona creada. Pasale este enlace para que elija su contraseña.");
}

export async function resetAccessAction(userId: string): Promise<PeopleState> {
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return NO_PERMISSION;
  const result = await resetMemberAccess(createAdminClient(), { organizationId: profile.organizationId, userId, siteUrl: await siteUrl(), actorId: profile.id });
  return toState(result, "Enlace listo. Pasaselo a la persona para que elija una contraseña nueva.");
}

export async function changeRoleAction(userId: string, role: string): Promise<PeopleState> {
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return NO_PERMISSION;
  const result = await setMemberRole(createAdminClient(), { organizationId: profile.organizationId, actorId: profile.id, userId, role });
  revalidatePath("/equipo");
  return toState(result, "Rol actualizado.");
}

export async function changeActiveAction(userId: string, active: boolean): Promise<PeopleState> {
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return NO_PERMISSION;
  const result = await setMemberActive(createAdminClient(), { organizationId: profile.organizationId, actorId: profile.id, userId, active });
  revalidatePath("/equipo");
  return toState(result, active ? "Persona reactivada." : "Persona desactivada: ya no puede entrar.");
}
