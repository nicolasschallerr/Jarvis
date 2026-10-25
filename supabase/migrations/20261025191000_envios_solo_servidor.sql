-- Los envíos masivos se crean, programan y cancelan solo desde el servidor (ADR-038).
--
-- Las políticas de la Fase 1 dejaban que un operador creara un borrador y lo pasara a "programado" con su propia sesión,
-- salteándose la regla de que programar un envío (que cuesta plata y le escribe a mucha gente) es del superadmin. Sin
-- políticas de escritura, las personas solo pueden leer; escribir lo hace el código, que verifica el rol.

drop policy if exists broadcasts_insert on public.broadcasts;
drop policy if exists broadcasts_update on public.broadcasts;
