import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Canjea el enlace de acceso (un solo uso) por una sesión y manda a elegir la contraseña. Solo se aceptan enlaces de
// tipo "recovery": son los que genera el superadmin desde Equipo. El destino es fijo (no se lee de la dirección),
// así el enlace no sirve para redirigir a otro sitio.
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (tokenHash && type === "recovery") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL("/nueva-clave", request.url));
  }

  return NextResponse.redirect(new URL("/login?motivo=enlace-invalido", request.url));
}
