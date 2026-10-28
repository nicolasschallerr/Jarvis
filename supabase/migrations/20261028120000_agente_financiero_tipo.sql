-- Agente financiero (ADR-049): un tipo de agente más. Va solo en esta migración porque Postgres no deja usar un valor de
-- enum en la misma transacción en que se lo agrega; la tabla y las filas se crean en la siguiente.
alter type public.agent_kind add value if not exists 'finance';
