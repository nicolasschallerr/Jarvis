# ADR-006: Workspace de Anthropic dedicado con límite de gasto

**Estado:** aceptada (2026-10-20)

## Contexto

El presupuesto de infraestructura y APIs en desarrollo es de unos USD 50 por mes. Una API key
filtrada o un bucle de código que llama al modelo sin parar puede consumir el saldo.

## Decisión

- Workspace `jarvis-dev` en la Claude Console, con su propio límite de gasto mensual
  (sugerido para empezar: USD 10).
- Las API keys se crean dentro de ese workspace; la clave local va en `.env.local` (ignorado por git).
- Según la documentación de Anthropic, el workspace *Default* no admite límite de gasto propio:
  no se usa.

## Alternativas descartadas

- **Usar el workspace Default:** sin tope propio.
- **Solo el límite de la organización:** no separa desarrollo de futuros entornos (producción, otros clientes).

## Consecuencias

- El daño por error o filtración tiene techo.
- Si se alcanza el tope, las llamadas fallan hasta el mes siguiente o hasta subirlo: hay que
  monitorear el consumo (Fase 11).
