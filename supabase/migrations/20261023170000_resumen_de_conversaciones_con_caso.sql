-- Fase 5, paso 5.4: la bandeja muestra el caso abierto de cada conversación (estado, prioridad y a
-- quién está asignado). Se agregan columnas al final de la vista, que sigue siendo security_invoker.

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
  oc.assigned_to as case_assigned_to
from public.conversations c
join public.contacts ct on ct.id = c.contact_id
join public.channels ch on ch.id = c.channel_id
left join lateral (
  select m.body, m.type, m.direction
  from public.messages m
  where m.conversation_id = c.id
  order by m.created_at desc
  limit 1
) lm on true
left join lateral (
  select cs.status, cs.priority, cs.assigned_to
  from public.cases cs
  where cs.conversation_id = c.id
    and cs.status <> 'resolved'
  limit 1
) oc on true;
