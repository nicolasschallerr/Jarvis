-- Dos ajustes a la auditoría (ADR-027).
--
-- 1) Las columnas protegidas se cuidan de la sesión de una persona, no de las funciones de la base. Una función
--    `security definer` (por ejemplo merge_contacts, que ejecuta un superadmin) sigue viendo auth.uid() del usuario,
--    pero corre como el dueño de la función: ahí current_user ya no es 'authenticated'. Antes el disparador
--    bloqueaba también a esas funciones y unir contactos dejó de andar.
-- 2) Todo mensaje tiene hora: si quien lo inserta no trae la del canal, vale la del momento. La bandeja y el
--    historial ordenan por esa hora; un mensaje sin ella quedaba como el más viejo.

create or replace function private.guard_user_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- El servidor (sin usuario) y las funciones de la base (otro current_user) pueden todo; las restricciones son
  -- para lo que una persona cambia directamente con su sesión.
  if auth.uid() is null or current_user <> 'authenticated' then
    return new;
  end if;

  if tg_table_name = 'conversations' then
    if new.organization_id is distinct from old.organization_id
       or new.channel_id is distinct from old.channel_id
       or new.contact_id is distinct from old.contact_id then
      raise exception 'No se puede cambiar la organización, el canal ni el contacto de una conversación';
    end if;
    if new.last_inbound_at is distinct from old.last_inbound_at
       or new.last_message_at is distinct from old.last_message_at
       or new.agent_lock_until is distinct from old.agent_lock_until
       or new.created_at is distinct from old.created_at then
      raise exception 'Las marcas de tiempo de la conversación las registra solo el sistema';
    end if;

  elsif tg_table_name = 'contacts' then
    if new.organization_id is distinct from old.organization_id
       or new.merged_into is distinct from old.merged_into
       or new.merged_at is distinct from old.merged_at
       or new.opted_in_at is distinct from old.opted_in_at
       or new.opted_out_at is distinct from old.opted_out_at then
      raise exception 'Ese dato del contacto lo registra solo el sistema';
    end if;

  elsif tg_table_name = 'area_queries' then
    if new.organization_id is distinct from old.organization_id
       or new.case_id is distinct from old.case_id
       or new.conversation_id is distinct from old.conversation_id
       or new.sector_id is distinct from old.sector_id
       or new.question is distinct from old.question
       or new.reply_sent_at is distinct from old.reply_sent_at
       or new.reply_attempts is distinct from old.reply_attempts then
      raise exception 'Solo se puede responder la consulta';
    end if;
    if new.answered_by is distinct from old.answered_by and new.answered_by is distinct from auth.uid() then
      raise exception 'La respuesta queda a nombre de quien la escribe';
    end if;

  elsif tg_table_name = 'notifications' then
    if new.organization_id is distinct from old.organization_id
       or new.profile_id is distinct from old.profile_id
       or new.type is distinct from old.type
       or new.case_id is distinct from old.case_id
       or new.title is distinct from old.title
       or new.body is distinct from old.body then
      raise exception 'De un aviso solo se puede marcar la lectura';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_user_columns() from public, anon, authenticated;

-- 2) Hora de los mensajes ------------------------------------------------------------------------------------

alter table public.messages alter column provider_timestamp set default now();

update public.messages set provider_timestamp = created_at where provider_timestamp is null;
