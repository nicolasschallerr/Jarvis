# ADR-045: Stock de e-commerce y fuentes que el CRM lee solo

**Estado:** aceptada, primera etapa (2026-10-27).

## Contexto
El catálogo de ADR-043 nació para una inmobiliaria: el operador lo cargaba con un script y las columnas eran de
propiedades. Una tienda online necesita otra cosa: que ella misma conecte su stock desde el CRM, que el agente sepa
cuántas unidades quedan (y diga "agotado" en vez de ofrecer lo que no hay) y que se actualice sin que nadie corra nada.

## Decisión
### Los productos viven en la base del CRM
`catalog_items` gana `sku`, `brand` y `stock_quantity` (null = la fuente no informa unidades, 0 = agotado). El agente
sigue consultando la base propia, no la web ni el sistema del cliente en el momento: responde rápido, filtra bien y no
depende de que el sitio del cliente responda (ADR-043). Una tienda puede tener varios orígenes a la vez.

### Fuentes (`catalog_sources`)
Una fuente es "de dónde sale el stock": hoy una planilla de **Google Sheets** (se vuelve a leer sola) o un **archivo CSV**
(se actualiza subiéndolo de nuevo). Cada producto recuerda su fuente (`source_id`), y la baja lógica "ya no está en la
fuente" se hace **por fuente**: una tienda con dos planillas no pisa una con la otra. Quitar una fuente deja sus
productos como no disponibles, no los borra.

- La planilla se lee con encabezados en español o inglés (Nombre, SKU, Marca, Categoría, Precio, Stock, Descripción,
  Imagen, Activo…). Lo que no se reconoce queda como detalle. Precios en formato argentino ("$ 89.900", "1.234,50").
- **Pedidos del servidor**: solo se acepta `docs.google.com` por https, con tiempo de 15 s, tope de 5 MB y comprobación
  de que el destino final siga siendo de Google. Nunca una dirección cualquiera que escriba un usuario (riesgo SSRF).
- La planilla tiene que ser pública con el enlace (solo lectura). No se guardan claves ni tokens de nadie.
- **Quién**: solo el superadmin conecta o quita fuentes, porque cambia lo que el agente le dice a los clientes. Las
  escrituras las hace el servidor con la clave de servicio, siempre acotadas a la organización del perfil.
- **Cuándo**: el trabajador (cada 10 s) vuelve a leer, como mucho dos por pasada, las planillas que cumplieron su
  intervalo. Una fuente con error también anota la hora del intento para no reintentar en cada pasada.
- El superadmin ve siempre la sección Stock (así conecta la primera fuente); el resto, solo si ya hay catálogo.

### Para el agente
`buscar_en_catalogo` acepta `solo_con_stock`. Lo agotado se describe como **AGOTADO** y el agente no lo ofrece como
disponible; SKU y marca se pueden buscar como palabra clave.

## Pendiente (próximas etapas)
- Leer el **sitio web** de la tienda (datos estructurados de producto `schema.org` y, si no hay, extracción asistida).
- Conectar la **base de datos Supabase del propio cliente**, de solo lectura. Requiere guardar credenciales de terceros
  (Vault) y una consulta acotada: se diseña aparte.
- Archivos de **Excel (.xlsx)** directos (hoy se guarda como CSV o se sube a Google Sheets).
- El **agente de stock visible** en Agentes (hoy es una capacidad del agente de atención, ADR-043, sin tarjeta propia).
