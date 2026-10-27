# ADR-048: Segunda pasada de diseño sobre todo el CRM

**Estado:** aceptada (2026-10-27). Sigue a ADR-044 (Panorama), que solo había renovado la primera pantalla.

## Contexto
Después del Panorama, el resto del CRM seguía con listas planas, tres estilos distintos de error, tiles sin animación,
gráficos de barras sin eje ni dato para lectores de pantalla y colores de estado que no se distinguían. Se hizo una
auditoría de todas las páginas y se aplicó lo de mayor impacto.

## Decisión
- **Piezas comunes nuevas**: `StatTile` (el tile del Panorama, con número que cuenta, ícono por tono y flecha si lleva a
  algún lado), `ErrorBanner` (un solo aviso de error, con "Reintentar"), `FilterChips` y `AutoSubmitSelect` (filtros
  como chips de enlace, en una sola fila), `ActivityChart` genérico (cualquier serie por día, con tooltip y tabla oculta
  para lectores de pantalla) y los mapas de color por estado y prioridad en `badge.tsx`.
- **`--info` deja de ser igual al acento**: pasa a un azul propio (contraste ≥ 4,5:1 en claro y oscuro). Antes "Nuevo" y
  "En curso" se veían del mismo color.
- **Conversaciones**: los mensajes seguidos del mismo autor se agrupan; los salientes muestran si están en cola, enviados,
  entregados o leídos; el día queda fijo arriba como pastilla; en la bandeja, el canal va sobre el avatar y lo que
  espera respuesta tiene una barra de acento.
- **Casos**: columnas con el color de su estado; tarjetas con franja por prioridad (solo alta y urgente muestran la
  etiqueta), responsable con avatar y controles que aparecen al pasar el mouse (siempre visibles en pantallas táctiles,
  y alcanzables con teclado). La fecha "ahora" la pasa el servidor para no desfasar la hidratación.
- **Reportes y Consumo**: tiles animados, gráficos de líneas interactivos, barras por color de significado, medidor de
  límites de verde a rojo y navegación de meses compacta. Si los datos no cargan, ya no se muestran ceros engañosos.
- **Envíos**: progreso apilado (enviados, sin enviar, en cola) y un punto en vivo mientras se envía.
- **Avisos**: ícono por tipo, agrupados por día y no leídos resaltados; se corrigieron el marcador "Sin leer" (invisible
  para lectores de pantalla) y el botón de "marcar todos" que aparecía sin nada que marcar.
- **Stock**: resumen con stock, pocas unidades, agotados y no publicados; tarjetas con el mismo estilo que el resto.

Todo usa las clases de movimiento existentes, así que "menos movimiento" sigue apagando las animaciones.

## Pendiente
Esqueletos de carga por sección, timeline en Auditoría, vista previa tipo WhatsApp en Plantillas y encabezados con el
grupo del menú.
