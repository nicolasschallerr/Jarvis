import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "./database.types";

// Rutas que se pueden ver sin iniciar sesión: la página pública de Orbita AI ("/", exacta) y el ingreso.
const PUBLIC_PATHS = ["/login"];
const PUBLIC_EXACT = ["/"];

// Refresca la sesión de Supabase en cada pedido y redirige a /login si no hay sesión válida.
// Las rutas /api/* quedan afuera (ver el matcher en src/proxy.ts): cada una valida su propio
// acceso (firma de Meta, secreto del trabajador, etc.).
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims() verifica la firma del token. Nunca usar getSession() acá: lee la cookie sin
  // validarla y cualquiera puede falsificarla.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!isAuthenticated && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Con sesión iniciada, /login no tiene sentido: se manda al panel.
  // Excepción: si el CRM lo mandó acá porque su usuario no tiene acceso, se queda para leer el motivo.
  if (isAuthenticated && pathname === "/login" && !request.nextUrl.searchParams.has("motivo")) {
    const url = request.nextUrl.clone();
    url.pathname = "/inicio";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Hay que devolver supabaseResponse tal cual: lleva las cookies de sesión refrescadas.
  return supabaseResponse;
}
