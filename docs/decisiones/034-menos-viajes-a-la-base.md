# ADR-034: Menos viajes a la base y funciones cerca de ella

**Estado:** aceptada (2026-10-25). Complementa el ADR-032.

## Contexto

Al probar el CRM en producción, la navegación se sentía lenta. Se midió con un contador temporal de consultas en el
servidor (no se dejó en el código):

- Todas las consultas tardan lo mismo que un viaje simple a la base (~240 ms medidos desde Argentina hasta Oregón, con la
  vista de conversaciones, las tablas y las funciones por igual): **la base no es lenta, lo que cuesta es la distancia**.
- Cada pantalla hacía entre 11 y 16 consultas y varias en fila (los adjuntos esperaban a los mensajes, que esperaban a
  la conversación…). Cada "tanda" en fila suma un viaje completo.
- La consulta del perfil se repetía 3 veces en paralelo (menú, bloque de usuario y página).
- Las funciones de Vercel corrían en `iad1` (Virginia) y Supabase está en `us-west-2` (Oregón): cada consulta cruzaba el país.

## Decisión

- **Funciones de Vercel en `pdx1` (Portland)**, la misma zona que la base (`vercel.json`). Medida mientras la base siga en
  `us-west-2`.
- **Una consulta de perfil por pedido** aunque la pidan varios componentes a la vez (`cache` de React alrededor de la
  lectura con `use cache: private`).
- **Conteos en una consulta cada uno**: `home_counts` (4 conteos del Inicio) e `inbox_counts` (5 pestañas), funciones de la
  base "security invoker" (RLS sigue limitando a la organización).
- **Consultas independientes, juntas** (`Promise.all`): conversación (de 8 consultas en fila a 3 tandas), bandeja (lista y
  conteos a la vez), casos (los sectores solo en la vista "Por sector") y contacto.
- **3D más liviano**: resolución máxima 1,5x y 30 cuadros por segundo.

## Resultado medido

Inicio: de 13 consultas a 7. Conversación: 8 consultas en fila pasaron a 3 tandas. Con las funciones en la misma zona que
la base, cada tanda baja de decenas de milisegundos a unos pocos.

## Consecuencias

- **La mejora de fondo es acercar todo a los usuarios**: cuando se cree la base de producción (ya pendiente por la región y
  la ley de datos personales), conviene **São Paulo (`sa-east-1`)** y funciones en `gru1`. Es lo mejor para usuarios en
  Argentina y también resuelve el tema legal.
- Un conteo nuevo se agrega a esas funciones, no como consulta suelta.
