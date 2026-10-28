-- Asistente de la empresa (ADR-050): responde cualquier pregunta sobre los datos de la organización. Está siempre
-- encendido, así que no tiene fila en "agents"; el tipo existe para registrar su gasto aparte en ai_calls.
alter type public.agent_kind add value if not exists 'assistant';
