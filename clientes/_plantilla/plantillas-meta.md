# Plantillas de WhatsApp (ejemplo inventado)

Fuera de la ventana de 24 h solo se pueden enviar plantillas aprobadas por Meta.
Cada plantilla se somete desde la cuenta de WhatsApp Business del cliente y queda aprobada o rechazada.
Las variables se escriben `{{1}}`, `{{2}}`, etc. Antes de someterlas, verificar el formato y
las categorías vigentes en la documentación oficial de Meta.

## recordatorio_gestion_pendiente

- **Categoría:** Utility (DECISIÓN PENDIENTE: confirmar categoría con Meta)
- **Idioma:** es_AR
- **Uso:** seguimientos de 24/48/72 h cuando una gestión quedó a medias.
- **Texto:**
  > Hola {{1}}, te escribimos de Cooperativa Ejemplo. Quedó pendiente tu consulta sobre {{2}}. ¿Querés que la sigamos?
- **Variables:** `{{1}}` nombre del asociado · `{{2}}` tema de la gestión

## confirmacion_turno

- **Categoría:** Utility
- **Idioma:** es_AR
- **Uso:** confirmar un turno agendado.
- **Texto:**
  > Hola {{1}}, te recordamos tu turno del {{2}} a las {{3}} h. Respondé SÍ para confirmar o NO para cancelar.
- **Variables:** `{{1}}` nombre · `{{2}}` fecha · `{{3}}` hora
