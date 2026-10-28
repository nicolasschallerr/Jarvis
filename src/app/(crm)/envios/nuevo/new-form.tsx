"use client";

import { useActionState, useState } from "react";

import { isNameVariable } from "@/lib/broadcasts/rules";
import { renderTemplate, templateVariables } from "@/lib/whatsapp/templates";

import { createBroadcastAction, type BroadcastState } from "../actions";

const INITIAL: BroadcastState = { error: null };

export type TemplateOption = { id: string; name: string; language: string; body: string };

export function NewBroadcastForm({ templates, consentedTotal }: { templates: TemplateOption[]; consentedTotal: number }) {
  const [state, action, pending] = useActionState(createBroadcastAction, INITIAL);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const template = templates.find((item) => item.id === templateId);
  const fixedVariables = template ? templateVariables(template.body).filter((key) => !isNameVariable(key)) : [];
  // La vista previa pone un nombre de ejemplo donde va el de cada contacto.
  const preview = template ? renderTemplate(template.body, Object.fromEntries(templateVariables(template.body).map((key) => [key, isNameVariable(key) ? "Ana" : (values[key] ?? "")]))) : "";

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nombre del envío
          <input name="name" required minLength={3} maxLength={80} placeholder="Ej.: Novedades de octubre" className="field font-normal" />
          <span className="text-xs font-normal text-muted">Es para ustedes: no lo ven los contactos.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Plantilla
          <select name="templateId" value={templateId} onChange={(event) => { setTemplateId(event.target.value); setValues({}); }} className="field font-normal">
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.language}
              </option>
            ))}
          </select>
        </label>

        {fixedVariables.map((key) => (
          <label key={key} className="flex flex-col gap-1 text-sm font-medium">
            <span>
              Valor de <span className="font-mono">{`{{${key}}}`}</span>
            </span>
            <input name={`var:${key}`} required maxLength={300} value={values[key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} className="field font-normal" />
          </label>
        ))}

        <label className="flex flex-col gap-1 text-sm font-medium">
          Solo contactos de la localidad (opcional)
          <input name="locality" maxLength={80} placeholder="Todas" className="field font-normal" />
        </label>

        <div className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
          Se le escribe solo a quien <strong>aceptó recibir mensajes</strong> y no pidió dejar de recibirlos: hoy son {consentedTotal} contactos con WhatsApp. El consentimiento se registra en la
          ficha de cada contacto. Una plantilla de promociones tiene que decir cómo darse de baja (por ejemplo: «Respondé STOP para no recibir más»).
        </div>

        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        <button type="submit" disabled={pending} className="btn-primary self-start">
          {pending ? "Creando..." : "Crear y revisar"}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <span className="eyebrow">Así le llega a cada persona</span>
        <p className="rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap text-accent-foreground">{preview}</p>
        <p className="text-xs text-muted">Antes de enviar vas a poder revisar cuántas personas lo reciben. Nada sale hasta que lo confirmes.</p>
      </div>
    </form>
  );
}
