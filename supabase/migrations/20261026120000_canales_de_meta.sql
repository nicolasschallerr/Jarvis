-- Canales de Meta: Messenger e Instagram (junto con WhatsApp), ADR-039.
--
-- Cada canal guarda el NOMBRE de la variable de entorno con su token (nunca el token). Se suman los nombres que
-- usan Messenger e Instagram; la forma sigue siendo cerrada para que nadie pueda apuntar a otra variable.

alter table public.channels drop constraint channels_secret_ref_format;

alter table public.channels
  add constraint channels_secret_ref_format
  check (
    secret_ref is null
    or secret_ref ~ '^(TELEGRAM_BOT_TOKEN|WHATSAPP_ACCESS_TOKEN|MESSENGER_ACCESS_TOKEN|INSTAGRAM_ACCESS_TOKEN|CHANNEL_TOKEN)(_[A-Z0-9]+)*$'
  );
