# Plantilla de configuración de cliente

Todos los datos de esta carpeta son **inventados**. La organización de ejemplo se llama
"Cooperativa Ejemplo" y no existe.

| Archivo | Qué define | Quién lo puede cambiar |
|---|---|---|
| `agente-prompt.md` | Identidad, tono y reglas duras del agente de atención | Proveedor |
| `conocimiento/<unidad>.md` | Qué sabe el agente de cada unidad de negocio y qué datos junta | Proveedor, con validación del cliente |
| `sectores-y-reglas.yaml` | Organización, horarios, sectores, derivación, temas sensibles, seguimientos | Proveedor (los textos editables, también el cliente desde el CRM) |
| `plantillas-meta.md` | Plantillas de WhatsApp a someter a aprobación de Meta | Proveedor, con aprobación del cliente |
| `evals/casos.yaml` | Casos de prueba del agente, corribles en cada cambio | Proveedor |

## Convenciones

- Los identificadores (`id`) van en minúsculas, con guiones: `creditos`, `viajes`, `atencion-general`.
- El `id` de cada unidad en `sectores-y-reglas.yaml` debe coincidir con el nombre del archivo en `conocimiento/`.
- Horarios en formato 24 h (`"08:00"`) y zona horaria IANA (`America/Argentina/Buenos_Aires`).
- Lo que el cliente todavía no definió: `DECISIÓN PENDIENTE` en un comentario, con un valor por defecto.
- Datos personales en ejemplos y evals: siempre inventados y con formato evidente de prueba
  (por ejemplo "Ana Prueba", DNI `XX.XXX.XXX`).

## Estado del formato

El formato es un borrador de la Fase 0. Se va a validar con un esquema (Zod) y se cargará a la
base en la Fase 5. Si una fase posterior necesita un campo nuevo, se agrega primero acá.
