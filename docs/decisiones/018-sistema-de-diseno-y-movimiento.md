# ADR-018: Sistema de diseño cálido, agentes visibles y control del movimiento

**Estado:** aceptada (2026-10-23 a 2026-10-24). Complementa el ADR-002 (Next.js, Tailwind) y el ADR-015.

## Contexto
El CRM tenía un aspecto neutro y sin identidad. Se quiso una experiencia más humana, con los agentes de IA
como compañeros de equipo visibles, sin cambiar el modelo de datos ni rehacer el producto como un CRM de
ventas. Además, el equipo usa el CRM todo el día: el movimiento no puede molestar ni excluir a nadie.

## Decisión
- **Tokens de color** en `globals.css` (crema `#F5F2EB`, acento azul petróleo, color propio por agente) con
  modo claro y oscuro por `data-theme`. La escala de grises de Tailwind (`zinc`) se **remapea** a neutros
  cálidos: toda la interfaz existente toma el color nuevo sin reescribir cada clase. Piezas reutilizables en
  una sola capa: `btn-primary`, `btn-secondary`, `field`, `card`.
- **Tipografía:** Fraunces (títulos) y Geist (texto), con `next/font`.
- **Agentes como datos:** tabla `agents` (nombre, frase, estado, encendido) aparte de `agent_configs`
  (prompts versionados). Se cargan desde la sección `agentes:` del YAML del cliente sin pisar el estado.
- **Mascotas** originales en SVG, con animaciones CSS ligadas al estado real del agente. Un agente en pausa
  duerme: la interfaz no muestra "trabajando" si no lo está.
- **Honestidad en la interfaz:** las frases de los agentes (bienvenida, tarjetas) solo informan datos reales de
  la bandeja; ninguna afirma una acción que el agente no hizo.
- **Bienvenida animada** tras el inicio de sesión (`?bienvenida=1`): completa la primera vez del día y corta
  (0,8 s) el resto, con "Saltar", cortina desde el servidor, red de seguridad y carga diferida de `motion`.
- **Movimiento controlable:** `data-motion` ("full" o "reduce") lo fija un script antes de pintar, con la
  elección del menú (automática, siempre activas o reducidas) o, si no hay, la preferencia del sistema.
  Reducido anula animaciones y transiciones y omite la bienvenida.
- **Responsive:** menú fijo en pantallas medianas y cajón en celular; el panel de la conversación es un cajón en
  pantallas chicas.
- **Tablero de casos** con `@dnd-kit/core`: arrastre desde una manija, teclado, selector "Mover a",
  actualización optimista con `useOptimistic` que se deshace si el servidor rechaza el cambio.

## Alternativas descartadas
- shadcn/ui: una capa más de componentes y dependencias para un CRM chico; las piezas propias bastan.
- Respetar solo la preferencia del sistema sin selector: deja sin la bienvenida a quien tiene las animaciones
  apagadas por rendimiento (pasó con el dueño del proyecto).
- Mascotas en 3D o peluche: requieren imágenes que no se pueden producir en el repositorio.
- Replicar deals, empresas, pipeline comercial y n8n del prompt original: Jarvis atiende afiliados y gestiona
  casos; ya tiene su modelo y su trabajador (ADR-014).

## Consecuencias
- Cambiar la paleta es tocar `globals.css`; los componentes no llevan colores propios, salvo las etiquetas de
  prioridad y estado.
- La animación no se puede verificar en un navegador sin ventana visible (no hay cuadros de animación): su
  lógica se prueba con jsdom y relojes falsos; el resultado visual lo confirma una persona.
- `motion` y `@dnd-kit/core` son dependencias nuevas; `motion` solo se descarga cuando hay bienvenida.
- Pendiente: pasada de accesibilidad con herramientas (contraste, foco) y prueba en dispositivos reales.
