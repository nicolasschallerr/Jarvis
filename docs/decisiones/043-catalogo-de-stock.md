# ADR-043: Catálogo de stock que consulta el agente de atención

**Estado:** aceptada (2026-10-26).

## Contexto
Un cliente con productos o inmuebles para ofrecer (por ejemplo, una inmobiliaria) recibe por WhatsApp e Instagram
preguntas del tipo "¿tienen deptos de 2 dormitorios en el centro?" o "¿sigue disponible la casa de la calle X?". Hasta
ahora el agente solo tenía la base de conocimiento en Markdown, que sirve para reglas y requisitos pero no para un stock
que cambia todas las semanas: tendría que reescribirse a mano y meterse entero en el prompt.

## Decisión
### Una tabla de catálogo genérica
- `catalog_items` guarda el stock de cada organización: operación, tipo, título, zona, localidad, precio (número,
  moneda y el texto tal como se publica), superficie, dormitorios, baños, descripción, fotos, enlace a la ficha original
  y un `details` (jsonb) con lo propio de cada fuente. Las columnas cubren lo común de un catálogo inmobiliario, que es el
  primer caso; un rubro distinto usa las que le sirvan y `details` para el resto.
- RLS: el equipo de la organización lo lee (página Stock del CRM). Solo el servidor lo escribe.
- Un ítem que deja de aparecer en la fuente no se borra: se marca `is_available = false`, para que las conversaciones
  viejas que lo mencionan sigan teniendo sentido y el agente diga "ya no está disponible" en vez de "no existe".

### Cómo se carga: un formato común, un lector por cliente
- El producto define un **formato de archivo** (JSON con una lista de ítems, ver `src/lib/catalog/import.ts`) y un
  script, `scripts/cargar-catalogo.mts`, que lo sube a la base (alta, actualización y baja lógica).
- **Cómo se lee la web o el sistema de cada cliente no es código del producto**: depende del HTML o de la API de ese
  cliente. Vive en su carpeta privada (`../Orbita AI - Privado/clientes/<slug>/`) y produce el archivo en el formato
  común. Así se respeta la regla de separación producto/cliente.
- **Copia periódica, no consulta en vivo**: el agente busca en la base, no en la web del cliente en el momento. Responde
  rápido, puede filtrar (zona, precio, dormitorios) y no depende de que el sitio del cliente responda.
- DECISIÓN PENDIENTE: cada cuánto se actualiza y dónde corre el lector en producción (tarea programada en la máquina
  del operador, o un lector configurable en el servidor). Por ahora se corre a mano: lector del cliente y después
  `cargar-catalogo.mts`.

### El "agente de stock" es una capacidad del agente de atención
- No es un tercer agente que conversa: la persona habla con una sola voz, y pasarle la pregunta a otro modelo duplicaría
  la demora y el costo de cada respuesta. Son dos herramientas más del agente de atención:
  - `buscar_en_catalogo`: filtra por operación, tipo, zona, dormitorios mínimos, precio máximo y palabras clave
    (ej. "pileta"), y devuelve los resultados más relevantes con su id.
  - `ver_ficha_del_catalogo`: trae la ficha completa de un ítem (descripción, detalles, fotos, enlace).
- Se activan por cliente con `catalogo.activo: true` en `sectores-y-reglas.yaml`; el nombre con que el agente se refiere
  al catálogo (ej. "propiedades") también es configuración. Sin eso, el agente no tiene las herramientas.
- El filtro se hace en el servidor sobre los ítems disponibles de la organización, sin distinguir tildes ni mayúsculas
  ("galpon" encuentra "Galpón"). Un catálogo de cientos de ítems entra holgado; si un cliente tuviera decenas de miles,
  se pasa el filtro a la base.
- Las reglas del prompt piden no inventar: si un dato no está en la ficha, el agente lo dice y ofrece consultar al
  área.

## Consecuencias
- Un cliente nuevo con stock necesita su lector (en su carpeta privada) y activar el catálogo en su configuración.
- La página Stock del CRM muestra qué ve el agente y cuándo se actualizó por última vez.
- Los evals pueden usar un catálogo en memoria (`createMemoryCatalog`), igual que el backend de casos.
