# Fase 5: Sectores, casos, ficha del asociado y rediseño del CRM

**Estado:** cerrada
**Fechas:** 2026-10-23 a 2026-10-24

## Objetivo
Que el equipo pueda organizar el trabajo: sectores con sus personas, casos con estado e historial,
asignación, notas y ficha del asociado. Y, a pedido del dueño del proyecto, darle al CRM una identidad
propia: paleta cálida, agentes visibles, bienvenida animada y un tablero de casos.

## Decisión de negocio que marcó la fase
Todos los operadores pueden **leer** las conversaciones y los casos de otros sectores; **escribir** sigue
limitado al asignado, al sector y al superadmin (ADR-016). Los permisos finos del superadmin se definirán
más adelante.

## Qué se construyó
| Paso | Resultado | Archivos principales |
|---|---|---|
| 5.0 | Lectura abierta de casos en la organización | migración `…140000`, ADR-016 (`958c36e`) |
| 5.1 | Script que valida el YAML del cliente y carga sectores y unidades | `src/lib/client-config/*`, `scripts/cargar-configuracion.mts` (`357d01c`) |
| 5.2 | Equipo por sector para el superadmin + **corrección de seguridad** de seis políticas | `src/app/(crm)/equipo/*`, `src/lib/crm/team.ts`, migración `…150000` (`2a9cddd`, `baf18e4`) |
| 5.3 | Crear caso, cambiar estado y prioridad, historial automático | migración `…160000`, `src/lib/crm/cases.ts`, panel de caso (`907d051`) |
| 5.4 | Asignar, derivar de sector y listas Mis casos, Sin asignar, Por sector y Todos | `src/lib/crm/case-list.ts`, `src/app/(crm)/casos/*` (`ce52492`) |
| 5.5 | Notas internas inmutables, atadas al caso abierto | `src/lib/crm/notes.ts`, migración `…180000` (`3215e1a`) |
| 5.6 | Ficha del asociado con auditoría de cambios | `src/lib/crm/contact-card.ts`, migraciones `…190000` y `…191000` (`79f99ad`) |
| R1 | Base visual: paleta, tipografía, claro y oscuro, esqueleto responsive | `globals.css`, `shell.tsx`, `side-panel.tsx` (`9dab7b4`) |
| R2 | Tabla `agents`, mascotas SVG, Inicio con datos reales | migración `…200000`, `src/components/agents/*` (`fe20915`) |
| R3 | Bienvenida animada y selector de animaciones | `src/components/welcome/*`, `motion-toggle.tsx` (`619bd8f`, `ec6b5d4`) |
| R4 | Tablero kanban con arrastrar y soltar | `src/components/kanban/board.tsx` (`98739ed`) |

Pruebas: **189** en 25 archivos, todas pasan (de 86 al cierre de la Fase 3 a 98 al cierre de la 4).
`build`, `lint` y tipos sin errores.

## Cómo se resolvió
1. Lo que no puede olvidarse (historial, auditoría, un caso abierto por conversación, `resolved_at`) vive en la
   base, con disparadores e índices, y no en las pantallas (ADR-017).
2. Cada operación del CRM es una función en `src/lib/crm/` que recibe el cliente del usuario (RLS), valida el rol
   y devuelve un resultado; las acciones de servidor son capas finas. Todo se prueba contra la base de desarrollo.
3. El rediseño se hizo por etapas, con commit y verificación en cada una (ADR-018).
4. Verificación real con el sitio desplegado en cada paso, a cargo del dueño del proyecto.

## Problemas encontrados y solución
Ver lecciones 27 a 36. Los más importantes:
- **Seguridad (27):** un `INSERT` eludía el rol en seis políticas de la Fase 1. Se corrigió y quedó cubierto con
  pruebas por tabla. Solo existió en la base de desarrollo.
- **Disparador roto (28):** bloqueó las ediciones de contactos durante unos minutos; las pruebas lo detectaron.
- **Entorno de prueba (32, 33):** sin ventana visible no se pueden verificar animaciones; la bienvenida no se veía
  por una preferencia de Windows, no por un error.

## Tiempo invertido
[COMPLETAR]

## Qué haría distinto la próxima vez
- Probar el `INSERT` por rol al crear cada tabla, no al encontrar el problema una fase después.
- Condicionar siempre el commit al resultado de las pruebas (`&&`).
- Medir el entorno (preferencias del sistema, despliegue) antes de sospechar del código.

## Deuda técnica pendiente
- **Pruebas:** la prueba del trabajador es intermitente por competir con el trabajador real; falta poder pausarlo
  durante las pruebas (lección 31).
- **Seguridad antes de producción:** chequeo automático de políticas (hoy se revisa a mano con `pg_policies`),
  rotar la clave de servicio de Supabase y `WORKER_SECRET`, protección contra contraseñas filtradas (depende del
  plan) y decidir la región de la base (hoy `us-west-2`, Ley 25.326).
- **Privacidad:** la lectura abierta (ADR-016) debe constar en el contrato y en la política de privacidad.
- **Roles:** definir permisos más finos del superadmin y de los operadores (lo hará el dueño del proyecto).
- **Contraseñas:** la recuperación hoy es por script (`restablecer-password.mts`); falta hacerlo desde la interfaz.
- **Usuarios:** no se crean desde la interfaz (script `crear-superadmin.mts`).
- **Agentes:** falta la pantalla para editar nombre, frase y encender o apagar un agente; el estado lo escribirá
  el motor de la Fase 6, que también tiene que distinguir "agente" de "sistema" en el historial.
- **Contactos duplicados:** se avisa pero no se unen (Fase 12). Los responsables del YAML no se cargan (avisos, Fase 9).
- **Tablero:** sin paginación ni orden dentro de la columna; muestra hasta 200 casos abiertos y los 15 resueltos
  más recientes.
- **Interfaz:** falta una pasada de accesibilidad con herramientas (contraste, foco) y pruebas en celulares reales;
  las pantallas internas se vieron en el navegador del dueño, no en pruebas visuales automáticas.
- **Auditoría:** `audit_log` cubre solo contactos.
- **Heredado:** estados y adjuntos de WhatsApp (Fase 14), modo eco (se quita en la Fase 6), retención de la bandeja
  de eventos, envío saliente de imágenes y audios.
