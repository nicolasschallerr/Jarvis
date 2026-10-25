# ADR-031: Marca Orbita AI, página pública y agentes en 3D

**Estado:** aceptada (2026-10-25). Reemplaza la parte visual del ADR-018.

## Contexto

El producto pasa a llamarse **Orbita AI** (manual de marca v2.0). "Jarvis" queda como el nombre del agente de atención
de la organización propia; cada cliente nombra a sus agentes como quiera.

## Decisión

- **Identidad del manual:** símbolo de tres órbitas entrelazadas (proporciones exactas del manual), "orbita" en Manrope
  400 y "AI" en Manrope 700 color petróleo, JetBrains Mono para etiquetas y datos. Paleta Noche `#040B12`, Tinta
  `#08151F`, Niebla `#DCEBF0`, Bruma `#F4F7F8`, Petróleo `#22B8C9` (sobre oscuro) y `#0A7F8C` (sobre claro). Los
  tokens semánticos del ADR-028 se mantienen; cambian sus valores.
- **Rutas:** `/` es la página pública de Orbita AI (estática, sin sesión); el panel pasa a `/inicio`; `/login` lleva
  al panel si ya hay sesión.
- **Nombres de agentes en la interfaz:** se leen de la configuración (`getAgentNames`); nada dice "Jarvis" fijo.
- **Mascotas en 3D** (three.js + React Three Fiber): un zorro con auriculares para el agente de atención y un búho con
  anteojos para el analítico, armados con formas simples y material tipo vinilo (sin modelos descargados). Respiran,
  parpadean, siguen el cursor y cambian según el estado: trabajando, disponible, esperando aprobación o durmiendo
  (apagado).
- **Rendimiento y accesibilidad:** el 3D se carga aparte y solo en el navegador; no se dibuja fuera de pantalla; con
  "menos movimiento" queda quieto; sin WebGL se muestra un respaldo. Cada mascota tiene una descripción para lectores
  de pantalla.

## Consecuencias

- La carpeta del repo sigue llamándose `jarvis` (renombrarla rompería rutas y scripts); el paquete es `orbita-ai`.
- Nuevas dependencias: `three` y `@react-three/fiber` (solo en el navegador, en un pedazo aparte).
- Los animales de cada agente son fijos por tipo; si un cliente quiere otro animal, es una opción de configuración a
  agregar.
