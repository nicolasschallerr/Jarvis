# ADR-037: Reportes de gestión y pantalla de avisos

**Estado:** aceptada (2026-10-25).

## Contexto
La dirección pedía ver "cómo viene la atención" sin tener que preguntarle al agente analítico, y los avisos solo se veían
en el Inicio (los cinco últimos), sin poder revisarlos todos ni marcarlos de a uno.

## Decisión
### Reportes (`/reportes`, superadmin y consulta y reportes)
- **Una sola función de la base** (`report_last_days`, que usa `report_summary`) calcula todo el período con la sesión de
  quien mira (RLS la limita a su organización): la pantalla hace un solo viaje a la base (ADR-034).
- **Qué muestra:** conversaciones nuevas, mensajes por día, **primera respuesta** (mediana y 9 de cada 10) separada entre el
  agente y las personas, porcentaje respondido por el agente, consultas todavía sin respuesta, casos abiertos y resueltos por
  día, tiempo de resolución y casos abiertos por estado, sector y persona. Períodos de 7, 30 y 90 días en la zona horaria de
  la organización.
- **Cómo se mide la primera respuesta:** un turno empieza con un mensaje del contacto cuando el anterior de esa conversación
  fue nuestro (o no había); su respuesta es el primer mensaje saliente que le sigue. Dos mensajes seguidos del contacto son un
  solo turno. Probado con una línea de tiempo armada a mano.

### Avisos (`/avisos`)
- Lista completa (sin leer o todos) con "ver más", marcar uno o todos como leídos y contador propio en el menú.
- El destino de cada aviso lo decide el código según su tipo (la conversación del caso o Consumo); un aviso no trae
  direcciones, así no se puede armar un enlace a otro sitio.

## Consecuencias
- La mediana usa todo el período; con poco movimiento puede ser irregular.
- No incluye todavía calidad de las respuestas (depende de las evaluaciones con Claude real, Fase 8).
