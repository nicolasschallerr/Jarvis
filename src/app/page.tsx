import Link from "next/link";

import { OrbitVisual } from "@/components/ui/orbit-visual";
import { BotIcon, CaseIcon, ChartIcon, ChatIcon, ContactsIcon, SparkIcon } from "@/components/ui/icons";
import { Logo } from "@/components/ui/logo";

// Página pública de Orbita AI: qué hace el producto y la entrada al panel. No lee la sesión, así que se
// prerenderiza entera (es estática y carga al instante).

const CAPABILITIES = [
  {
    icon: <ChatIcon className="size-5" />,
    title: "Agente de atención 24/7",
    text: "Entiende desde el primer mensaje qué necesita cada persona, responde con tu información, junta los datos y deriva al sector correcto con un resumen.",
  },
  {
    icon: <CaseIcon className="size-5" />,
    title: "CRM omnicanal",
    text: "Todas las conversaciones en una bandeja: casos por sector, asignaciones, notas internas y la opción de tomar el chat en cualquier momento.",
  },
  {
    icon: <SparkIcon className="size-5" />,
    title: "Agente analítico",
    text: "Preguntá en lenguaje natural cuántas consultas hubo, qué sector está demorado o cuánto se consumió. Solo lectura, con tus datos.",
  },
];

const STEPS = [
  { tag: "01 · ESCUCHA", text: "Llega un mensaje por WhatsApp o Telegram, con texto, audio, foto o PDF." },
  { tag: "02 · ENTIENDE", text: "El agente reconoce el tema y responde como una persona, sin menús eternos." },
  { tag: "03 · RESUELVE", text: "Junta los datos que hacen falta, abre el caso y lo deriva al sector que corresponde." },
  { tag: "04 · MIDE", text: "Cada gestión queda registrada: tiempos, consumo y calidad, listos para analizar." },
];

const NUMBERS = [
  { value: "24/7", label: "atención sin horarios" },
  { value: "< 1 min", label: "primera respuesta" },
  { value: "1", label: "bandeja para todos los canales" },
];

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Halo de marca detrás del encabezado. */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full opacity-80 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
        aria-hidden="true"
      />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2 text-sm" aria-label="Principal">
          <a href="#producto" className="hidden rounded-lg px-3 py-2 text-muted transition hover:text-foreground sm:inline">
            Producto
          </a>
          <a href="#como-funciona" className="hidden rounded-lg px-3 py-2 text-muted transition hover:text-foreground sm:inline">
            Cómo funciona
          </a>
          <Link href="/login" className="btn-primary">
            Ingresar
          </Link>
        </nav>
      </header>

      <main id="contenido" className="relative z-10 flex flex-1 flex-col">
        <section className="mx-auto grid grid-cols-1 w-full max-w-6xl items-center gap-10 px-5 pt-10 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div className="rise-in flex flex-col gap-6">
            <p className="eyebrow">Software y automatización con IA</p>
            <h1 className="text-4xl leading-[1.05] font-bold tracking-tight sm:text-6xl">
              Agentes de IA que atienden a tus clientes <span className="text-accent">como tu mejor equipo</span>
            </h1>
            <p className="max-w-xl text-lg text-muted">
              Orbita AI junta en un solo lugar un agente que conversa por WhatsApp, un CRM para tu equipo y un analista que responde
              preguntas sobre tu negocio.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/login" className="btn-primary !px-5 !py-2.5 text-base">
                Entrar al panel
              </Link>
              <a href="#como-funciona" className="btn-secondary !px-5 !py-2.5 text-base">
                Ver cómo funciona
              </a>
            </div>
            <dl className="mt-4 grid max-w-lg grid-cols-3 gap-4">
              {NUMBERS.map((item) => (
                <div key={item.label} className="flex flex-col gap-1">
                  <dt className="order-2 text-xs text-muted">{item.label}</dt>
                  <dd className="order-1 font-mono text-2xl font-semibold text-accent">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Los agentes, en órbita. */}
          <OrbitVisual className="mx-auto w-full max-w-md text-zinc-400 dark:text-zinc-600" labels={{ top: "Atención · en línea", bottom: "Análisis · listo" }} />
        </section>

        <section id="producto" className="border-t border-line bg-surface/60 py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5">
            <div className="flex max-w-2xl flex-col gap-3">
              <p className="eyebrow">Producto</p>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Tres piezas que trabajan juntas</h2>
              <p className="text-muted">Cada una sirve sola; juntas cubren la atención de punta a punta, del primer mensaje al reporte.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {CAPABILITIES.map((item, index) => (
                <article key={item.title} className="card rise-in flex flex-col gap-3 p-6" style={{ animationDelay: `${index * 0.08}s` }}>
                  <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">{item.icon}</span>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="text-sm text-muted">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className="py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5">
            <div className="flex max-w-2xl flex-col gap-3">
              <p className="eyebrow">Cómo funciona</p>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Del mensaje al caso resuelto</h2>
            </div>
            <ol className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {STEPS.map((step) => (
                <li key={step.tag} className="relative flex flex-col gap-3 rounded-xl border border-line p-5">
                  <span className="font-mono text-xs tracking-wider text-accent">{step.tag}</span>
                  <p className="text-sm">{step.text}</p>
                </li>
              ))}
            </ol>
            <ul className="flex flex-wrap gap-2 text-sm text-muted">
              {[
                { icon: <ChatIcon className="size-4" />, text: "WhatsApp y Telegram" },
                { icon: <BotIcon className="size-4" />, text: "Toma de chat por una persona" },
                { icon: <ContactsIcon className="size-4" />, text: "Ficha única por contacto" },
                { icon: <ChartIcon className="size-4" />, text: "Consumo y métricas" },
              ].map((item) => (
                <li key={item.text} className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5">
                  <span className="text-accent">{item.icon}</span>
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-line bg-zinc-950 py-20 text-zinc-100">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-5 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-3">
              <p className="font-mono text-xs tracking-wider text-[#22b8c9] uppercase">Automatizá lo que se repite</p>
              <h2 className="max-w-xl text-3xl font-bold tracking-tight">Si una consulta llega tres veces por semana, ya es candidata a automatizarse.</h2>
            </div>
            <Link href="/login" className="inline-flex items-center rounded-lg bg-[#22b8c9] px-5 py-2.5 font-semibold text-[#04232a] transition hover:-translate-y-px">
              Entrar al panel
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted">
          <Logo />
          <p className="font-mono text-xs">orbita.ai · @orbita.ai · © 2026</p>
        </div>
      </footer>
    </div>
  );
}
