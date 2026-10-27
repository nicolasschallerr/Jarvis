# ADR-047: El stock lo conecta Orbita AI, no el cliente

**Estado:** aceptada (2026-10-27). Reemplaza la parte de ADR-045 en la que el superadmin del cliente conectaba fuentes
desde el CRM.

## Contexto
La primera versión (ADR-045) le pedía al cliente que pegara el enlace de una planilla o subiera un CSV en la sección
Stock. Al dueño del producto no le gustó: conectar el stock es parte del servicio, y lo que el cliente tiene de verdad
es una base de datos o una tienda online, no una planilla.

## Decisión
- **Las fuentes se configuran en la carpeta privada del cliente** (`catalogo.fuentes` en `sectores-y-reglas.yaml`) y se
  cargan con `cargar-configuracion.mts`, igual que el resto del cliente. Se identifican por nombre: cambiar una fuente
  la vuelve a leer; sacarla la quita y deja sus productos como no disponibles. En el CRM, el cliente ve **solo el estado**
  ("Conectado a…", última lectura, errores) y su stock; no hay formularios.
- **Tres conectores**, todos de solo lectura y en el servidor:
  - `supabase`: la base del cliente por su API REST, tabla completa de a 1000 filas (hasta 5000). Las columnas se
    reconocen como los encabezados de una planilla (nombre, precio, stock, SKU, marca…) y `columnas` traduce las que
    tengan nombres propios.
  - `web`: primero Shopify (`/products.json`) y WooCommerce (Store API), que publican el catálogo en JSON; si no es
    ninguna, el mapa del sitio y los datos de producto schema.org (JSON-LD) de cada ficha, que publican casi todas las
    tiendas (Tiendanube incluida) para los buscadores. Con tiempo vencido la lectura queda **incompleta** y entonces no se
    da de baja lo que faltó, para que un sitio lento no vacíe el catálogo.
  - `planilla`: Google Sheets pública, como antes.
- **Claves**: nunca en el archivo ni en la base. La configuración nombra una variable de entorno, que tiene que empezar
  con `CATALOGO_`, para que un archivo de configuración no pueda hacer leer otra variable del servidor (por ejemplo la
  clave de servicio de Orbita). El valor lo carga el dueño en Vercel y en el `.env`.
- **Pedidos del servidor**: solo https, solo nombres de dominio públicos (sin IPs, localhost ni nombres internos, también
  después de una redirección), 12 s por pedido, 8 MB por respuesta. La base solo puede ser `*.supabase.co`.
  Limitación aceptada: no se resuelve el DNS para descartar un dominio público que apunte a una IP interna; las
  direcciones las escribe Orbita AI, no el cliente.
- **Cuándo**: un trabajador propio, `/api/worker/catalog` (hasta 5 minutos por vuelta), que pg_cron llama cada 10 minutos
  con la URL y el secreto del trabajador de mensajes guardados en Vault. Lee de a una las fuentes cuyo intervalo
  (`cada_horas`) se cumplió. Si no hay fuentes, ni despierta a la aplicación. `scripts/sincronizar-stock.mts` fuerza una
  lectura al dar de alta un cliente.
- La sección Stock aparece en el menú cuando hay productos o una fuente configurada.

## Consecuencias
- Conectar un cliente nuevo: completar `catalogo.fuentes`, cargar la clave (si es una base) en Vercel, correr
  `cargar-configuracion.mts` y `sincronizar-stock.mts`, y encender el agente de stock en Agentes.
- Los formularios y acciones de ADR-045 se eliminaron. La tabla `catalog_sources` y su estado se mantienen.
