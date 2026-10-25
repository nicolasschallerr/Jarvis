# Fase 9: plantillas de Meta y seguimientos (en curso)

**Estado:** construida y probada con un Meta falso (2026-10-25). Falta probar con el número de WhatsApp verificado.
Los seguimientos a las 24, 48 y 72 h se adelantaron en la Fase 6 (ADR-021).

| Paso | Qué se hizo | Dónde |
|------|-------------|-------|
| 9.1 | Verificación en la documentación oficial de Meta: envío de plantillas y listado de la cuenta | ADR-030 |
| 9.2 | Plantillas: variables, texto final, pedido a la Cloud API y estados de Meta | `src/lib/whatsapp/templates.ts` |
| 9.3 | Llamadas a Meta (envío y listado con páginas), con el token fuera de los errores | `src/lib/outbound/whatsapp.ts` |
| 9.4 | Sincronizar y enviar con controles (aprobada, misma organización, baja del contacto, variables) | `src/lib/whatsapp/service.ts` |
| 9.5 | CRM: formulario con vista previa cuando la ventana está cerrada; pantalla Plantillas | `conversaciones/[id]/template-form.tsx`, `/plantillas` |
| 9.6 | Seguimientos fuera de la ventana con la plantilla configurada | `src/lib/followups/run.ts` |
| 9.7 | `--waba-id` en `scripts/crear-canal.mts`; plantillas de ejemplo en la demo | scripts |
| 9.8 | Pruebas: 13 nuevas (`tests/whatsapp-templates.test.ts`) | tests |

## Cómo conectarlo con Meta
1. Crear las plantillas en el Administrador de WhatsApp de Meta y esperar la aprobación.
2. Registrar el canal con su token y su cuenta:
   `npx tsx --env-file=.env.local scripts/crear-canal.mts --org-slug <slug> --name "WhatsApp" --external-id <phone_number_id> --secret-ref WHATSAPP_ACCESS_TOKEN --waba-id <id_de_la_cuenta>`
3. En Orbita AI, **Plantillas → Sincronizar con Meta**.
4. Abrir una conversación con la ventana cerrada y enviar una plantilla de prueba a un número propio.

## Pendiente
- Prueba real con el número verificado (verificación de negocio de Meta en curso).
- Plantillas con encabezado multimedia o botones con variables; envíos masivos.
- Avisos al responsable por email o WhatsApp.
