-- Un mensaje tiene a lo sumo un archivo guardado (revisión de seguridad de los canales de Meta, ADR-039).
-- Dos corridas del trabajador podían bajar el mismo adjunto a la vez y registrarlo dos veces; ahora la segunda choca con el
-- índice y se ignora. Antes se quita lo repetido si lo hubiera (se conserva el primero).

delete from public.media_files a
using public.media_files b
where a.message_id = b.message_id and a.created_at > b.created_at;

delete from public.media_files a
using public.media_files b
where a.message_id = b.message_id and a.created_at = b.created_at and a.id > b.id;

create unique index if not exists media_files_message_id_key on public.media_files (message_id);
