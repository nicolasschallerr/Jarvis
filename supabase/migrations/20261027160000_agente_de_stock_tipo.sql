-- Agente de stock (ADR-046): un tipo de agente más, visible en Agentes. Va solo en esta migración porque Postgres no deja
-- usar un valor de enum en la misma transacción en que se lo agrega; las filas se crean en la siguiente.
alter type public.agent_kind add value if not exists 'stock';
