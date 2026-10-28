import { AssistantIcon, BellIcon, BotIcon, CaseIcon, ChartIcon, ChatIcon, ContactsIcon, CoinIcon, GaugeIcon, GridIcon, InboxIcon, LockIcon, SendIcon, SparkIcon, StockIcon, TeamIcon } from "@/components/ui/icons";

type Role = "superadmin" | "operator" | "viewer";

export type Section = {
  href: string;
  label: string;
  // Una línea que dice para qué sirve: el menú la muestra al pasar el mouse y el Panorama, en sus accesos.
  description: string;
  icon: React.ReactNode;
  roles: readonly Role[];
  // Solo en las organizaciones que tienen catálogo (ADR-043).
  needsCatalog?: boolean;
};

export type SectionGroup = { title: string; sections: Section[] };

const ALL: readonly Role[] = ["superadmin", "operator", "viewer"];
const REPORTS: readonly Role[] = ["superadmin", "viewer"];
const ADMIN: readonly Role[] = ["superadmin"];

// Todas las secciones del CRM, agrupadas por para qué se usan. Un solo lugar: el menú y el Panorama leen de acá.
// Ocultar una sección es comodidad: la seguridad real está en la página, las acciones y RLS.
export const SECTION_GROUPS: SectionGroup[] = [
  {
    title: "Día a día",
    sections: [
      { href: "/inicio", label: "Panorama", description: "Todo de un vistazo: lo pendiente, la actividad y tus agentes.", icon: <GridIcon />, roles: ALL },
      { href: "/avisos", label: "Avisos", description: "Derivaciones, respuestas de los sectores y lo que te asignaron.", icon: <BellIcon />, roles: ALL },
      { href: "/conversaciones", label: "Conversaciones", description: "La bandeja de todos los canales en tiempo real: respondé o tomá el chat.", icon: <ChatIcon />, roles: ALL },
      { href: "/casos", label: "Casos", description: "Cada gestión con su estado, sector y responsable, en tablero o en lista.", icon: <CaseIcon />, roles: ALL },
      { href: "/contactos", label: "Contactos", description: "La ficha de cada contacto, con sus datos y su historial.", icon: <ContactsIcon />, roles: ALL },
      { href: "/stock", label: "Stock", description: "El catálogo de productos que consulta el agente.", icon: <StockIcon />, roles: ALL, needsCatalog: true },
    ],
  },
  {
    title: "Inteligencia",
    sections: [
      { href: "/asistente", label: "Asistente IA", description: "Inteligencia artificial conversacional: preguntale lo que sea de la empresa (casos, stock, finanzas, contactos).", icon: <AssistantIcon />, roles: REPORTS },
      { href: "/analitico", label: "Analítico", description: "Métricas de la atención: volumen, tiempos de respuesta y rendimiento por sector y persona.", icon: <SparkIcon />, roles: REPORTS },
      { href: "/finanzas", label: "Finanzas", description: "Ingresos, gastos y lo que falta cobrar, con el agente financiero.", icon: <CoinIcon />, roles: REPORTS },
      { href: "/reportes", label: "Reportes", description: "Volumen, tiempos de respuesta y casos por sector y por persona.", icon: <ChartIcon />, roles: REPORTS },
      { href: "/consumo", label: "Consumo", description: "Créditos usados, costo de la IA y límites del mes.", icon: <GaugeIcon />, roles: REPORTS },
    ],
  },
  {
    title: "Administración",
    sections: [
      { href: "/agentes", label: "Agentes", description: "Encendé, pausá y personalizá a tus agentes.", icon: <BotIcon />, roles: ADMIN },
      { href: "/equipo", label: "Equipo", description: "Usuarios, roles y el sector de cada persona.", icon: <TeamIcon />, roles: ADMIN },
      { href: "/plantillas", label: "Plantillas", description: "Mensajes aprobados por Meta para escribir fuera de las 24 horas.", icon: <InboxIcon />, roles: ADMIN },
      { href: "/envios", label: "Envíos", description: "Envíos masivos a los contactos que dieron su consentimiento.", icon: <SendIcon />, roles: ADMIN },
      { href: "/auditoria", label: "Auditoría", description: "Quién hizo qué y cuándo, para control.", icon: <LockIcon />, roles: ADMIN },
    ],
  },
];

// Las secciones que ve una persona según su rol y si la organización tiene stock conectado (ADR-047: lo conecta el
// equipo de Orbita AI, no el cliente). El superadmin ve Stock siempre, para poder revisarlo aunque todavía esté vacío.
// Los grupos vacíos no se muestran.
export function sectionsFor(role: Role, hasCatalog: boolean): SectionGroup[] {
  return SECTION_GROUPS.map((group) => ({
    title: group.title,
    sections: group.sections.filter(
      (section) => section.roles.includes(role) && (!section.needsCatalog || hasCatalog || role === "superadmin"),
    ),
  })).filter((group) => group.sections.length > 0);
}
