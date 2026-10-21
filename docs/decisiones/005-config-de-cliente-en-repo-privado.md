# ADR-005: Configuración de cada cliente en un repo privado aparte, cargada a la base por organización

**Estado:** aceptada (2026-10-20)

## Contexto

Jarvis debe servir a varios clientes sin cambios de código. Hay un acuerdo de confidencialidad
con el cliente piloto: ningún dato real suyo puede quedar en el código del producto.

## Decisión

- El repo del producto versiona solo `clientes/README.md` y `clientes/_plantilla/` (datos inventados).
- La configuración real de cada cliente vive en un **repo privado propio** (`jarvis-cliente-<slug>`),
  clonado en `clientes/<slug>/` e ignorado por `.gitignore`.
- En tiempo de ejecución, la fuente de verdad es la **base de Jarvis** por `organization_id`;
  un script (Fase 5) valida los archivos y los carga.
- Formato: Markdown para textos largos (prompt, conocimiento, plantillas) y YAML para reglas
  estructuradas (admite comentarios y lo puede leer alguien no técnico).

## Alternativas descartadas

- **`clientes/<slug>/` dentro del repo del producto:** quien accede al producto ve datos del
  cliente; separarlo después exige reescribir el historial de git.
- **Solo en la base:** pierde el historial de quién cambió un prompt o una regla, y cuándo.
- **JSON en vez de YAML:** no admite comentarios.

## Consecuencias

- El producto se puede mostrar o compartir sin exponer datos de clientes.
- Dos repos que mantener por cliente; el alta queda documentada en `clientes/README.md`.
- Deuda: esquema de validación y script de carga (Fase 5).
