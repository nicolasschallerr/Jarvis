# Estado de las fases

Actualizado el 2026-10-26. "Cerrada" = construida, probada y documentada; las fases 0 a 5 además tienen su tag (`fase-XX`).
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
| 6 | Motor del agente de atención: probado con Claude real, 17/17 evals (tag `fase-06`, 2026-10-26; el dueño sigue probando y pide los ajustes) |
| 8 | Evaluaciones del agente: runner con juez, 17/17 con Claude real (tag `fase-08`, 2026-10-26) |

## Construidas, falta una o dos tareas para cerrar

| Fase | Qué falta |
|------|-----------|
| 7 Multimedia | Elegir el servicio de transcripción de audios y probar con audios reales (imágenes y PDF ya andan) |
| 9 Plantillas y seguimientos | Probar con el número de WhatsApp verificado: crear las plantillas en Meta, sincronizar y enviar una |
| 11 Consumo | Hecho: límites con avisos y exportar a CSV (ADR-036). Falta decidir con el cliente si al llegar al límite se corta al agente |
| Agente analítico | Encenderlo y probarlo con Claude real; después, conectarlo a la base del cliente |

## Construido sin la API ni los números de teléfono (2026-10-25)

Probado con servicios falsos; la prueba real espera al número verificado y a la clave.

| Tema | Qué hay |
|------|---------|
| Auditoría | Pantalla con filtros y exportar; registra quién hizo qué (ADR-035) |
| Exportar a CSV | Casos, contactos, consumo y auditoría, con control de rol y protección contra fórmulas |
| Límites de consumo | Tope mensual de créditos y costo con avisos al llegar al umbral y al superarlo (ADR-036) |
| Avisos | Pantalla con lista completa y contador propio |
| Reportes | Volumen, primera respuesta del agente y del equipo, casos y carga de trabajo (ADR-037) |
| Envíos masivos | Borrador, revisión, programación y envío por lotes, solo a quien aceptó recibir (ADR-038) |
| Consentimiento | Registro en la ficha y baja automática por "STOP" |

## Pendientes por completo

| Tema | Notas |
|------|-------|
| 14 Canales de Meta | **Construida con un Meta falso (ADR-039, 2026-10-26):** WhatsApp (texto libre, adjuntos y estados de entrega), Instagram y Facebook Messenger por un solo webhook. Falta conectar cuentas reales de Meta y probar (guía: `docs/guia-conectar-meta.md`); producción pide verificación del negocio y revisión de la app |
| 13 Producción | Base de producción separada, región (São Paulo recomendado), rotar claves, copias de respaldo, dominio propio, monitoreo |
| Integración con la base del cliente | Lectura con permisos acotados; necesita acceso del cliente |
| Avisos por email o WhatsApp | Los avisos ya se ven en la aplicación (pantalla Avisos); falta enviarlos por afuera, necesita un servicio de email |
| Copiloto para operadores | Sugerencia de respuestas y resumen de la conversación |
| Búsqueda por similitud (pgvector) | Cuando el conocimiento no entre cómodo en las instrucciones |
| Encuestas y confirmaciones de turno | Por plantillas oficiales |
