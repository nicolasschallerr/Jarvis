import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Tipografía con carácter para los títulos; el texto usa Geist.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Jarvis",
  description: "Atención al afiliado, CRM omnicanal y análisis de datos",
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
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
