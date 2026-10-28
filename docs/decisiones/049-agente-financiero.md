# ADR-049: Agente financiero y demo de empresa completa

**Estado:** aceptada (2026-10-28). Sigue a ADR-046 (agente de stock) y al agente analítico.

## Contexto
El producto se muestra a mentores y prospectos con una sola demo. Faltaba un cuarto agente que responda sobre los
números de la empresa (no de la operación del CRM), y una demo con todos los agentes encendidos y datos coherentes.

## Decisión
- **Tabla `finance_movements`**: cada ingreso o egreso, cobrado/pagado (`paid`) o pendiente (`pending`, con
  vencimiento). "Vencido" no se guarda: se calcula. La cargan procesos del equipo (importación o demo) con la clave de
  servicio; leen solo superadmin y consulta y reportes (RLS), igual que Reportes y Consumo.
- **Criterio de caja**: el resultado del mes es lo cobrado menos lo pagado; lo pendiente va aparte (por cobrar / por
  pagar). Las cuentas están en `src/lib/finance/summary.ts` y las usan tanto la página como el agente, así el número de
  la pantalla y el de la respuesta coinciden.
- **Agente `finance`**: nuevo valor de `agent_kind`, una fila por organización (apagada, la crea un trigger). Usa el
  mismo circuito que el analítico (herramientas de solo lectura, modelo `JARVIS_ANALYTIC_MODEL`, gasto en `ai_calls`)
  con cuatro herramientas: resumen del período, por categoría, evolución mensual y pendientes.
- **Página Finanzas** (grupo Inteligencia): tiles del mes, barras de seis meses, egresos por categoría, por cobrar y
  por pagar, y el chat con el agente. El chat del analítico se generalizó para servir a los dos.
- **Configuración del cliente**: `agentes[].tipo` admite `stock` y `financiero` para darles nombre y frase.
- **Demo de empresa** (`scripts/sembrar-demo-cliente.mts`): el guion acepta `finanzas` (categorías mensuales con
  variación fija y partidas pendientes) y `--usuarios "correo:rol,..."` suma cuentas que ya existen (el dueño y un
  mentor) en vez de crear un administrador; al volver a armar la demo esas cuentas se conservan.

## Pendiente
Conectar los movimientos reales de un cliente (sistema de gestión o planilla), igual que el stock (ADR-047).
