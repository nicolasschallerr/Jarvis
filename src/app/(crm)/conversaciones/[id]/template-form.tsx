"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { renderTemplate, templateVariables } from "@/lib/whatsapp/templates";

import { sendTemplateAction } from "./template-actions";

export type ApprovedTemplate = { id: string; name: string; language: string; body: string; category: string | null };

// Valor inicial razonable: el nombre del contacto en la primera variable o en una llamada "nombre".
function defaultsFor(body: string, contactFirstName: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of templateVariables(body)) {
    if (contactFirstName && ["1", "nombre", "name", "first_name"].includes(key.toLowerCase())) values[key] = contactFirstName;
  }
  return values;
}

// Fuera de la ventana de 24 h de WhatsApp solo se puede escribir con una plantilla aprobada por Meta. Se elige la
// plantilla, se completan sus variables y se ve el mensaje tal como le va a llegar al contacto.
export function TemplateForm({
  conversationId,
  templates,
  contactFirstName,
  canManage,
}: {
  conversationId: string;
  templates: ApprovedTemplate[];
  contactFirstName: string;
  canManage: boolean;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template = templates.find((item) => item.id === templateId);
  const [values, setValues] = useState<Record<string, string>>(() => (template ? defaultsFor(template.body, contactFirstName) : {}));
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const variables = useMemo(() => (template ? templateVariables(template.body) : []), [template]);
  const preview = template ? renderTemplate(template.body, values) : "";

  function choose(id: string) {
    setTemplateId(id);
    const next = templates.find((item) => item.id === id);
    setValues(next ? defaultsFor(next.body, contactFirstName) : {});
    setError(null);
    setSent(false);
  }

  function send() {
    if (!template) return;
    setError(null);
    startTransition(async () => {
      const result = await sendTemplateAction(conversationId, template.id, values);
      if (result.error) setError(result.error);
      else setSent(true);
    });
  }

  return (
    <section aria-label="Escribir con una plantilla" className="flex flex-col gap-3 border-t border-line bg-surface px-4 py-3 sm:px-6">
      <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
        Pasaron más de 24 horas desde el último mensaje del contacto: WhatsApp solo deja escribir con plantillas aprobadas
        por Meta. Cuando el contacto responda, se vuelve a escribir libremente.
      </p>

      {templates.length === 0 ? (
        <p className="text-sm text-muted">
          Todavía no hay plantillas aprobadas.{" "}
          {canManage ? (
            <Link href="/plantillas" className="font-medium text-accent underline-offset-2 hover:underline">
              Sincronizalas desde Plantillas
            </Link>
          ) : (
            "Pedile a quien administra la cuenta que las sincronice."
          )}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Plantilla
              <select value={templateId} onChange={(event) => choose(event.target.value)} className="field !py-1.5 font-normal">
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.language}
                  </option>
                ))}
              </select>
            </label>
            {variables.map((key) => (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span className="font-mono text-xs text-muted">{`{{${key}}}`}</span>
                <input
                  value={values[key] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                  maxLength={300}
                  className="field !py-1.5"
                  aria-label={`Valor de la variable ${key}`}
                />
              </label>
            ))}
            <button type="button" onClick={send} disabled={pending || !template} className="btn-primary self-start">
              {pending ? "Enviando..." : "Enviar plantilla"}
            </button>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            {sent ? (
              <p role="status" className="text-sm text-success">
                Plantilla enviada. Si el contacto responde, se abre otra ventana de 24 h.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Así le llega</span>
            <p className="rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap text-accent-foreground">{preview}</p>
          </div>
        </div>
      )}
    </section>
  );
}
