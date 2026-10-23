"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

const REFRESH_DELAY_MS = 400;

type Scope = { organizationId: string } | { conversationId: string };

// Mantiene la pantalla al día sin recargar: escucha los cambios de la base (Supabase Realtime) y
// pide a Next que vuelva a leer los datos de la página. Realtime respeta RLS con la sesión del
// usuario, así que solo llegan eventos de lo que puede ver. No muestra nada por sí mismo.
export function LiveRefresh(props: Scope) {
  const router = useRouter();
  const conversationId = "conversationId" in props ? props.conversationId : null;
  const organizationId = "organizationId" in props ? props.organizationId : null;

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Varios eventos seguidos (un mensaje y la conversación que se actualiza) provocan una sola lectura.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
    };

    const messageFilter = conversationId ? `conversation_id=eq.${conversationId}` : `organization_id=eq.${organizationId}`;
    const channel = supabase
      // wait: true hace que la suscripción cuente como lista recién cuando el servidor la confirma.
      .channel(`crm-${conversationId ?? organizationId}`, { config: { postgres_changes_options: { wait: true } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: messageFilter }, refresh);

    // La lista también cambia cuando se crea o actualiza una conversación.
    if (organizationId) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `organization_id=eq.${organizationId}` },
        refresh,
      );
    }

    // Realtime necesita el token de la sesión para aplicar RLS antes de suscribirse.
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      void supabase.realtime.setAuth(data.session?.access_token ?? null).then(() => {
        if (!cancelled) channel.subscribe();
      });
    });

    // Red de seguridad: al volver a la pestaña se vuelve a leer, por si se perdió algún evento.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [router, conversationId, organizationId]);

  return null;
}
