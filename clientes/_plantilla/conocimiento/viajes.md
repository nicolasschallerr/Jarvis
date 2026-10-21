# Unidad: Viajes (ejemplo inventado)

## Qué resuelve el agente

- Informa los destinos habituales y cómo funcionan las salidas grupales.
- Junta los datos del viaje y deriva al sector `viajes`.
- Precios, fechas de salida y cupos **los confirma el sector**, nunca el agente.

## Información general

- La Cooperativa Ejemplo organiza salidas grupales a destinos nacionales.
- Las reservas requieren confirmación del sector y una seña.

## Datos a juntar

| Dato | Obligatorio | Ejemplo inventado |
|---|---|---|
| Nombre y apellido | Sí | Juan Ficticio |
| Destino | Sí | Sierras de Ejemplo |
| Fechas o mes tentativo | Sí | Marzo |
| Cantidad de personas | Sí | 2 adultos |
| Ciudad de salida | Sí | Villa Ejemplo |

## Consulta al área

Si el asociado pregunta precio o cupo, el agente usa la herramienta de consulta asincrónica
al sector `viajes` y le avisa que le responde por este mismo chat.
