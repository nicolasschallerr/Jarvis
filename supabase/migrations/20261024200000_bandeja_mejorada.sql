-- Bandeja mejorada (ADR-028). La vista de resumen suma:
--   - last_sender: quién escribió el último mensaje (asociado, Jarvis, una persona del equipo o el sistema), para
--     no mostrar "Vos:" en lo que escribió la IA;
--   - el último mensaje se elige por la hora del proveedor (la real), no por cuándo se guardó;
--   - contact_document: para buscar por documento desde la bandeja;
--   - case_sector_id: para filtrar por sector.
-- Las columnas nuevas van al final (create or replace view no permite reordenar). Sigue con security_invoker.

create or replace view public.conversation_summaries
with (security_invoker = true) as
select
  c.id,
  c.organization_id,
  c.contact_id,
  c.channel_id,
  c.ai_enabled,
  c.assigned_to,
  c.last_message_at,
  c.last_inbound_at,
  ct.display_name as contact_name,
  ch.type as channel_type,
  ch.name as channel_name,
  lm.body as last_body,
  lm.type as last_type,
  lm.direction as last_direction,
  exists (
    select 1
    from public.conversation_windows w
    where w.contact_id = c.contact_id
      and w.expires_at > now()
  ) as window_open,
  oc.status as case_status,
  oc.priority as case_priority,
  oc.assigned_to as case_assigned_to,
  lm.sender as last_sender,
  ct.document_number as contact_document,
  oc.sector_id as case_sector_id
from public.conversations c
join public.contacts ct on ct.id = c.contact_id
join public.channels ch on ch.id = c.channel_id
left join lateral (
  select m.body, m.type, m.direction, m.sender
  from public.messages m
  where m.conversation_id = c.id
    and m.status <> 'failed'
  order by m.provider_timestamp desc nulls last, m.created_at desc
  limit 1
) lm on true
left join lateral (
  select cs.status, cs.priority, cs.assigned_to, cs.sector_id
  from public.cases cs
  where cs.conversation_id = c.id
    and cs.status <> 'resolved'
  limit 1
) oc on true;
