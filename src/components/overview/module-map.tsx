import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ArrowRightIcon } from "@/components/ui/icons";
import type { Section, SectionGroup } from "@/app/(crm)/sections";

type Tint = { icon: string; wash: string; mark: string };

// Cada módulo tiene su color: el ícono, un velo suave de fondo y la marca de agua. Son clases completas (Tailwind no
// arma nombres a partir de texto).
const TINTS = {
  accent: { icon: "bg-accent-soft text-accent", wash: "from-accent-soft/80", mark: "text-accent" },
  info: { icon: "bg-info-soft text-info", wash: "from-info-soft/80", mark: "text-info" },
  warning: { icon: "bg-warning-soft text-warning", wash: "from-warning-soft/80", mark: "text-warning" },
  success: { icon: "bg-success-soft text-success", wash: "from-success-soft/80", mark: "text-success" },
  sinapsis: { icon: "bg-agent-sinapsis/15 text-agent-sinapsis", wash: "from-agent-sinapsis/10", mark: "text-agent-sinapsis" },
  stock: { icon: "bg-agent-stock/15 text-agent-stock", wash: "from-agent-stock/10", mark: "text-agent-stock" },
  finance: { icon: "bg-agent-finance/15 text-agent-finance", wash: "from-agent-finance/10", mark: "text-agent-finance" },
  assistant: { icon: "bg-agent-assistant/15 text-agent-assistant", wash: "from-agent-assistant/10", mark: "text-agent-assistant" },
} satisfies Record<string, Tint>;

const TINT_OF: Record<string, Tint> = {
  "/conversaciones": TINTS.accent,
  "/casos": TINTS.info,
  "/avisos": TINTS.warning,
  "/contactos": TINTS.success,
  "/stock": TINTS.stock,
  "/asistente": TINTS.assistant,
  "/analitico": TINTS.sinapsis,
  "/finanzas": TINTS.finance,
  "/reportes": TINTS.info,
  "/consumo": TINTS.success,
};

// Los dos módulos del trabajo de todos los días: tarjetas grandes.
const FEATURED = new Set(["/conversaciones", "/casos"]);

export type ModuleMetric = { text: string; tone: "neutral" | "info" | "success" | "warning" | "danger" | "accent" };

const stagger = (index: number) => ({ animationDelay: `${index * 0.06}s` });

function Metric({ metric }: { metric?: ModuleMetric }) {
  if (!metric) return null;
  return (
    <Badge tone={metric.tone} dot>
      {metric.text}
    </Badge>
  );
}

// Tarjeta grande: el módulo, el dato en vivo y una marca de agua del ícono que se inclina al pasar el mouse.
function FeaturedCard({ section, metric, index }: { section: Section; metric?: ModuleMetric; index: number }) {
  const tint = TINT_OF[section.href] ?? TINTS.accent;
  return (
    <li className="rise-in" style={stagger(index)}>
      <Link
        href={section.href}
        className={`card spotlight group relative flex h-full min-h-40 flex-col justify-between gap-6 overflow-hidden bg-linear-to-br ${tint.wash} via-surface to-surface p-5 transition duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-accent/40`}
      >
        <span
          className={`pointer-events-none absolute -right-5 -bottom-6 size-36 opacity-[0.08] transition duration-500 group-hover:-rotate-6 group-hover:scale-110 group-hover:opacity-[0.14] [&>svg]:size-full ${tint.mark}`}
          aria-hidden="true"
        >
          {section.icon}
        </span>
        <span className="relative flex items-start justify-between gap-3">
          <span className={`grid size-11 place-items-center rounded-2xl [&>svg]:size-5 ${tint.icon}`} aria-hidden="true">
            {section.icon}
          </span>
          <Metric metric={metric} />
        </span>
        <span className="relative flex flex-col gap-1">
          <span className="flex items-center gap-2 font-display text-lg font-semibold">
            {section.label}
            <ArrowRightIcon className="size-4 -translate-x-1 text-accent opacity-0 transition duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
          </span>
          <span className="max-w-md text-sm text-muted">{section.description}</span>
        </span>
      </Link>
    </li>
  );
}

// Tarjeta mediana: ícono, nombre, una línea de qué es y el dato si hay.
function MediumCard({ section, metric, index }: { section: Section; metric?: ModuleMetric; index: number }) {
  const tint = TINT_OF[section.href] ?? TINTS.accent;
  return (
    <li className="rise-in" style={stagger(index)}>
      <Link
        href={section.href}
        className="card spotlight group flex h-full items-center gap-3.5 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
      >
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl transition duration-200 group-hover:scale-110 group-hover:-rotate-3 ${tint.icon}`} aria-hidden="true">
          {section.icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center justify-between gap-2 text-sm font-semibold">
            {section.label}
            <Metric metric={metric} />
          </span>
          <span className="line-clamp-2 text-[13px] text-muted">{section.description}</span>
        </span>
      </Link>
    </li>
  );
}

// Acceso compacto (administración): se usa menos, así que ocupa menos. La descripción queda en el título.
function ChipLink({ section, index }: { section: Section; index: number }) {
  return (
    <li className="rise-in" style={stagger(index)}>
      <Link
        href={section.href}
        title={section.description}
        className="group flex items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pr-4 pl-1.5 text-sm font-medium transition duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-sm"
      >
        <span className="grid size-7 place-items-center rounded-full bg-zinc-100 text-muted transition duration-200 group-hover:bg-accent-soft group-hover:text-accent dark:bg-zinc-800" aria-hidden="true">
          {section.icon}
        </span>
        {section.label}
        <ArrowRightIcon className="size-3.5 -translate-x-1 text-accent opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
      </Link>
    </li>
  );
}

function GroupTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h3 id={id} className="eyebrow shrink-0">
        {children}
      </h3>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}

// El mapa del CRM en el Panorama: cada grupo a su medida. Lo de todos los días va grande y con su dato en vivo; la
// inteligencia, con color propio; la administración, compacta. Muestra solo lo que la persona puede usar.
export function ModuleMap({ groups, metrics }: { groups: SectionGroup[]; metrics: Record<string, ModuleMetric | undefined> }) {
  let counter = 12;
  const visible = groups.map((group) => ({ ...group, sections: group.sections.filter((section) => section.href !== "/inicio") })).filter((group) => group.sections.length > 0);

  return (
    <div className="flex flex-col gap-7">
      {visible.map((group) => {
        const featured = group.sections.filter((section) => FEATURED.has(section.href));
        const rest = group.sections.filter((section) => !FEATURED.has(section.href));
        const isAdmin = group.title === "Administración";
        const id = `mapa-${group.title.toLowerCase().replace(/[^a-z]/g, "")}`;

        return (
          <section key={group.title} aria-labelledby={id} className="flex flex-col gap-3">
            <GroupTitle id={id}>{group.title}</GroupTitle>

            {isAdmin ? (
              <ul className="flex flex-wrap gap-2.5">
                {group.sections.map((section) => (
                  <ChipLink key={section.href} section={section} index={counter++} />
                ))}
              </ul>
            ) : (
              <>
                {featured.length > 0 ? (
                  <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {featured.map((section) => (
                      <FeaturedCard key={section.href} section={section} metric={metrics[section.href]} index={counter++} />
                    ))}
                  </ul>
                ) : null}
                {rest.length > 0 ? (
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {rest.map((section) => (
                      <MediumCard key={section.href} section={section} metric={metrics[section.href]} index={counter++} />
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
