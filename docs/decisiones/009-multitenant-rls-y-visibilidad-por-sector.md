# ADR-009: Multi-tenant con RLS por `organization_id` y visibilidad de casos por sector

**Estado:** aceptada (2026-10-21). La visibilidad de casos por sector y la limitación abierta fueron
reemplazadas por el [ADR-016](016-lectura-abierta-en-la-organizacion.md) (2026-10-23): hoy todos leen
todo dentro de su organización y la escritura sigue por sector. El resto sigue vigente.

## Contexto

Jarvis atiende a varios clientes desde una sola base. Un usuario de un cliente nunca debe ver
datos de otro. Dentro de un cliente, cada sector debe recibir solo lo suyo, con contexto completo.

## Decisión

- Todas las tablas llevan `organization_id` y tienen RLS activado.
- Un usuario pertenece a **una sola** organización (`profiles.organization_id`).
- Las políticas usan funciones auxiliares en el esquema `private` (no expuesto por la API),
  `current_org_id()`, `current_user_role()` e `is_sector_member()`, con `SECURITY DEFINER` y
  `search_path` vacío, llamadas como `(select ...)` para que se evalúen una vez por consulta.
- Roles: `superadmin`, `operator`, `viewer`. El viewer solo lee.
- `cases` es visible para superadmin y viewer, para el asignado y para los miembros del sector;
  las tablas hijas heredan esa visibilidad con una subconsulta sobre `cases`.
- Todo lo que escribe el proceso en segundo plano (mensajes, trazas, créditos, auditoría) lo hace
  el servidor con la clave de servicio; el navegador no tiene políticas de escritura sobre esas tablas.

## Alternativas descartadas

- **Un usuario en varias organizaciones:** más flexible, pero complica cada política. Si hace falta,
  se agrega una tabla de membresías.
- **Una base por cliente:** aislamiento total, pero multiplica el costo y el mantenimiento.
- **Filtrar solo en el código:** un error en una consulta expondría datos de otro cliente; RLS lo impide por diseño.

## Consecuencias

- Aislamiento garantizado por la base, no por la disciplina del código.
- **Limitación abierta (DECISIÓN PENDIENTE):** `conversations` y `messages` se ven por toda la
  organización, así que un operador podría leer chats de otro sector consultando la API directamente.
  Si el cliente lo exige, se deriva su visibilidad desde `cases`, a costa de complicar la bandeja
  y el contexto de la IA.
- Hay que probar las políticas con usuarios de prueba de distintos roles y organizaciones antes de producción (Fase 2).
