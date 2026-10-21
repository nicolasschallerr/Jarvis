# ADR-001: Base de datos de Jarvis separada de la del cliente

**Estado:** aceptada (2026-10-20)

## Contexto

El cliente piloto tiene su propia base de datos (Supabase), que su área de sistemas actualiza
periódicamente. Jarvis necesita guardar conversaciones, casos, usuarios del CRM, consumo y
configuración, para este cliente y para los siguientes.

## Decisión

Jarvis tiene **su propia base** (Supabase propio del proveedor, proyecto `jarvis-dev` en
desarrollo). La base del cliente se accede como sistema externo:

- El agente de atención, con permisos acotados (funciones o vistas específicas, no SQL libre).
- El Agente Analítico, con un rol de solo lectura (`SELECT`), con timeout y límite de filas.

## Alternativas descartadas

- **Usar la base del cliente para todo:** mezcla datos de producto con datos del cliente,
  impide el multi-tenant y ata Jarvis a un cliente.
- **Copiar los datos del cliente a la base de Jarvis:** duplica datos personales (peor para
  la Ley 25.326) y obliga a sincronizar.

## Consecuencias

- Multi-tenant real: `organization_id` en todas las tablas de Jarvis + RLS.
- La integración con cada cliente es un adaptador, no un cambio de esquema.
- Costo: hay que diseñar y mantener los permisos sobre la base del cliente.
