# Clientes

Jarvis es un solo producto para todos los clientes. Lo que cambia entre un cliente y otro
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
2. **Clonarlo dentro de esta carpeta**, en la terminal ubicada en la raíz de `jarvis`:
   ```
   git clone https://github.com/<usuario>/jarvis-cliente-<slug>.git clientes/<slug>
   ```
   Queda ignorado por el repo del producto, pero tiene su propio historial.
3. **Copiar la plantilla** dentro del repo del cliente:
   ```
   Copy-Item -Recurse clientes/_plantilla/* clientes/<slug>/
   ```
4. **Completar cada archivo** con la información del cliente, siguiendo
   [`_plantilla/README.md`](_plantilla/README.md). Lo que el cliente todavía no definió se
   marca como `DECISIÓN PENDIENTE` con un valor por defecto razonable.
5. **Escribir los evals** del cliente (`evals/casos.yaml`): al menos 3 casos por unidad de
   negocio, más los de temas sensibles. Siempre con datos personales inventados.
6. **Commitear y pushear** en el repo del cliente (no en el del producto).
7. **Cargar la configuración** en la base de Jarvis bajo su `organization_id`
   Desde la carpeta `jarvis`: `npx tsx --env-file=.env.local scripts/cargar-configuracion.mts --org-slug <slug>`
   (con `--validar-solo` solo revisa el archivo, sin tocar la base).
8. **Seguir el playbook** de implementación: [`docs/playbook-implementacion.md`](../docs/playbook-implementacion.md).

## Reglas

- Nada específico de un cliente puede quedar fuera de su carpeta: ni en `src/`, ni en `docs/`,
  ni en tests.
- Nunca guardar DNI, teléfonos ni datos personales reales en ningún repo, ni siquiera en
  evals: siempre datos inventados.
- Si un dato del cliente obliga a tocar código, es una señal de que falta un campo de
  configuración: se agrega a la plantilla y al esquema, no un `if (cliente === ...)`.
