---
description: Documenta la fase actual al terminarla (bitácora, ADRs, lecciones, playbook, tag y estado del proyecto)
argument-hint: "[número de fase, ej. 03]"
---

Vamos a cerrar la **Fase $ARGUMENTS** de Jarvis. Si no se indicó número, deducilo del último
archivo en `docs/bitacora/` y confirmalo conmigo antes de seguir.

## 1. Reunir información (solo lectura)

- `git tag --list "fase-*"` para ubicar el cierre de la fase anterior.
- `git log --format="%h %ad %s" --date=short <tag-anterior>..HEAD` (o todo el historial si no hay tags).
- `git diff --stat <tag-anterior>..HEAD` para ver los archivos principales.
- Leer `docs/bitacora/`, `docs/decisiones/`, `docs/lecciones.md` y `docs/playbook-implementacion.md`
  para no duplicar entradas.
- Buscar commits `fix:`, reverts y comentarios `TODO`, `FIXME` o `DECISIÓN PENDIENTE` del período.

## 2. Bitácora

Crear o completar `docs/bitacora/fase-XX-<nombre>.md` con:
Fase y fechas aproximadas · Objetivo · Qué se construyó (archivos principales) · Cómo se resolvió
(pasos clave) · Problemas encontrados y solución · Tiempo invertido · Qué haría distinto la
próxima vez · Deuda técnica pendiente.

## 3. ADRs

Por cada decisión de arquitectura nueva de la fase, crear `docs/decisiones/NNN-titulo.md`
(siguiente número libre) con: Título y número · Estado · Contexto · Decisión · Alternativas
consideradas y por qué se descartaron · Consecuencias. Si una decisión reemplaza a otra, marcar
la anterior como "reemplazada por ADR-NNN".

## 4. Lecciones

Agregar a `docs/lecciones.md`, bajo un título `## Fase XX`, cada problema real con:
Problema (síntoma) · Causa real · Solución · Cómo evitarlo la próxima vez.

## 5. Playbook

Si la fase cambia cómo se implementa un cliente, actualizar la etapa correspondiente de
`docs/playbook-implementacion.md` (Kickoff, Discovery, Setup, Build, UAT, Go Live, Mantenimiento).

## 6. Chequeo de confidencialidad

Sobre los archivos versionados (`git ls-files`), buscar nombres del cliente piloto, sus unidades
o sistemas, DNI, teléfonos, emails reales y secretos (API keys, tokens). Si aparece algo,
**detenerse y avisarme** antes de cualquier commit. Verificar que `.gitignore` siga excluyendo
`.env*` y `/clientes/*` (salvo `README.md` y `_plantilla/`).

## 7. Verificación

Correr `npx tsc --noEmit`, `npm run lint`, `npm run build` y los tests y evals que existan. Informar
el resultado real, sin maquillarlo.

## Reglas

- Lo que no se pueda deducir con certeza va como `[COMPLETAR]` y se me pregunta; no inventar.
- No crear tags ni hacer push sin mi confirmación.

## 8. Entregar

1. Resumen de lo construido y deuda técnica pendiente.
2. Mensaje de commit sugerido (`docs: cerrar fase XX`).
3. Tag sugerido: `fase-XX` sobre el commit de cierre (crearlo solo si lo confirmo).
4. Bloque **ESTADO DEL PROYECTO** para pegar en una conversación nueva, con: fase cerrada y
   siguiente, stack y versiones, qué está desplegado y dónde, pasos pendientes, decisiones
   pendientes y deuda técnica, y comandos para retomar.
