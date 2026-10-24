# Playbook de implementación de un cliente

**Estado:** borrador (Fase 0). Se completa con lo que se aprenda en cada fase y en el piloto.
"Proveedor" = quien implementa y opera Jarvis.

---

## 1. Kickoff

**Qué pedirle al cliente**
- Responsable del proyecto del lado del cliente y canal de comunicación.
- Autorización formal (por escrito) del alcance y del acceso a datos de sus asociados.
- Firma del acuerdo de confidencialidad y del contrato de encargo de tratamiento de datos (Ley 25.326).

**Qué configura el proveedor**
- Repo privado `jarvis-cliente-<slug>` a partir de `clientes/_plantilla/` (ver `clientes/README.md`).

**Checklist**
- [ ] Contrato y confidencialidad firmados
- [ ] Repo del cliente creado y clonado en `clientes/<slug>/`

**Riesgos conocidos**
- Arrancar sin autorización escrita de acceso a datos personales.

## 2. Discovery

**Qué pedirle al cliente**
- Unidades de negocio, sectores y responsables (nombre, email, horarios).
- Qué resuelve el agente en cada unidad y qué datos junta antes de derivar.
- Horario de atención, feriados, temas sensibles y reglas de seguimiento.
- Líneas de WhatsApp actuales: cuántas son y si están en WhatsApp común o en la app Business. [COMPLETAR para el cliente piloto]
- Si ya tiene un Meta Business Portfolio y quién lo administra. [COMPLETAR para el cliente piloto]
- Acceso a su base de datos o sistemas (qué tablas, qué permisos mínimos).

**Qué configura el proveedor**
- `sectores-y-reglas.yaml`, `conocimiento/<unidad>.md`, `agente-prompt.md`.

**Checklist**
- [ ] Cada unidad tiene archivo de conocimiento y sector asignado
- [ ] Temas sensibles definidos
- [ ] Las `DECISIÓN PENDIENTE` están listadas y con valor por defecto

**Riesgos conocidos**
- Conocimiento incompleto: el agente deriva todo y no aporta valor.

## 3. Setup

**Qué pedirle al cliente**
- Iniciar la **verificación de su negocio en Meta** lo antes posible (tarda; sin ella, el límite inicial es bajo).
- Una línea nueva y dedicada para el número unificado.
- Aprobación de los textos de las plantillas de Meta.

**Qué configura el proveedor**
- Organización en Jarvis (`organization_id`), usuarios y perfiles del CRM.
- Canal de WhatsApp (número y credenciales como configuración) y plantillas sometidas a Meta.
- Programación del trabajador de mensajes: secretos `jarvis_app_url` y `jarvis_worker_secret` en Vault y variables de entorno en Vercel (se aplican solo a despliegues nuevos: redesplegar).
- Usuarios del CRM con su rol (superadministrador, operador, consulta y reportes): el rol de consulta lee pero no responde.
- Sectores, unidades y agentes (nombre y frase) desde `sectores-y-reglas.yaml` con `scripts/cargar-configuracion.mts`; después, el superadmin arma los equipos desde la pantalla Equipo.
- Visibilidad (ADR-016): todos los operadores **leen** todo lo de su organización y **escriben** solo en lo asignado a ellos o a su sector. Acordarlo por escrito con el cliente, porque implica que un operador puede leer datos personales de afiliados de otros sectores.
- Para desarrollar sin esperar a Meta: un bot de Telegram como canal de prueba (ADR-013).
- Carga de la configuración del repo del cliente a la base (script pendiente, Fase 5).

**Checklist**
- [ ] Verificación de Meta iniciada / aprobada
- [ ] Número registrado y webhook recibiendo mensajes
- [ ] El trabajador corre solo (cron) y un mensaje de prueba llega, se guarda y se contesta
- [ ] Sectores y agentes cargados; equipos armados y un caso de prueba creado, asignado, derivado y resuelto
- [ ] Revisión de políticas RLS (`pg_policies`): toda política `ALL` o `INSERT` exige el rol en `WITH CHECK`
- [ ] Plantillas aprobadas

**Riesgos conocidos**
- Registrar un número en la Cloud API lo saca de la app de WhatsApp del teléfono.
- Límites de envío iniciales de números y portfolios nuevos.

## 4. Build

**Qué pedirle al cliente**
- Casos reales (anonimizados) de cada unidad para armar evals.

**Qué configura el proveedor**
- `evals/casos.yaml` con datos inventados; ajustes de prompt y conocimiento hasta pasar los evals.

**Checklist**
- [ ] Evals por unidad pasan
- [ ] Ningún dato personal real en el repo del cliente ni en el del producto

**Riesgos conocidos**
- [COMPLETAR]

## 5. UAT

**Qué pedirle al cliente**
- Operadores de cada sector para probar con el número de piloto y completar la planilla de feedback.

**Qué configura el proveedor**
- Número de piloto (chip descartable) y usuarios de prueba.

**Checklist**
- [ ] Cada sector recibió y respondió casos derivados
- [ ] Feedback incorporado

**Riesgos conocidos**
- [COMPLETAR]

## 6. Go Live

**Qué pedirle al cliente**
- Fecha de salida y plan de comunicación a sus asociados.
- Aviso en las líneas anteriores con el nuevo número.

**Qué configura el proveedor**
- Cambio del canal al número definitivo (es configuración, no código).
- Salida gradual respetando los límites de envío.

**Checklist**
- [ ] Monitoreo y alertas activos
- [ ] Panel de consumo de créditos visible para el cliente

**Riesgos conocidos**
- Migración de números con historial (Fase 14).

## 7. Mantenimiento

**Qué pedirle al cliente**
- Actualizaciones de conocimiento, precios y responsables.

**Qué configura el proveedor**
- Cambios estructurales en el repo del cliente y recarga a la base; textos editables los cambia el cliente desde el CRM.

**Checklist**
- [ ] Evals corridos después de cada cambio
- [ ] Revisión periódica de la evaluación automática de conversaciones

**Riesgos conocidos**
- [COMPLETAR]
