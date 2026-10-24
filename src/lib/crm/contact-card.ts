import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export const MAX_NAME_LENGTH = 120;
export const MAX_LOCALITY_LENGTH = 80;
export const MAX_CONTACT_NOTES_LENGTH = 1000;

// Un documento (DNI) tiene 7 u 8 dígitos y un CUIL/CUIT, 11. Se aceptan puntos, espacios y guiones al
// escribirlo, pero se guarda solo con dígitos para poder buscar y comparar.
const DOCUMENT_MIN_DIGITS = 7;
const DOCUMENT_MAX_DIGITS = 11;

export type ContactCardInput = {
  displayName: string;
  documentNumber: string;
  locality: string;
  notes: string;
};

export type ContactCardResult =
  | { ok: true; changed: string[]; warning: string | null }
  | { ok: false; error: string };

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// Guarda la ficha del asociado. La lectura es abierta en la organización (ADR-016) y la edición, de
// superadmin y operadores (RLS contacts_update). El historial de cambios lo escribe un disparador.
export async function updateContactCard(params: {
  userClient: SupabaseClient<Database>;
  profile: { role: "superadmin" | "operator" | "viewer" };
  contactId: string;
  input: ContactCardInput;
}): Promise<ContactCardResult> {
  if (params.profile.role === "viewer") {
    return { ok: false, error: "Tu rol es de consulta: no puede editar la ficha." };
  }

  const displayName = emptyToNull(params.input.displayName);
  const locality = emptyToNull(params.input.locality);
  const notes = emptyToNull(params.input.notes);

  if (displayName && displayName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `El nombre supera los ${MAX_NAME_LENGTH} caracteres.` };
  }
  if (locality && locality.length > MAX_LOCALITY_LENGTH) {
    return { ok: false, error: `La localidad supera los ${MAX_LOCALITY_LENGTH} caracteres.` };
  }
  if (notes && notes.length > MAX_CONTACT_NOTES_LENGTH) {
    return { ok: false, error: `Las notas superan los ${MAX_CONTACT_NOTES_LENGTH} caracteres.` };
  }

  const documentRaw = params.input.documentNumber.trim();
  let documentNumber: string | null = null;
  if (documentRaw) {
    if (!/^[\d.\-\s]+$/.test(documentRaw)) {
      return { ok: false, error: "El documento solo puede tener números (se aceptan puntos y guiones)." };
    }
    documentNumber = documentRaw.replace(/\D/g, "");
    if (documentNumber.length < DOCUMENT_MIN_DIGITS || documentNumber.length > DOCUMENT_MAX_DIGITS) {
      return { ok: false, error: `El documento tiene que tener entre ${DOCUMENT_MIN_DIGITS} y ${DOCUMENT_MAX_DIGITS} dígitos.` };
    }
  }

  const { data: current } = await params.userClient
    .from("contacts")
    .select("id, organization_id, display_name, document_number, locality, notes")
    .eq("id", params.contactId)
    .maybeSingle();
  if (!current) return { ok: false, error: "El contacto no existe." };

  const next = { display_name: displayName, document_number: documentNumber, locality, notes };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => (current[key] ?? null) !== next[key]);
  if (changed.length === 0) return { ok: true, changed: [], warning: null };

  const { data, error } = await params.userClient.from("contacts").update(next).eq("id", params.contactId).select("id");
  if (error) return { ok: false, error: "No se pudo guardar la ficha." };
  if (!data?.length) return { ok: false, error: "No tenés permiso para editar este contacto." };

  // Dos fichas con el mismo documento suelen ser la misma persona escribiendo por dos canales. No se
  // bloquea el guardado: se avisa. Unirlas lo hace el superadmin desde la ficha (Fase 12, ver contact-merge.ts).
  let warning: string | null = null;
  if (documentNumber && changed.includes("document_number")) {
    const { count } = await params.userClient
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("document_number", documentNumber)
      .neq("id", params.contactId)
      .is("merged_into", null);
    if (count) warning = "Ya hay otra ficha con ese documento: puede ser la misma persona escribiendo por otro canal. Un superadministrador puede unirlas desde la ficha.";
  }

  return { ok: true, changed, warning };
}
