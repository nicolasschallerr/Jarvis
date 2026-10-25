-- Plantillas de Meta para escribir fuera de la ventana de 24 h de WhatsApp (Fase 9, ADR-030).
--
-- La tabla message_templates existe desde la Fase 1. Se completa con lo que devuelve Meta al sincronizar: formato
-- de los parámetros, componentes (encabezado, pie, botones), motivo de rechazo y cuándo se sincronizó. Las filas
-- las escribe solo el servidor (no hay políticas de escritura para personas).
--
-- El id de la cuenta de WhatsApp Business (WABA) de cada canal va en channels.config->>'waba_id'.

alter type public.template_meta_status add value if not exists 'disabled';

alter table public.message_templates
  add column parameter_format text not null default 'positional' check (parameter_format in ('positional', 'named')),
  add column components jsonb not null default '[]'::jsonb,
  add column rejected_reason text,
  add column synced_at timestamptz;

-- Qué plantilla se usó en cada mensaje enviado con una (el cuerpo guarda el texto ya completado).
alter table public.messages
  add column template_id uuid references public.message_templates (id) on delete set null;

create index messages_template_id_idx on public.messages (template_id) where template_id is not null;
