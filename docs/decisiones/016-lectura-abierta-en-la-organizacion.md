# ADR-016: Lectura abierta dentro de la organización, escritura por sector

**Estado:** aceptada (2026-10-23). Reemplaza la cláusula de visibilidad de casos por sector y cierra la
limitación abierta del ADR-009.

## Contexto
El ADR-009 hacía visibles los casos solo para el asignado y los miembros del sector, y dejaba como
DECISIÓN PENDIENTE si conversaciones y mensajes debían seguir el mismo criterio. El dueño del proyecto
decidió que **todos los operadores pueden ver las conversaciones de otros sectores**. Dejar los casos
ocultos habría sido incoherente: se vería el chat pero no su caso.

## Decisión
- Todos los usuarios de una organización leen todas las conversaciones, mensajes, casos y, por herencia,
  eventos, etiquetas, notas internas, seguimientos y consultas a áreas del caso.
- Escribir no cambia: modificar un caso sigue permitido solo al superadmin, al asignado y a los miembros
  del sector (`cases_update`). El rol de consulta y reportes no escribe.
- El único cambio en la base es `cases_select` (migración `20261023140000`): pasa a filtrar solo por
  organización. Las tablas hijas lo heredan porque su política consulta `cases`.
- El aislamiento entre organizaciones no se toca (ADR-009).

## Alternativas descartadas
- Visibilidad por sector también en conversaciones (la propuesta original): más privacidad entre
  sectores, pero una bandeja y un contexto de IA más complejos; el dueño del proyecto no la quiso.
- Dejar los casos por sector y solo abrir las conversaciones: incoherente para el operador.

## Consecuencias
- Un operador puede leer los datos personales de afiliados de cualquier sector de su organización.
  Es una decisión de negocio: debe constar en el contrato y la política de privacidad con el cliente.
- Las funciones de rol más finas (qué hace un superadmin frente a un operador, permisos por sector) se
  definirán más adelante; el modelo de roles actual (`superadmin`, `operator`, `viewer`) se mantiene.
- Si el cliente pide restringir la lectura, se vuelve a derivar la visibilidad desde `cases` con un ADR
  nuevo que reemplace a este.
