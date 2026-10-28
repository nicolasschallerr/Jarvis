# ADR-050: Asistente de la empresa

**Estado:** aceptada (2026-10-28). Sigue a ADR-049 (agente financiero).

## Contexto
Cada agente responde sobre lo suyo (el analítico, la operación; el financiero, los números; el de stock, el catálogo).
Hacía falta "un Claude de la empresa": un solo lugar donde preguntar cualquier cosa sobre los datos de la organización,
por ejemplo "¿cuántos préstamos de 2 millones hicimos este mes?", siempre disponible.

## Decisión
- **Página Asistente** (primera del grupo Inteligencia), para superadmin y consulta y reportes, como Reportes y Finanzas.
- **Siempre encendido y visible como agente**: tiene su fila en `agents` (tipo `assistant`, la crea un trigger) para
  aparecer primero en Agentes y en el Panorama, con nombre y frase editables. No tiene interruptor y la tabla tiene una
  regla (`agents_assistant_always_on`) que no deja apagarlo. Su gasto se registra aparte en `ai_calls` (Consumo).
- **Apartado propio**: pantalla de bienvenida con el orbe (las tres órbitas del logo girando alrededor de un núcleo
  que respira; gira más rápido mientras piensa), saludo con el nombre, sugerencias por tema en tarjetas, respuesta que se
  escribe de a palabras y caja de texto flotante. "Menos movimiento" deja todo quieto y muestra la respuesta entera.
- **Herramientas**: reúne las del analítico, las del financiero y la búsqueda del catálogo, y suma tres con filtros:
  `buscar_movimientos` (tipo, texto en categoría/descripción/contraparte, rango de monto, fechas y estado),
  `buscar_casos` (texto en título o resumen, estado, sector, fechas) y `contar_contactos`. Todas leen con la sesión de
  quien pregunta (RLS): el Asistente nunca ve más que esa persona.
- **Sin datos personales**: como el analítico, no devuelve nombres, documentos ni mensajes de clientes o asociados.

## Pendiente
Que el Asistente pueda leer también la base de conocimiento de cada sector y los datos que conecte cada cliente.
