# ADR-036: Límites de consumo y alertas

**Estado:** aceptada (2026-10-25). Cierra lo pendiente de la Fase 11 (ADR-023).

## Contexto
El panel de consumo mostraba créditos y costo, pero sin tope ni aviso: nadie se enteraba de que se estaba por pasar el
presupuesto hasta ver el panel.

## Decisión
- **Cada organización fija un tope mensual de créditos y/o de costo estimado de IA y el porcentaje al que se avisa**
  (por defecto 80%). Se cambia en Consumo (solo el superadmin); todos los roles que ven el consumo ven el medidor.
- **Es informativo: no corta al agente.** Cortarlo al llegar al límite es una decisión de negocio con el cliente
  (`DECISIÓN PENDIENTE`); por ahora solo se avisa.
- **El trabajador revisa el consumo** (cada 10 minutos por organización) y avisa a los superadmins **una sola vez** al llegar
  al umbral y **otra** al superar el límite. En un mes nuevo se empieza de cero. El aviso aparece en el Inicio y lleva a Consumo.
- El consumo del mes se calcula en la base por una función solo para el servidor (`org_month_usage`), en la zona horaria
  de la organización.

## Consecuencias
- Un límite de costo depende de que el cliente haya cargado los precios del modelo (si no, el costo es cero).
- No hay avisos por email o WhatsApp todavía: dependen de un servicio de envío.
