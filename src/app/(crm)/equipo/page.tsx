import { connection } from "next/server";
import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { TeamIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { memberEmails } from "@/lib/team/members";

import { People, type PersonView } from "./people";
import { SectorCard, type SectorView } from "./sector-card";

export const metadata = { title: "Equipo" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

export default async function EquipoPage() {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  const profile = await getCurrentProfile();

  if (profile.role !== "superadmin") {
    return <NoAccess title="Equipo" reason="Solo un superadministrador puede ver y cambiar los equipos por sector." />;
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

  // Todas las personas de la organización (también las desactivadas) con su email, que vive en el sistema de cuentas.
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, role, is_active").order("full_name");
  const emails = await memberEmails(createAdminClient(), (profiles ?? []).map((person) => person.id));
  const everyone: PersonView[] = (profiles ?? []).map((person) => ({
    id: person.id,
    fullName: person.full_name,
    email: emails.get(person.id) ?? "",
    role: person.role,
    isActive: person.is_active,
    isYou: person.id === profile.id,
  }));

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
      <PageHeader
        title="Equipo"
        description="Quién trabaja en cada sector. El agente deriva cada caso al sector que corresponde y avisa a su equipo."
      />

      {error ? (
        <ErrorBanner>No se pudieron cargar los sectores. Probá recargar.</ErrorBanner>
      ) : views.length === 0 ? (
        <EmptyState
          icon={<TeamIcon className="size-6" />}
          title="Todavía no hay sectores"
          description="Se cargan con el script de configuración del cliente."
        />
      ) : (
        <div className="grid gap-4 p-4 sm:p-6 md:grid-cols-2 2xl:grid-cols-3">
          {views.map((view) => (
            <SectorCard key={view.id} sector={view} />
          ))}
        </div>
      )}

      <div className="p-4 pt-0 sm:p-6 sm:pt-0">
        <People people={everyone} />
      </div>
    </main>
  );
}
