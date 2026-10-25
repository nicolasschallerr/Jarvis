# ADR-035: Auditoría ampliada y exportaciones a CSV

**Estado:** aceptada (2026-10-25).

## Contexto

`audit_log` registraba solo los cambios en fichas de contactos y las uniones. Para una organización (y por la Ley 25.326)
hace falta poder responder "quién hizo qué y cuándo", y poder llevarse los datos a una planilla.

## Decisión

### Auditoría
- **Disparadores en la base** para lo que una persona cambia desde su sesión: tomar o devolver una conversación, asignarla,
  canales (alta, cambio, baja; nunca el token ni la configuración interna), agentes (encender, apagar, renombrar) y sectores
  (quién se suma, se va o es responsable). El actor es `auth.uid()`; si lo hace el servidor queda como "Sistema" y si lo hizo
  el agente en una ficha, como "Agente".
- **En el código**, con el nombre de quien lo pidió, lo que se hace con el cliente de servicio: alta de personas, cambio de
  rol, activar y desactivar, enlaces de acceso, sincronizar plantillas, cambiar límites y exportar (`recordAudit`).
- **Nunca datos personales en el detalle** (ni email ni contenido de mensajes): solo nombres de campos, ids y cantidades.
- **Pantalla `/auditoria`** (solo superadmin, y RLS lo garantiza): frases en español, filtro por tipo y paginación.
- Registrar es un efecto secundario: si falla, se anota en el servidor y no rompe lo que la persona hacía.

### Exportaciones
- `/exportar/casos`, `/contactos`, `/consumo` y `/auditoria` descargan un CSV. Cada una **vuelve a comprobar sesión y rol**
  en el servidor (el botón es solo comodidad), se lee con la sesión de quien exporta (RLS) y **deja registro** de quién exportó qué.
- **Quién puede:** contactos y auditoría, solo el superadmin (datos personales); casos y consumo, también consulta y reportes;
  el operador no exporta.
- **Seguridad del archivo:** valores que empiezan con `=`, `+`, `-` o `@` se neutralizan para que una planilla no los
  ejecute como fórmula (los datos vienen de personas externas); UTF-8 con marca para Excel; tope de 5.000 filas.

## Consecuencias
- Cada exportación y cada cambio sensible queda registrado.
- Un número de teléfono exportado como texto empieza con un apóstrofo visible en la planilla: es el costo de la protección.
- Falta: auditar también las lecturas de datos personales (hoy solo se registran los cambios y las exportaciones).
