# ADR-026: Agente analítico de solo lectura

**Estado:** aceptada (2026-10-24). Construido y probado con un modelo simulado; falta probarlo con Claude real.

## Contexto

El tercer componente del producto es un agente que responde preguntas de negocio en lenguaje natural ("¿cuántos casos
abiertos hay por sector?", "¿cuánto tardamos en resolver este mes?"), solo lectura. La base del cliente (sus sistemas) es
aparte y todavía no hay acceso; los datos de Jarvis (casos, conversaciones, consultas al área, consumo) ya están.
Dejar que un modelo escriba SQL contra una base es el riesgo central: errores, fugas y consultas costosas.

## Decisión

- **El modelo no escribe SQL.** Tiene un conjunto fijo de herramientas con parámetros acotados (`contar_casos`,
  `tiempos_de_resolucion`, `contar_conversaciones`, `consultas_al_area`, `resumen_de_consumo`). Cada una hace un
  `select` conocido y valida su entrada. Las preguntas que ninguna herramienta cubre se contestan diciendo qué sí se puede
  consultar.
- **Lee con la sesión de quien pregunta.** Las herramientas usan el cliente del usuario, así que RLS decide qué ve: el
  analista no ve más que esa persona. Las llamadas a IA y el gasto los ven solo superadmin y consulta y reportes.
- **Solo lectura por construcción:** ninguna herramienta escribe y la sesión del usuario no tiene permiso de escritura
  sobre esas tablas para este uso.
- **Sin datos personales de asociados.** Las herramientas devuelven recuentos, sectores, unidades y nombres de personas del
  equipo (para "casos por asignado"), nunca nombres, documentos, teléfonos ni mensajes de asociados. Hay una prueba que lo
  verifica.
- **Los números son honestos:** cada consulta tiene un tope de 5.000 filas y, si se alcanza, la herramienta lo avisa para
  que el recuento parcial no se presente como total. El modelo tiene la instrucción de no inventar cifras y de decir
  cuando algo es parcial.
- **Fechas en la zona horaria de la organización.** "Hoy" lo fija el sistema en las instrucciones; los días se cortan en
  la zona del cliente.
- **Modelo más capaz** (ADR-008), configurable con `JARVIS_ANALYTIC_MODEL`; por defecto `claude-opus-5-5`.
- **Acceso:** pantalla "Analítico" para superadmin y consulta y reportes (los operadores no). Respeta el interruptor del
  agente (`agents.is_enabled` del tipo analítico): apagado, no responde. Sin la clave de Anthropic avisa con claridad.
- **Trazabilidad:** cada pregunta registra sus llamadas en `ai_calls` como del agente analítico (sin conversación), así el
  panel de consumo (ADR-023) incluye este gasto. Un error se registra solo con su motivo, nunca con la pregunta.
- **Charla corta:** se mandan hasta las últimas 10 intervenciones (para entender "¿y el mes pasado?"); la charla vive en
  la pantalla y no se guarda en la base.

## Alternativas descartadas

- **Que el modelo genere SQL con un rol de solo `SELECT`:** más flexible, pero mucho más riesgo (consultas pesadas,
  columnas con datos personales, errores sutiles). Se reconsidera para la base del cliente con vistas ya filtradas.
- **Precalcular reportes fijos:** no sirve para preguntas nuevas, que es lo que se busca.
- **Guardar las conversaciones del analista:** sumaría datos y retención sin necesidad por ahora.

## Consecuencias

- Solo contesta lo que sus herramientas cubren; para preguntas nuevas hay que sumar una herramienta (una migración o un
  `select` más, con su prueba).
- Aún no consulta la base del cliente (socios, cuotas, créditos otorgados): depende de recibir acceso y de definir vistas de
  solo lectura filtradas.
- El costo por pregunta no está medido: depende del modelo y de cuántas herramientas use. Hay que mirarlo en el panel de
  consumo con Claude real.
- Falta guardar preguntas frecuentes, exportar resultados y agregar gráficos.
