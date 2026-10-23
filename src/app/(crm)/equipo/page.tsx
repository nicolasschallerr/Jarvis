import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

import { SectorCard, type SectorView } from "./sector-card";

export default async function EquipoPage() {
  const profile = await getCurrentProfile();

  if (profile.role !== "superadmin") {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold tracking-tight">Equipo</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Solo un superadministrador puede ver y cambiar los equipos por sector.
        </p>
      </main>
    );
  }

  const supabase = await createClient();

  const { data: sectors, error } = await supabase
    .from("sectors")
    .select("id, name, sector_members(profile_id, is_lead, profiles(full_name))")
    .eq("is_active", true)
    .order("name");

  // Quienes pueden trabajar casos: superadmin y operadores activos.
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("role", ["superadmin", "operator"])
    .eq("is_active", true)
    .order("full_name");

  const views: SectorView[] = (sectors ?? []).map((sector) => {
    const memberIds = new Set(sector.sector_members.map((member) => member.profile_id));
    return {
      id: sector.id,
      name: sector.name,
      members: sector.sector_members.map((member) => ({
        profileId: member.profile_id,
        fullName: member.profiles?.full_name ?? "Sin nombre",
        isLead: member.is_lead,
      })),
      candidates: (people ?? [])
        .filter((person) => !memberIds.has(person.id))
        .map((person) => ({ profileId: person.id, fullName: person.full_name })),
    };
  });

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight">Equipo</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Quién trabaja en cada sector.</p>
      </header>

      {error ? (
        <p className="p-6 text-sm text-red-600 dark:text-red-400">No se pudieron cargar los sectores. Probá recargar.</p>
      ) : views.length === 0 ? (
        <p className="p-6 text-sm text-zinc-600 dark:text-zinc-400">
          Todavía no hay sectores. Se cargan con el script de configuración del cliente.
        </p>
      ) : (
        <div className="grid gap-4 p-6 md:grid-cols-2">
          {views.map((view) => (
            <SectorCard key={view.id} sector={view} />
          ))}
        </div>
      )}
    </main>
  );
}
