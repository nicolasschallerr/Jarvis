# ADR-023: Panel de consumo

**Estado:** aceptada (2026-10-24). Adelanto de la Fase 11.

## Contexto

La facturación es por crédito (ADR-010) y cada llamada a la IA tiene un costo (ADR-006: el presupuesto de
desarrollo es chico y un error puede gastar de más). Hasta ahora los datos existían (`conversation_windows`,
`ai_calls`) pero nadie los veía. Hace falta saber cuánto se consume, día por día, sin depender de mirar la base.

## Decisión

- **Una función de la base agrega por día** (`consumption_by_day(desde, hasta)`): créditos y conversaciones
  (del asociado y de la organización), llamadas a IA, errores, tokens y costo. Los días se cortan en la **zona
  horaria de la organización**, no en UTC: una conversación a las 23:30 de Buenos Aires cuenta para ese día.
- **Corre con los permisos de quien la llama** (`security invoker`): RLS decide qué ve cada uno. Las conversaciones
  las ve toda la organización; las llamadas a IA, solo superadmin y consulta y reportes.
- **Pantalla "Consumo"** para superadmin y consulta y reportes (los operadores no ven el gasto). Muestra un mes por
  vez, con navegación a los meses anteriores, totales y una tabla por día.
- **El costo es honesto**: se suma solo el de las llamadas que lo tienen. Si el cliente no configuró los precios
  (ADR-019), el costo queda en "—" y se avisa; si es parcial, se dice cuántas llamadas quedaron afuera. Los errores
  se cuentan aparte y no suman tokens ni costo.
- **El rango máximo es de 93 días** por consulta, y la pantalla pide un mes.

## Alternativas descartadas

- **Calcular en la aplicación leyendo todas las filas:** más datos por la red y la lógica de zonas horarias en dos
  lugares.
- **Una tabla de resumen mantenida por disparadores:** se puede desfasar; con el volumen actual agregar al vuelo es
  más simple y siempre exacto.
- **Mostrar todos los meses juntos:** una tabla larga sin foco.

## Consecuencias

- Con mucho volumen (miles de ventanas por mes) habrá que revisar índices o pre-agregar. Hoy hay un índice por
  organización y fecha en las ventanas; `ai_calls` tiene uno por organización y fecha.
- Falta lo que cierra la fase: **límites y alertas** (avisar al acercarse a un tope de créditos o de gasto), el
  costo de las llamadas de transcripción y de otros servicios (Fase 7) y exportar a planilla.
- El panel refleja el costo según los precios que cargue el cliente; no consulta el gasto real del proveedor.
