# Clientes

Orbita AI es un solo producto para todos los clientes. Lo que cambia entre un cliente y otro
(identidad del agente, conocimiento, sectores, reglas, plantillas, casos de prueba) es
**configuración**, no código. Esta carpeta define el formato de esa configuración.

## Qué se versiona acá

| Ruta | ¿En este repo? | Contenido |
|---|---|---|
| `clientes/README.md` | Sí | Este instructivo |
| `clientes/_plantilla/` | Sí | Configuración de ejemplo con datos **100% inventados** |
| `clientes/<cliente>/` | **No** (ignorado por `.gitignore`) | Configuración real, en un repo privado propio del cliente |

La configuración real nunca entra a este repo: puede contener datos protegidos por
acuerdos de confidencialidad. Ver [ADR-005](../docs/decisiones/005-config-de-cliente-en-repo-privado.md).

## Dónde vive la configuración de cada cliente

Esta carpeta del software **no tiene datos de ningún cliente**: es la plantilla para todos. La configuración real de
cada cliente vive afuera, en una carpeta privada al lado del proyecto:

```
Escritorio/
  Orbita AI/                     el software (este repo): igual para todos los clientes
  Orbita AI - Privado/
    clientes/<slug>/             configuración, conocimiento, evals y referencias de cada cliente
    marca/                       manual de marca de Orbita AI
```

Los scripts leen la carpeta del cliente con `--dir`, por ejemplo
`--dir "../Orbita AI - Privado/clientes/<slug>"`. Si una carpeta de cliente se clona dentro de `clientes/<slug>/`,
`.gitignore` igual la deja afuera del repo.

## Cómo funciona en tiempo de ejecución

1. La carpeta del cliente es la **fuente versionada** (quién cambió qué prompt o regla, y cuándo).
2. El script `scripts/cargar-configuracion.mts` valida `sectores-y-reglas.yaml` contra un esquema
   y guarda sectores y unidades en la base de Jarvis bajo el `organization_id` del cliente. Se puede
   repetir sin duplicar; lo que se saca del archivo se desactiva, no se borra. Carga sectores,
   unidades, agentes y la configuración del agente de atención (`agente-prompt.md`, `conocimiento/`,
   horario, temas sensibles y `ia`) como una versión nueva solo si algo cambió. El resto de las
   secciones se cargan cuando las use el agente (Fase 9).

   El conocimiento de cada unidad (por ejemplo, cada "rama" de atención) va en `conocimiento/<unidad>.md` o,
   si es largo, en una carpeta `conocimiento/<unidad>/` con varios `.md` (información, datos a juntar,
   mensajes fijos); se unen en orden alfabético. Los datos que el agente junta se definen en `campos` del YAML
   (con su regex, ayuda y dónde se guardan), y los textos que el sistema envía tal cual, como el menú y la
   derivación, en `textos_editables`. Ver [ADR-022](../docs/decisiones/022-ramas-datos-validados-y-menu.md).
3. En producción el agente y el CRM leen la configuración **desde la base**. Los textos que el
   cliente puede editar (saludos, mensajes) se editan desde el CRM; los cambios estructurales
   (sectores, reglas, prompt) se hacen en la carpeta y se vuelven a cargar.

## Alta de un cliente nuevo, paso a paso

1. **Crear el repo privado** del cliente en GitHub, con el nombre `jarvis-cliente-<slug>`
   (`<slug>` en minúsculas y sin espacios, por ejemplo `cooperativa-ejemplo`).
2. **Crear su carpeta privada** (o clonar su repo) en `Orbita AI - Privado\clientes\<slug>` y **copiar la plantilla**,
   desde la carpeta `Orbita AI`:
   ```
   Copy-Item -Recurse clientes/_plantilla/* "../Orbita AI - Privado/clientes/<slug>/"
   ```
4. **Completar cada archivo** con la información del cliente, siguiendo
   [`_plantilla/README.md`](_plantilla/README.md). Lo que el cliente todavía no definió se
   marca como `DECISIÓN PENDIENTE` con un valor por defecto razonable.
5. **Escribir los evals** del cliente (`evals/casos.yaml`): al menos 3 casos por unidad de
   negocio, más los de temas sensibles. Siempre con datos personales inventados.
6. **Commitear y pushear** en el repo del cliente (no en el del producto).
7. **Crear su organización y su superadministrador** en la base de **producción**:
   `npx tsx --env-file=.env.produccion scripts/crear-superadmin.mts --org-slug <slug> --org-name "<Nombre>" --email <email> --name "<Nombre Apellido>"`
8. **Cargar la configuración** en esa organización (con `--validar-solo` primero, para revisar sin tocar la base):
   `npx tsx --env-file=.env.produccion scripts/cargar-configuracion.mts --org-slug <slug> --dir "../Orbita AI - Privado/clientes/<slug>"`
   Para probar antes en desarrollo, el mismo comando con `--env-file=.env.local`.
   **Si tiene stock** (por ejemplo, una inmobiliaria): activar `catalogo` en `sectores-y-reglas.yaml`, escribir en su
   carpeta privada un lector de su web o sistema que genere `catalogo.json` con el formato común
   (`src/lib/catalog/import.ts`) y cargarlo con `scripts/cargar-catalogo.mts` (ADR-043).

   **Para una demo comercial** (prospecto): con un guion en `demo/escenarios.yaml`, en desarrollo,
   `npx tsx --env-file=.env.local scripts/sembrar-demo-cliente.mts --dir "../Orbita AI - Privado/clientes/<slug>"`
   arma la organización `<slug>-demo` y Claude responde de verdad cada mensaje del guion (cuesta dinero).
9. **Conectar sus canales** con `scripts/crear-canal.mts` (ver `docs/guia-conectar-meta.md`) y **encender el agente** desde Agentes.
10. **Seguir el playbook** de implementación: [`docs/playbook-implementacion.md`](../docs/playbook-implementacion.md).

## Reglas

- Nada específico de un cliente puede quedar fuera de su carpeta: ni en `src/`, ni en `docs/`,
  ni en tests.
- Nunca guardar DNI, teléfonos ni datos personales reales en ningún repo, ni siquiera en
  evals: siempre datos inventados.
- Si un dato del cliente obliga a tocar código, es una señal de que falta un campo de
  configuración: se agrega a la plantilla y al esquema, no un `if (cliente === ...)`.
