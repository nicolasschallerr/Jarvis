# ADR-050: Asistente de la empresa

**Estado:** aceptada (2026-10-28). Sigue a ADR-049 (agente financiero).

## Contexto
Cada agente responde sobre lo suyo (el analítico, la operación; el financiero, los números; el de stock, el catálogo).
Hacía falta "un Claude de la empresa": un solo lugar donde preguntar cualquier cosa sobre los datos de la organización,
por ejemplo "¿cuántos préstamos de 2 millones hicimos este mes?", siempre disponible.

## Decisión
- **Página Asistente** (primera del grupo Inteligencia), para superadmin y consulta y reportes, como Reportes y Finanzas.
- **Siempre encendido**: no tiene fila en `agents` ni interruptor. Existe el valor `assistant` de `agent_kind` solo para
  registrar su gasto aparte en `ai_calls` (Consumo).
- **Herramientas**: reúne las del analítico, las del financiero y la búsqueda del catálogo, y suma tres con filtros:
  `buscar_movimientos` (tipo, texto en categoría/descripción/contraparte, rango de monto, fechas y estado),
  `buscar_casos` (texto en título o resumen, estado, sector, fechas) y `contar_contactos`. Todas leen con la sesión de
  quien pregunta (RLS): el Asistente nunca ve más que esa persona.
- **Sin datos personales**: como el analítico, no devuelve nombres, documentos ni mensajes de clientes o asociados.
- El chat es el mismo del analítico y el financiero (`analitico/chat.tsx`), que ahora muestra las negritas.

## Pendiente
Que el Asistente pueda leer también la base de conocimiento de cada sector y los datos que conecte cada cliente.
