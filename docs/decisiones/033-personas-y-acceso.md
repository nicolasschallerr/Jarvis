# ADR-033: Alta de personas y acceso sin servicio de email

**Estado:** aceptada (2026-10-25).

## Contexto

Las cuentas se creaban solo con un script. Hacía falta sumar personas, cambiarles el rol, desactivarlas y ayudar a quien
olvidó su contraseña, desde la interfaz. Todavía no hay un servicio de email configurado (el correo por defecto de
Supabase solo envía a miembros del proyecto), así que no se puede depender de mensajes por correo.

## Decisión

- **Sección "Personas" en Equipo (solo superadmin):** alta, cambio de rol, desactivar/reactivar y enlace de acceso.
- **Enlace de acceso de un solo uso** (`generateLink` de tipo recuperación): el superadmin lo copia y se lo pasa a la
  persona. `/auth/confirmar` lo canjea por una sesión y manda a `/nueva-clave`, donde elige su contraseña (mínimo 12
  caracteres). Dura 1 hora (lo define Supabase) y se usa una sola vez. El destino es fijo y solo se acepta el tipo
  recuperación. Sirve igual para "olvidé mi contraseña": el login lo explica.
- **La contraseña inicial es al azar y no se muestra a nadie.**
- **Reglas:** nadie cambia su propio rol ni se desactiva; la organización nunca queda sin un superadmin activo; todo
  se verifica contra la organización de quien actúa; desactivar también bloquea el ingreso en el sistema de cuentas.
- **Cambiar mi contraseña** está en Preferencias.

## Consecuencias

- Quien tenga el enlace entra como esa persona hasta que elija su contraseña: se muestra una sola vez, con ese aviso.
- Cuando haya un servicio de email, se puede sumar "Olvidé mi contraseña" autoservicio y enviar el enlace por correo;
  el mecanismo de canje ya está.
- Sumar a una persona a sectores sigue haciéndose desde cada sector.
