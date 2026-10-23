-- Fase 4, paso 4.2: resumen de cada conversación para la bandeja del CRM.
-- security_invoker hace que la vista se ejecute con los permisos de quien consulta, o sea que
-- RLS de conversations, contacts, channels, messages y conversation_windows se sigue aplicando.

create view public.conversation_summaries
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
  ) as window_open
from public.conversations c
join public.contacts ct on ct.id = c.contact_id
join public.channels ch on ch.id = c.channel_id
left join lateral (
  select m.body, m.type, m.direction
  from public.messages m
  where m.conversation_id = c.id
  order by m.created_at desc
  limit 1
) lm on true;

revoke all on public.conversation_summaries from public, anon;
grant select on public.conversation_summaries to authenticated, service_role;

-- Índice para traer rápido el último mensaje de cada conversación.
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
