# ADR-044: Panorama como primera pantalla, menú explicado y CRM sin mascotas

**Estado:** aceptada (2026-10-27). Reemplaza la parte de los agentes en 3D del ADR-031 (las mascotas) y la bienvenida con
mascotas del ADR-018. El resto del ADR-031 (identidad, paleta, página pública) sigue vigente.

## Contexto

El dueño del producto pidió un CRM más serio y profesional: las mascotas (zorro y búho en 3D) le quitaban seriedad para
venderlo a empresas. Además, la primera pantalla mostraba solo pendientes y el menú era una lista sin explicación: quien
entra por primera vez no sabía qué hace cada sección.

## Decisión

- **Sin mascotas.** Cada agente se representa con un **emblema**: su inicial dentro de las órbitas de la marca, en su
  color. Las órbitas giran si está encendido (más rápido si está trabajando) y el estado se muestra con un punto que late
  ("en vivo"). Se quitaron `three`, `@react-three/fiber` y `@types/three` (la página pesa bastante menos). El inicio de
  sesión y la página pública usan una ilustración de órbitas en CSS.
- **Panorama** (`/inicio`) como primera pantalla: saludo con el estado de los agentes, lo que hay que atender ahora,
  actividad de los últimos 14 días (gráfico de mensajes recibidos y enviados con detalle al pasar el mouse), casos
  abiertos por estado, avisos, listas personales, agentes y un mapa de **todo lo que se puede hacer**, según el rol.
- **Menú agrupado** en "Día a día", "Inteligencia" y "Administración". Cada sección tiene una línea que dice para qué
  sirve: aparece a la derecha del menú al pasar el mouse (o con el teclado) y en el mapa del Panorama. Las secciones se
  definen en un solo lugar: `src/app/(crm)/sections.tsx`.
- **Movimiento:** entrada de cada sección y de los bloques del Panorama en CSS (arranca apenas se pinta la página y no deja
  transformaciones aplicadas), números que cuentan hasta su valor, línea del gráfico que se dibuja, fondo del saludo con
  luces que se mueven, reflejo que sigue al mouse en las tarjetas, indicador del menú que se desliza. Todo respeta
  "Animaciones" en Preferencias: con "Reducidas" (o el sistema pidiendo menos movimiento) no se anima nada; las
  animaciones de la librería de movimiento lo leen con `MotionProvider`.

## Consecuencias

- Si la computadora tiene las animaciones apagadas en el sistema, el CRM se ve quieto: se activan desde Preferencias →
  Animaciones → "Siempre activas".
- El Panorama hace una consulta más (el reporte de 14 días). Es la misma función de la base que usan los Reportes.
