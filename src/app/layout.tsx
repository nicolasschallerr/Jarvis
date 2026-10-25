import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

// Tipografías de la marca Orbita AI: Manrope para el logo, títulos y textos; JetBrains Mono para etiquetas,
// fechas y datos técnicos.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Cada página pone su nombre ("Casos · Orbita AI"): con varias pestañas abiertas se distinguen.
  title: { default: "Orbita AI", template: "%s · Orbita AI" },
  description: "Agentes de IA que atienden a tus clientes, CRM omnicanal y análisis de datos. Software y automatización con IA para empresas.",
};

// Fija el tema y el nivel de movimiento antes de que se pinte la página (sin destellos ni saltos). Usa la
// elección guardada y, si no hay, la preferencia del sistema. jarvis-motion: "on" (siempre activas) u "off"
// (reducidas); sin valor, se sigue a la preferencia de movimiento del sistema.
const THEME_SCRIPT = `(function(){try{var m=localStorage.getItem('jarvis-theme');var d=m==='dark'||(m!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';var o=localStorage.getItem('jarvis-motion');var r=o==='off'||(o!=='on'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);document.documentElement.dataset.motion=r?'reduce':'full';}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      // data-theme lo escribe el script de arriba antes de hidratar.
      suppressHydrationWarning
      className={`${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
