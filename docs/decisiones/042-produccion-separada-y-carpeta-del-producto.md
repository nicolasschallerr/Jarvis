# ADR-042: Base de producción separada y el software en su propia carpeta

**Estado:** aceptada (2026-10-26).

## Contexto
Hasta ahora una sola base (`jarvis-dev`, Oregón) hacía de desarrollo y de producción: las pruebas creaban y borraban datos
en la misma base que usaba la aplicación publicada (se acumularon unas 180 organizaciones de prueba), una migración rota
afectaba a todos, la clave de servicio se había mostrado en chats, y los datos personales estaban fuera de la región
recomendada (Ley 25.326). Además, la carpeta del software (`Proyecto Jarvis/jarvis`) tenía adentro la configuración
real del cliente piloto (ignorada por git, pero en la misma carpeta).

## Decisión
### Dos bases
- **Producción:** proyecto `orbita-ai-prod` en **São Paulo** (`sa-east-1`), plan gratis por ahora. La usa Vercel en
  producción. Credenciales en `.env.produccion` (claves nuevas: la de servicio que se había expuesto no sirve acá).
  Las funciones de Vercel pasan a `gru1` (São Paulo), al lado de la base.
- **Desarrollo:** `jarvis-dev` sigue para las pruebas, las vistas previas de Vercel y los ensayos.
- Las migraciones se aplican primero en desarrollo y después en producción con `scripts/migrar-produccion.mts`.
- Producción arranca **limpia**: no se copian conversaciones ni datos de prueba. Se crearon la organización del cliente
  piloto con su configuración, la demo (con el usuario del mentor) y los canales de prueba (Telegram y el número de prueba
  de WhatsApp). El trabajador programado (pg_cron) y la bóveda (dirección de la app y secreto nuevo del trabajador) se
  configuraron en la base nueva.

### El software, separado de los clientes
- `Escritorio/Orbita AI/` es el software (este repo): igual para todos los clientes, **sin datos de ninguno**. Es la
  plantilla para un cliente nuevo: se personaliza con configuración, no con código (`clientes/README.md`).
- `Escritorio/Orbita AI - Privado/` guarda lo que no va al repo: `clientes/<slug>/` (configuración, conocimiento, evals y
  referencias de cada cliente) y `marca/`. Los scripts la leen con `--dir`.

## Consecuencias
- El plan gratis de Supabase no tiene copias de seguridad automáticas y pausa los proyectos sin actividad (el trabajador
  programado la mantiene activa). **Antes de atender al público con datos reales, pasar producción al plan pago** (copias
  de seguridad diarias).
- Falta desactivar el registro público de usuarios en Auth (hoy cualquiera puede crearse una cuenta sin perfil: no ve
  nada por RLS, pero no debería poder crearla). Se hace en el panel de Supabase.
- El trabajador programado de la base de desarrollo sigue llamando a la dirección de producción con el secreto viejo: recibe
  401 y no hace nada. Las vistas previas de Vercel usan la base de desarrollo.
- La carpeta vieja `Proyecto Jarvis/` queda como respaldo hasta que el dueño del proyecto la borre.
