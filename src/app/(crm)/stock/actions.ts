"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { addFileSource, addSheetSource, deleteSource, MAX_FILE_BYTES, syncSourceAs, type SourceResult } from "@/lib/catalog/sources";
import { createAdminClient } from "@/lib/supabase/admin";

export type SourceFormState = { error: string | null; message: string | null };

const done = (result: SourceResult): SourceFormState => {
  revalidatePath("/stock");
  return result.ok ? { error: null, message: result.message } : { error: result.error, message: null };
};

// Las tres acciones comprueban quién es el usuario (superadmin) dentro de lib/catalog/sources.ts; el servidor escribe
// con la clave de servicio pero siempre acotado a la organización del perfil.

export async function addSheetAction(_previous: SourceFormState, formData: FormData): Promise<SourceFormState> {
  const hours = Number(formData.get("syncEveryHours"));
  return done(
    await addSheetSource({
      admin: createAdminClient(),
      profile: await getCurrentProfile(),
      name: String(formData.get("name") ?? ""),
      url: String(formData.get("url") ?? ""),
      syncEveryHours: Number.isInteger(hours) && hours > 0 ? hours : null,
    }),
  );
}

export async function addFileAction(_previous: SourceFormState, formData: FormData): Promise<SourceFormState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí un archivo CSV.", message: null };
  if (file.size > MAX_FILE_BYTES) return { error: "El archivo pesa más de 5 MB.", message: null };
  const sourceId = String(formData.get("sourceId") ?? "");
  return done(
    await addFileSource({
      admin: createAdminClient(),
      profile: await getCurrentProfile(),
      name: String(formData.get("name") ?? ""),
      fileName: file.name,
      text: await file.text(),
      sourceId: sourceId || undefined,
    }),
  );
}

export async function syncSourceAction(sourceId: string): Promise<SourceFormState> {
  return done(await syncSourceAs({ admin: createAdminClient(), profile: await getCurrentProfile(), sourceId }));
}

export async function deleteSourceAction(sourceId: string): Promise<SourceFormState> {
  return done(await deleteSource({ admin: createAdminClient(), profile: await getCurrentProfile(), sourceId }));
}
