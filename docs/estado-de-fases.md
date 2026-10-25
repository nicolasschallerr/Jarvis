# Estado de las fases

Actualizado el 2026-10-25. "Cerrada" = construida, probada y documentada; las fases 0 a 5 además tienen su tag (`fase-XX`).
Los tags de las demás se ponen solo con la confirmación del dueño del proyecto. La numeración de las fases 10 y 13 no
está escrita en ningún documento del repositorio: se listan por tema.

## Cerradas

| Fase | Qué es |
|------|--------|
| 0 | Preparación del entorno |
| 1 | Arquitectura y modelo de datos |
| 2 | Cuentas y multi-organización (RLS) |
| 3 | Recepción y envío de mensajes (Telegram de desarrollo; recepción de WhatsApp) |
| 4 | Bandeja del CRM |
| 5 | Sectores, casos y rediseño |
| 12 | Unir contactos duplicados (tag `fase-12`, 2026-10-25) |

## Construidas, falta una o dos tareas para cerrar

| Fase | Qué falta |
|------|-----------|
| 6 Agente de atención | Probarlo con Claude real (necesita la API key) y ajustar el prompt; después cerrar con su tag |
| 7 Multimedia | Elegir el servicio de transcripción de audios y probar con audios reales (imágenes y PDF ya andan) |
| 8 Evaluaciones | Correr los casos del cliente con Claude real (necesita la API key) |
| 9 Plantillas y seguimientos | Probar con el número de WhatsApp verificado: crear las plantillas en Meta, sincronizar y enviar una |
| 11 Consumo | Opcional: límites y alertas, y exportar |
| Agente analítico | Encenderlo y probarlo con Claude real; después, conectarlo a la base del cliente |

## Pendientes por completo

| Tema | Notas |
|------|-------|
| 14 WhatsApp saliente | Texto libre, adjuntos y estados por la API de Meta; depende de la verificación de negocio |
| 13 Producción | Base de producción separada, región (São Paulo recomendado), rotar claves, copias de respaldo, dominio propio, monitoreo |
| Integración con la base del cliente | Lectura con permisos acotados; necesita acceso del cliente |
| Envíos masivos con consentimiento | Las tablas existen; falta la pantalla y el envío con plantillas |
| Avisos al responsable | Por email o WhatsApp; necesita un servicio de email |
| Copiloto para operadores | Sugerencia de respuestas y resumen de la conversación |
| Búsqueda por similitud (pgvector) | Cuando el conocimiento no entre cómodo en las instrucciones |
| Auditoría completa | Hoy solo registra cambios en contactos; falta una pantalla |
| Encuestas y confirmaciones de turno | Por plantillas oficiales |
