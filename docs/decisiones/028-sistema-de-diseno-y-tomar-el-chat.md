# ADR-028: Sistema de diseño del CRM y "Tomar el chat"

**Estado:** aceptada (2026-10-24).

## Contexto

La auditoría de interfaz encontró colores sueltos (azules, rojos y ámbar fuera de la paleta), encabezados distintos en
cada sección, textos crudos ("[image] sin archivo", tipos MIME), un botón flotante que tapaba "Enviar" en el celular,
burbujas iguales para Jarvis y para una persona del equipo, y faltantes de producto: no había forma de que una persona
tomara una conversación y Jarvis dejara de responder, ni búsqueda, filtros, paginación o una página de contactos.

## Decisión

### Sistema de diseño

- **Colores por significado**, definidos una vez en `globals.css` y usados como clases: `muted`, `line`, `success`,
  `warning`, `danger`, `info` (cada uno con su versión `-soft`), además del acento. Nada de `blue-…` o `red-…` en
  componentes.
- **Componentes comunes** en `src/components/ui/`: `PageHeader`, `Badge` / `StatusBadge` / `PriorityBadge`,
  `EmptyState` / `NoAccess`, `Avatar`, `LinkTabs` / `SegmentedLinks` e íconos propios (sin dependencias).
- **Filtros como URL:** pestañas, canal, búsqueda y "ver más" son parámetros de la dirección; se pueden compartir y volver
  con "Atrás".
- **Estados de carga, error y 404** propios (esqueletos mientras carga, `error.tsx` con "Reintentar", `not-found.tsx`).

### Tomar el chat

- Cada conversación tiene un interruptor visible: **"Atiende Jarvis" / "Atiende una persona"**. "Tomar el chat" pausa a
  Jarvis en esa conversación (`ai_enabled = false`) y, si nadie la tenía, la asigna a quien la tomó. "Devolver a Jarvis"
  lo reactiva.
- **Responder a mano también toma el chat.** Es lo que esperan los equipos que usan un CRM con agente de IA: si una
  persona contestó, Jarvis no le contesta por encima. La pantalla lo avisa antes ("si respondés, tomás el chat") y
  después ("Jarvis quedó en pausa").
- Lo puede hacer el superadmin o un operador; el rol de consulta no. La autorización está en `setConversationAi` y en RLS.

### Pantallas nuevas o rehechas

- **Bandeja:** búsqueda por nombre o documento, pestañas con contador (Todas, Esperando respuesta, Mías, Sin asignar,
  IA en pausa), filtro de canal, quién escribió lo último ("Jarvis:", "Equipo:") y paginación.
- **Conversación:** separadores por día, burbujas distintas para el contacto, Jarvis, una persona del equipo y los
  avisos del sistema, firma con el nombre de quien respondió y la ventana de 24 h solo en WhatsApp.
- **Contactos:** directorio con búsqueda por nombre, documento o teléfono, y una ficha con todas las conversaciones y casos
  de la persona en todos los canales.
- **Casos:** vista por defecto según el rol (el operador ve los suyos; superadmin y consulta, todos) y filtro de prioridad
  (el Inicio enlaza directo a los urgentes).

## Consecuencias

- Un color nuevo se agrega como token, no como clase suelta.
- El agente respeta `ai_enabled` en cada turno: una conversación tomada no recibe respuestas de Jarvis hasta devolverla.
- Falta: respuestas rápidas guardadas, "cargar mensajes anteriores" (hoy se ven los últimos 200) y editar la ficha desde
  la página del contacto.
