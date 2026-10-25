"use client";

import { useState, useTransition } from "react";

import { PauseIcon, PlayIcon } from "@/components/ui/icons";

import { switchConversationAi } from "./ai-actions";

// Botón para cambiar quién atiende la conversación: Jarvis o una persona del equipo.
export function AiSwitch({
  conversationId,
  agentName,
  aiEnabled,
  canChange,
}: {
  conversationId: string;
  agentName: string;
  aiEnabled: boolean;
  canChange: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canChange) return null;

  function change(enabled: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await switchConversationAi(conversationId, enabled);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {aiEnabled ? (
        <button type="button" onClick={() => change(false)} disabled={pending} className="btn-secondary gap-1.5 !py-1 text-xs">
          <PauseIcon className="size-3.5" />
          {pending ? "Tomando..." : "Tomar el chat"}
        </button>
      ) : (
        <button type="button" onClick={() => change(true)} disabled={pending} className="btn-secondary gap-1.5 !py-1 text-xs">
          <PlayIcon className="size-3.5" />
          {pending ? "Devolviendo..." : `Devolver a ${agentName}`}
        </button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
