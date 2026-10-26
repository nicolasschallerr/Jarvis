# Lecciones aprendidas

Una entrada por problema real. Se agregan al cerrar cada fase (comando `/cerrar-fase`).

---

## Fase 0

### 1. "node no se reconoce como comando" justo después de instalarlo
- **Problema:** después de instalar Node y Git, la terminal decía que los comandos no existían.
- **Causa real:** estaban instalados y en el PATH del sistema, pero la ventana de PowerShell se
  abrió antes y conservaba el PATH viejo.
- **Solución:** cerrar la terminal (y VS Code) y abrir una nueva.
- **Cómo evitarlo:** abrir siempre una terminal nueva después de instalar algo.

### 2. winget falla con código 1603 al instalar Node
- **Problema:** `winget install OpenJS.NodeJS.LTS` terminó con "Installer failed with exit code: 1603".
- **Causa real:** el log decía "A later version of Node.js is already installed": había una versión más nueva.
- **Solución:** ninguna; verificar la versión instalada con la ruta completa.
- **Cómo evitarlo:** ante un 1603, leer el log que indica winget antes de reintentar.

### 3. `npm` bloqueado: "la ejecución de scripts está deshabilitada"
- **Problema:** `node -v` funcionaba pero `npm -v` no.
- **Causa real:** en PowerShell, `npm` es un script `.ps1` y la Execution Policy por defecto los bloquea.
- **Solución:** `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.
- **Cómo evitarlo:** incluirlo en la preparación de cualquier PC Windows nueva.

### 4. Email de ejemplo guardado en `git config`
- **Problema:** `user.email` quedó como `tu-email@ejemplo.com`.
- **Causa real:** se copió literalmente un comando de ejemplo de la guía.
- **Solución:** `git config --global user.email "<email real>"`.
- **Cómo evitarlo:** en las guías, marcar los valores a reemplazar con `<...>` y verificar con `git config --global --list`.

### 5. Comandos ejecutados en la carpeta padre del repo (se repitió 4 veces)
- **Problema:** `npm run build` → `ENOENT package.json`; `git ...` → `not a git repository`;
  `npm install` y `supabase init` crearon `package.json`, `node_modules/` y `supabase/` fuera del repo.
- **Causa real:** la terminal abría en `Proyecto Jarvis\` y el repo está en `Proyecto Jarvis\jarvis\`.
- **Solución:** mover `supabase/` al repo, borrar los archivos sobrantes y reinstalar dentro de `jarvis`.
- **Cómo evitarlo:** abrir VS Code con *File > Open Folder* en `jarvis` y usar su terminal; el prompt debe terminar en `\jarvis>`.

### 6. `project_id` de Supabase con el nombre de la carpeta
- **Problema:** `supabase/config.toml` quedó con `project_id = "Proyecto_Jarvis"`.
- **Causa real:** `supabase init` toma el nombre de la carpeta donde se ejecuta (era la equivocada).
- **Solución:** cambiarlo a mano a `jarvis`.
- **Cómo evitarlo:** correr `supabase init` dentro del repo y revisar `config.toml` después.

### 7. Avisos de Git que parecen errores en PowerShell
- **Problema:** "LF will be replaced by CRLF" y la salida de `git push` en rojo.
- **Causa real:** el primero es el efecto esperado de `core.autocrlf=true`; el segundo, PowerShell
  mostrando como error lo que Git escribe en stderr.
- **Solución:** ninguna; mirar el resultado real (por ejemplo `a3cdc25..a37ba04 main -> main`).
- **Cómo evitarlo:** saber que no son fallas.

### 8. Claves reales pegadas en `.env.example` (el archivo que sí se versiona)
- **Problema:** al completar las variables de Supabase, los valores reales quedaron en `.env.example` en vez de `.env.local`.
- **Causa real:** `.env.example` es versionable y `.env.local` no existía todavía; Next.js solo lee `.env.local`.
- **Solución:** copiar el archivo a `.env.local`, restaurar `.env.example` con `git checkout`, y verificar con `git status` y el historial que nada se haya commiteado.
- **Cómo evitarlo:** crear `.env.local` antes de completar valores; regla: `.env.example` = solo nombres. Pendiente: verificación automática que impida commitear valores ahí.

### 9. Capturas de pantalla con token y datos visibles
- **Problema:** el panel de Meta muestra el token de acceso dentro de un bloque de código aunque se tache el campo principal.
- **Causa real:** el mismo token aparece en el comando `curl` de ejemplo.
- **Solución:** el token del panel es temporal; con los permanentes (Fase 3) sería grave.
- **Cómo evitarlo:** tapar todos los bloques de código y IDs antes de compartir capturas.

### 10. La interfaz de Meta no coincide con la guía
- **Problema:** no existía un botón "Start using the API"; hay una experiencia guiada de 3 pasos.
- **Causa real:** los menús de Meta cambian y la guía oficial describe una versión anterior.
- **Solución:** guiarse por capturas reales y usar solo el Paso 1 ("Pruébalo") para el número de prueba.
- **Cómo evitarlo:** pedir captura antes de indicar clics exactos en paneles de terceros.

## Fase 2

### 11. El build falla con "uncached or runtime data during prerendering"
- **Problema:** `npm run build` fallaba en la página de inicio al leer la sesión del usuario.
- **Causa real:** el proyecto tiene Cache Components activado; leer cookies es un dato "de pedido" y debe ir dentro de `<Suspense>`.
- **Solución:** mover la lectura a un componente async envuelto en `<Suspense>` con un fallback (la página queda como Partial Prerender).
- **Cómo evitarlo:** en Next.js 16 con Cache Components, todo componente que lea cookies, headers o datos sin caché va dentro de `<Suspense>`. Leer `node_modules/next/dist/docs/` antes de escribir páginas.

### 12. `npm install vitest` falla con ERESOLVE
- **Problema:** conflicto de dependencias entre vitest y `@types/node`.
- **Causa real:** el proyecto traía `@types/node@20`, pero el Node real es 24 y vitest pide una versión más nueva.
- **Solución:** `npm install --save-dev @types/node@^24 vitest`.
- **Cómo evitarlo:** alinear `@types/node` con la versión de Node instalada; no usar `--force`.

### 13. Un comando con `&&` y `grep -c` sin coincidencias cortó la cadena
- **Problema:** el commit no se hizo, aunque el comando parecía completo.
- **Causa real:** `grep -c` devuelve código de salida 1 cuando cuenta 0, y `&&` se detiene.
- **Solución:** repetir el commit aparte.
- **Cómo evitarlo:** no encadenar con `&&` comprobaciones que pueden dar 0 a propósito; verificar `git log` después de cada commit.

### 14. Pasos confirmados sin ejecutarse
- **Problema:** se dio por hecho que el superadmin estaba creado y la base seguía vacía.
- **Causa real:** confirmar sin comprobar el estado real.
- **Solución:** consultar la base (conteos con la clave de servicio) antes de seguir.
- **Cómo evitarlo:** cada paso que crea datos tiene un "cómo verificar" que se ejecuta de verdad.

### 15. El sitio en Vercel daba error 500 tras el login
- **Problema:** `jarvis-mu-inky.vercel.app` devolvía "Internal Server Error" en `/` y `/login`.
- **Causa real:** las variables de entorno de Supabase nunca se cargaron en Vercel (solo en `.env.local`); el proxy creaba el cliente de Supabase sin URL ni clave. El paso 0.8 se dio por hecho sin comprobarlo.
- **Solución:** cargarlas con `scripts/subir-variables-a-vercel.ps1` (la clave de servicio como sensible) y redesplegar; Vercel solo aplica variables a despliegues nuevos.
- **Cómo evitarlo:** después de cualquier cambio que dependa de variables, comprobar con `npx vercel env ls` y probar el sitio desplegado, no solo el local.

### 16. `vercel` no se reconoce aunque esté instalada
- **Problema:** la CLI instalada de forma global no se encontraba desde la terminal del usuario.
- **Causa real:** la carpeta global de npm no estaba en el PATH de esa terminal.
- **Solución:** usar `npx vercel`.
- **Cómo evitarlo:** preferir `npx` para herramientas de proyecto; es lo mismo que se hizo con la CLI de Supabase.

## Fase 03

### 17. Un secreto guardado con el texto de ejemplo
- **Problema:** el trabajador respondía 401: en Vault estaba guardado un texto de ejemplo y no el secreto real.
- **Causa real:** se pegó literalmente el SQL de ejemplo (una vez el navegador tradujo el editor y otra se pegó la salida de la terminal en vez del portapapeles).
- **Solución:** script `scripts/copiar-sql-vault.ps1` que deja el SQL real en el portapapeles; se verificó la coincidencia con una consulta que no imprime el secreto.
- **Cómo evitarlo:** nunca pedir pegar un SQL con un valor "de ejemplo" para un secreto; generarlo con un script y verificar la igualdad sin mostrarlo.

### 18. Un archivo de variables editado a mano rompió la lectura
- **Problema:** la CLI no leía `.env.local`.
- **Causa real:** se renombró una clave (`WORKER_SECRET-REAL=`), que no es un nombre válido.
- **Solución:** restaurar solo el nombre de la clave.
- **Cómo evitarlo:** en `.env.local` se cambia únicamente el valor, nunca el nombre.

### 19. El trabajador real compite con las pruebas
- **Problema:** dos pruebas fallaban en la corrida completa y pasaban solas.
- **Causa real:** la base de desarrollo tiene el cron corriendo cada 10 s, que toma eventos de cualquier organización, también los de las pruebas.
- **Solución:** las pruebas esperan a que no quede nada pendiente de su organización y comprueban el estado en la base, no cuántos eventos procesó cada llamada.
- **Cómo evitarlo:** con un proceso real sobre la misma base, las pruebas de integración no asumen exclusividad sobre las colas.

### 20. Una prueba con un Telegram falso no prueba el Telegram real
- **Problema:** riesgo de dar por bueno el circuito de adjuntos solo con pruebas automáticas.
- **Causa real:** el falso devuelve lo que uno supone (tipo de archivo, rutas).
- **Solución:** además del test, se mandó una foto y un audio reales y se verificó en la base y en el bucket (`image/jpeg` y `audio/ogg`).
- **Cómo evitarlo:** cada integración externa lleva una verificación real al cerrar el paso, no solo tests.

### 21. Datos del cliente piloto en un ADR
- **Problema:** el ADR-013 nombraba al cliente piloto.
- **Causa real:** se escribió sin releer la regla de confidencialidad.
- **Solución:** reemplazado por "cliente piloto"; el chequeo de cierre de fase lo detectó.
- **Cómo evitarlo:** correr el chequeo de confidencialidad de `/cerrar-fase` en cada cierre.

## Fase 04

### 22. `usePathname()` en el menú rompía el build de una ruta dinámica
- **Problema:** `next build` fallaba en `/conversaciones/[id]` ("URL data `usePathname()` outside of `<Suspense>`").
- **Causa real:** con Cache Components, en una ruta dinámica la ruta actual es un dato de pedido; el menú lateral del layout lo leía fuera de `Suspense`.
- **Solución:** envolver el menú en `<Suspense>` con un relleno de la misma altura.
- **Cómo evitarlo:** todo componente que lea la ruta, cookies o parámetros va dentro de `Suspense`; probar con `npm run build`, no solo con `next dev`.

### 23. Tipos viejos de `.next` después de borrar una página
- **Problema:** `tsc` y `build` fallaban buscando `src/app/page.js`, que ya no existía.
- **Causa real:** Next genera tipos en `.next/` y quedaron referencias a la página borrada.
- **Solución:** borrar `.next` y volver a compilar. Sin esa carpeta, `LayoutProps` no existe hasta el siguiente `build`.
- **Cómo evitarlo:** tras borrar o mover rutas, limpiar `.next`; para chequear tipos usar `npm run build`.

### 24. Realtime parecía no entregar eventos en la prueba
- **Problema:** la prueba se suscribía, no daba error y no recibía nada.
- **Causa real:** `SUBSCRIBED` se avisa al unirse al canal, antes de que el servidor confirme la suscripción a cambios de la base.
- **Solución:** `postgres_changes_options: { wait: true }` al crear el canal, en la prueba y en la pantalla.
- **Cómo evitarlo:** en suscripciones a la base, esperar la confirmación del servidor antes de provocar eventos.

### 25. "No me aparece" no siempre es "no se guardó"
- **Problema:** el operador respondió, llegó a Telegram y el CRM no lo mostraba.
- **Causa real:** el mensaje estaba guardado; la pantalla no se enteraba del cambio (faltaba el tiempo real).
- **Solución:** consultar primero la base para separar "no se guardó" de "no se muestra", y luego agregar Realtime.
- **Cómo evitarlo:** ante un "no aparece", verificar el dato en la base antes de tocar la pantalla.

### 26. Los comandos largos con varios bloques en una sola llamada fallan
- **Problema:** una llamada de shell con varios heredocs falló entera con un error de comillas.
- **Causa real:** el análisis de comillas del shell con muchos bloques y apóstrofes.
- **Solución:** escribir cada archivo con la herramienta de escritura y usar el shell solo para comandos cortos.
- **Cómo evitarlo:** un archivo, una herramienta de escritura; nada de documentos largos dentro de comandos.

## Fase 05

### 27. Una política `ALL` con `WITH CHECK` explícito dejaba pasar los `INSERT` sin rol
- **Problema:** al probar el equipo por sector, un operador logró sumarse a un sector directamente en la base. Lo mismo valía para crear canales, sectores y unidades (seis tablas), incluso con un usuario de solo consulta.
- **Causa real:** para un `INSERT` Postgres evalúa solo `WITH CHECK`, no `USING`. Las políticas exigían el rol únicamente en `USING` y su `WITH CHECK` solo miraba la organización.
- **Solución:** repetir la condición de rol en `USING` y en `WITH CHECK` en las seis políticas, con una prueba de regresión por tabla.
- **Cómo evitarlo:** probar el `INSERT` con cada rol en cada tabla nueva; revisar las políticas con `pg_policies` antes de producción (al cerrar la fase todas las `ALL` e `INSERT` ya tienen el rol en las dos condiciones).

### 28. Un disparador con `text[] || 'texto'` bloqueó toda edición de contactos
- **Problema:** guardar la ficha de un contacto fallaba con "malformed array literal".
- **Causa real:** `arreglo || 'locality'` hace que Postgres lea el texto como un literal de arreglo. Como el disparador corría en cada `UPDATE`, también rompía las actualizaciones de la ingesta de mensajes.
- **Solución:** `array_append(arreglo, 'locality'::text)` en una migración nueva (la anterior ya estaba aplicada).
- **Cómo evitarlo:** probar todo disparador por cada camino de escritura (usuario y servidor); las pruebas de integración lo detectaron a los pocos minutos.

### 29. `insert` múltiple de supabase-js manda NULL en las columnas que faltan
- **Problema:** una prueba fallaba con "null value in column" al insertar cuatro casos con distintas columnas.
- **Causa real:** en un `insert([...])` con objetos de claves distintas, las columnas ausentes van como `NULL` explícito y no toman el valor por defecto.
- **Solución:** poner todas las columnas con valor en cada fila, o insertar de a una.
- **Cómo evitarlo:** y revisar siempre `error` en la preparación de una prueba (`expect(inserted.error).toBeNull()`): un insert silenciosamente fallido da resultados engañosos.

### 30. Un commit salió con una prueba fallida
- **Problema:** una corrida completa tuvo una prueba rota y el comando hizo commit y push igual.
- **Causa real:** los pasos estaban encadenados con `;`, que sigue pase lo que pase.
- **Solución:** encadenar con `&&` y exigir en el log "N passed" sin "failed" antes de `git commit`.
- **Cómo evitarlo:** el commit va siempre condicionado al resultado de las pruebas.

### 31. Una prueba intermitente por carrera con el trabajador real
- **Problema:** `descarta un evento tras 5 intentos fallidos` falló dos veces en la suite completa y pasó sola.
- **Causa real (hipótesis):** el trabajador real (pg_cron → Vercel, cada 10 s) comparte la base con las pruebas y puede tocar un evento en medio de la prueba. Misma familia que la lección 19.
- **Solución provisional:** repetir la suite; en las corridas siguientes pasó 3 de 3 sola y en la suite completa.
- **Se repitió (Fase 6):** también falló una vez en la suite completa `un evento inválido queda con su error, sin frenar a los demás` (esperaba 1 evento fallido y vio 0) y pasó 2 de 2 sola. Cualquier prueba que mire eventos de la bandeja es candidata; conviene pausar el trabajador al correr la suite.
- **Cómo evitarlo:** pausar el trabajador mientras corren las pruebas. **Resuelto en la Fase 6:** la suite lo pausa al empezar y lo reanuda al terminar (`set_worker_active` + `tests/helpers/pause-worker.ts`); `scripts/trabajador.mts` lo reanuda a mano si una corrida se corta. Con eso, las fallas intermitentes de esta familia (lecciones 19 y 31) no deberían repetirse; si vuelve una, hay otra causa.

### 32. Un navegador oculto no dibuja cuadros: ni la animación ni la hidratación avanzan
- **Problema:** no se podían sacar capturas ni ver la bienvenida; la página de prueba nunca se hidrató.
- **Causa real:** con la ventana minimizada no hay `requestAnimationFrame` (0 cuadros por segundo); React usa cuadros para completar la hidratación con streaming y las animaciones no avanzan.
- **Solución:** probar la lógica con jsdom y relojes falsos (`@testing-library/react`), comprobar estilos y CSS compilado por JavaScript, y decir con claridad qué no se pudo ver.
- **Cómo evitarlo:** no dar por visto lo visual; separar lo que se prueba automáticamente de lo que confirma una persona.

### 33. La bienvenida "no aparecía" porque Windows tenía las animaciones desactivadas
- **Problema:** la animación funcionaba en las pruebas y no se veía en el equipo del dueño.
- **Causa real:** `prefers-reduced-motion: reduce` estaba activo (efectos de animación apagados en Windows) y la bienvenida lo respeta por diseño. Se confirmó midiendo `matchMedia` en el navegador de su PC.
- **Solución:** selector "Animaciones" (automáticas, siempre activas o reducidas) que decide `data-motion` antes de pintar.
- **Cómo evitarlo:** ante un "no se ve", medir primero el entorno (preferencias del sistema, despliegue, datos) antes de tocar código; y ofrecer control a quien tiene el movimiento apagado por rendimiento.

### 34. `tsc` suelto falla sin la carpeta `.next`
- **Problema:** tras borrar `.next`, `npx tsc --noEmit` daba `Cannot find name 'PageProps'`.
- **Causa real:** Next genera esos tipos globales al compilar; sin ellos el chequeo suelto no los conoce. Refuerza la lección 23.
- **Solución:** correr `npm run build` (que también chequea tipos) antes de `tsc`.
- **Cómo evitarlo:** el orden de verificación es build, lint, tipos y pruebas.

### 35. Los reemplazos con expresiones regulares en varios archivos son frágiles
- **Problema:** un `perl` de varios reemplazos falló entero por la sintaxis y no cambió nada; otros dejaron clases a medias.
- **Causa real:** patrones largos con comillas, saltos de línea y delimitadores en un comando de shell.
- **Solución:** ediciones puntuales con la herramienta de edición y una verificación con `grep` después.
- **Cómo evitarlo:** reservar `perl` y `sed` para cambios de una línea.

### 36. Después de una interrupción, verificar el estado antes de repetir
- **Problema:** una sesión se cortó a mitad de un comando que agregaba una prueba, corría la suite y podía subir.
- **Causa real:** el resultado de la llamada se perdió y no se sabía qué había quedado hecho.
- **Solución:** revisar `git status`, buscar el bloque agregado (una sola vez) y repetir la verificación completa antes del commit.
- **Cómo evitarlo:** los pasos que agregan texto con `>>` no se repiten a ciegas: se comprueba primero si ya están.

## Fase 06

### 37. Un disparador no sabe quién escribe si el servidor entra sin usuario
- **Problema:** el historial de casos anotaba como "sistema" todo lo que hacía el agente, porque el servidor usa la clave de servicio y no hay usuario en la sesión.
- **Causa real:** el disparador deducía el actor solo de `auth.uid()`; con la clave de servicio ese valor es nulo.
- **Solución:** el agente no escribe las tablas: llama funciones de la base que fijan `jarvis.actor = 'agent'` solo dentro de su transacción (`set_config(..., true)`), y el disparador lo lee.
- **Cómo evitarlo:** cuando importe distinguir quién hizo un cambio, pasar esa señal por la misma transacción que escribe; no depender de lo que "se acuerde" de anotar cada llamada.

### 38. Un valor por defecto que toma el recurso real hace que las pruebas puedan gastar
- **Problema:** al conectar el agente al procesador, las pruebas existentes que lo llaman podían terminar usando el cliente real de Claude si `.env.local` tenía una clave.
- **Causa real:** el parámetro nuevo tenía como valor por defecto el cliente real (cómodo en producción, peligroso en pruebas).
- **Solución:** las pruebas pasan `null` explícito (sin agente) y el motor se prueba con el cliente simulado; sin clave el sistema solo guarda mensajes.
- **Cómo evitarlo:** todo servicio que cuesta dinero se inyecta; los tests lo reemplazan de forma explícita y lo único que usa el recurso real es un script manual.

### 39. Probar con un modelo simulado no prueba la calidad de la atención
- **Problema:** las 14 pruebas del motor pasan sin llamar a Claude; eso demuestra el circuito (herramientas, historial, actor, trazabilidad), no que el agente conteste bien.
- **Causa real:** el cliente simulado devuelve lo que se le escribió de antemano.
- **Solución:** declarar la fase como no cerrada hasta correr una conversación real y, en la Fase 8, evaluar con casos fijos.
- **Cómo evitarlo:** separar "el circuito funciona" de "el agente atiende bien", y no dar la segunda por cierta con pruebas de la primera.

### 40. Las barras invertidas dentro de un script escrito por el shell se pierden
- **Problema:** al editar archivos con un script de Python armado en el comando, un `\n` o un `\d` escrito dentro del texto terminaba como un salto de línea real y dejaba el código roto (`Unterminated string literal`).
- **Causa real:** el texto pasa por varias capas (shell, intérprete) y cada una consume barras invertidas; lo que llega al archivo no es lo que se escribió. Es el mismo origen que la lección 35.
- **Solución:** para texto con barras invertidas (regex, `\n`), usar la herramienta de edición o escribir el archivo completo; reservar los scripts de reemplazo para texto sin barras.
- **Cómo evitarlo:** después de cualquier reemplazo automático, compilar (`npx tsc --noEmit`) antes de seguir; el error aparece enseguida.
- **Se repitió** (Fase 7) al agregar un texto con `\n` a un archivo desde un script: el compilador lo marcó al instante y se corrigió con la herramienta de edición. La regla vale tal cual: texto con barras invertidas, siempre con la herramienta de edición.

### 41. Un dato obligatorio nuevo en la plantilla rompe las pruebas que derivan sin datos
- **Problema:** al definir `campos` en la plantilla, cuatro pruebas pasaron a fallar: derivaban sin datos y ahora el guardián lo bloquea, y otra quitaba una unidad a la que un campo apuntaba.
- **Causa real:** las pruebas usaban la plantilla como ejemplo mínimo y asumían que derivar siempre funciona.
- **Solución:** las pruebas que derivan por un tema sensible declaran la excepción (`datos_incompletos_ok`) y la que quita una unidad quita también sus campos. El esquema rechazando el campo huérfano es el comportamiento buscado.
- **Cómo evitarlo:** al sumar una regla de validación, correr la suite completa enseguida: las fallas muestran qué suponía cada prueba.

### 42. Una inserción de varias filas con claves distintas manda nulo a las que faltan
- **Problema:** al sembrar datos de una prueba con un solo `insert` de tres filas, la base rechazó todo con "null value in column status violates not-null constraint", y la prueba que dependía de esos datos vio cero filas, sin ningún aviso.
- **Causa real:** `supabase-js` arma la inserción con la unión de las claves de todas las filas; a la fila que no trae una clave (aquí `status`, que sí tenía valor por defecto) se le manda `null` en vez de usar el valor por defecto. Además el error no se estaba revisando.
- **Solución:** todas las filas con las mismas claves y el valor explícito, y revisar `error` al sembrar datos.
- **Cómo evitarlo:** en las siembras de pruebas, comprobar siempre el error de cada inserción; una siembra que falla en silencio produce fallas lejos de su causa.

## Auditoría de producto (2026-10-24)

### 43. Con Cache Components, leer la hora o la sesión fuera de lugar rompe el prerender
- **Problema:** las páginas del CRM tiraban "Next.js encountered the unstable value `Date.now()` while prerendering" y, al intentar arreglarlo con `connection()` dentro del cliente de Supabase, aparecía "blocking outside Suspense".
- **Causa real:** con `cacheComponents`, Next intenta prerenderizar todo lo que puede. La lectura de la sesión (que internamente usa la hora) y el `new Date()` de cada página son datos de pedido: tienen que estar marcados como tales y dentro de un `<Suspense>`.
- **Solución:** `getCurrentProfile` con `"use cache: private"` (se cachea por usuario y por poco tiempo); cada página del CRM llama `await connection()` al empezar y exporta `instant = false`; el menú, que cuenta avisos, también llama `connection()` y va dentro de `<Suspense>`.
- **Cómo evitarlo:** antes de usar la hora, cookies o la sesión en un componente de servidor, decidir si es dato de pedido; si lo es, `connection()` arriba y `<Suspense>` alrededor. Leer `node_modules/next/dist/docs/` antes de "arreglar" a ciegas.

### 44. El servidor de desarrollo puede servir CSS viejo después de agregar colores al tema
- **Problema:** después de sumar tokens nuevos (`--success`, `--warning`, `--line`...) en `globals.css`, las placas aparecían sin color en el navegador, aunque el CSS compilaba bien.
- **Causa real:** el servidor de desarrollo tenía en memoria la hoja anterior; las clases nuevas no estaban en ella.
- **Solución:** verificar que el CSS compila (con `@tailwindcss/node`) y reiniciar el servidor de desarrollo.
- **Cómo evitarlo:** al tocar el `@theme` de Tailwind, reiniciar `npm run dev` antes de concluir que una clase "no anda".

### 45. RLS decide qué filas se pueden tocar, no qué columnas
- **Problema:** la auditoría encontró que un operador, con su sesión y sin pasar por la pantalla, podía cambiar `last_inbound_at` de una conversación (y abrir a mano la ventana de 24 h de WhatsApp), marcar el consentimiento de un contacto o apuntar un canal a la variable de entorno de otro cliente.
- **Causa real:** las políticas de RLS permiten actualizar la fila entera si la fila es de tu organización y tu rol puede editar; no distinguen columnas.
- **Solución:** disparadores `before update` que, cuando hay un usuario en la sesión (`auth.uid()` no nulo), rechazan cambios en las columnas que solo escribe el sistema (ADR-027). El servidor, sin usuario, sigue pudiendo todo.
- **Cómo evitarlo:** al agregar una columna, preguntarse "¿la cambia una persona desde la pantalla?". Si no, va a la lista de columnas protegidas y se agrega una prueba que lo intente con la sesión de un operador.

### 46. Dos pasadas del trabajador pueden contestar el mismo mensaje
- **Problema:** si una pasada del trabajador tardaba (el modelo demora), la siguiente podía tomar la misma conversación y Jarvis respondía dos veces.
- **Causa real:** nada impedía que dos ejecuciones trabajaran sobre la misma conversación a la vez.
- **Solución:** un turno por conversación en la base (`claim_agent_turn` / `release_agent_turn`) con vencimiento, para que un corte no la deje bloqueada. Si entran mensajes nuevos mientras responde, la misma ejecución los toma (hasta 3 vueltas) en lugar de dejar otra respuesta en paralelo.
- **Cómo evitarlo:** todo proceso programado que pueda superponerse con la pasada siguiente necesita un candado con vencimiento; probarlo pidiendo el turno dos veces seguidas.

### 47. Una función `security definer` sigue viendo al usuario en `auth.uid()`
- **Problema:** después de proteger columnas con disparadores (lección 45), unir contactos dejó de funcionar: 6 pruebas fallaron con la suite completa.
- **Causa real:** `merge_contacts` es una función `security definer` que ejecuta un superadmin. Corre con los permisos del dueño de la función, pero `auth.uid()` lee el token de la sesión, así que sigue devolviendo el usuario. El disparador creyó que era una persona cambiando columnas protegidas.
- **Solución:** el disparador solo restringe cuando `current_user = 'authenticated'` (la persona escribiendo directo con su sesión). Dentro de una función `security definer`, `current_user` es el dueño de la función.
- **Cómo evitarlo:** para saber "quién escribe" en un disparador, combinar `auth.uid()` (quién inició la sesión) con `current_user` (con qué permisos corre la sentencia). Y correr la suite completa después de cualquier disparador nuevo: las pruebas de una función lejana fueron las que lo mostraron.

## Marca Orbita AI, segunda revisión y plantillas (2026-10-25)

### 48. Una cola ordenada por antigüedad se traba con lo que "hoy no puede salir"
- **Problema:** respuestas del área y seguimientos que no se podían enviar (chat tomado, canal sin envío, organización con seguimientos apagados) se salteaban sin cambiar nada; seguían siendo los más viejos y, con suficientes, ocupaban todo el lote y nada nuevo salía.
- **Causa real:** "saltear" no es un estado: la fila vuelve primera en la próxima pasada.
- **Solución:** todo lo que se saltea cambia algo: se posterga (`reply_next_attempt_at`, `due_at` + 15 min), se cancela o se omite (ADR-029).
- **Cómo evitarlo:** en cualquier cola con `limit`, preguntarse qué pasa si las primeras N filas nunca pueden procesarse.

### 49. Una prueba de RLS que "pasa" porque no cambió ninguna fila
- **Problema:** una prueba esperaba que un operador pudiera cambiar el estado de un caso y que el guardia frenara otra columna; la primera dio "sin error" y la segunda no dio el error esperado.
- **Causa real:** RLS no deja al operador tocar un caso ajeno a su sector, y un `update` que no alcanza filas no da error: cambia cero filas.
- **Solución:** probar con quien sí puede (superadmin) y comprobar las filas devueltas con `.select()`.
- **Cómo evitarlo:** en pruebas de escritura con la sesión de una persona, verificar siempre cuántas filas cambiaron, no solo que no hubo error.

### 50. Las reglas del compilador de React no conocen el patrón de React Three Fiber
- **Problema:** el lint marcó 15 errores en la escena 3D por "mutar valores" y "leer refs en el render".
- **Causa real:** React Three Fiber anima mutando los objetos de three.js dentro de `useFrame`, fuera del render; es su patrón documentado, pero las reglas del compilador lo leen como un error.
- **Solución:** desactivar esas dos reglas solo en ese archivo, con el motivo escrito. El aviso de `setState` dentro de un efecto sí era real y se corrigió con `useSyncExternalStore`.
- **Cómo evitarlo:** ante un aviso del compilador en código de una librería con otro modelo (3D, canvas), distinguir si es un error real o el patrón de la librería, y desactivar lo mínimo y explicado.

### 51. Un archivo con módulos de servidor no puede entrar al código del navegador
- **Problema:** las constantes de roles y la longitud mínima de contraseña estaban en el mismo archivo que usa `node:crypto`; los componentes del navegador las importaban y el archivo arrastraba un módulo que no existe allá.
- **Causa real:** importar una constante importa el archivo entero con todo lo que él importa.
- **Solución:** lo compartido va en un archivo propio sin módulos de servidor (`roles.ts`) y el de servidor lo reexporta.
- **Cómo evitarlo:** si un archivo toca `node:*`, `server-only` o el cliente de servicio, no se importa desde un componente `"use client"`; lo que se comparte se separa antes.

### 52. Probar una pantalla desde un navegador oculto puede dar falsos negativos
- **Problema:** una página parecía "no hidratar" (los botones no respondían y los formularios se enviaban recargando la página) y un script de espera se cortó por tiempo.
- **Causa real:** el panel del navegador estaba oculto y el sistema le frena la ejecución; no era el código.
- **Solución:** comprobar lo que no depende de la pantalla directamente (canjear el enlace con una llamada al servidor) y dejar lo visual para cuando el panel está a la vista.
- **Cómo evitarlo:** antes de culpar al código, descartar que sea el entorno de prueba (¿está visible?, ¿otra página que antes andaba también falla?).

### 53. En una app lenta, medir antes de optimizar: la distancia cuenta más que la consulta
- **Problema:** la navegación del CRM se sentía lenta y lo primero que se sospecha es la base de datos o las consultas pesadas.
- **Causa real:** medidas una por una (con la sesión de un usuario), todas las consultas tardaban lo mismo que un viaje vacío: lo caro era cada viaje (la base en Oregón, las funciones en Virginia) multiplicado por la cantidad de consultas en fila (hasta 16 por pantalla, con el perfil repetido 3 veces).
- **Solución:** funciones en la misma zona que la base, una sola consulta de perfil por pedido, conteos en una función de la base, consultas independientes en paralelo (ADR-034).
- **Cómo evitarlo:** contar consultas y tandas por pantalla antes de tocar índices; un contador temporal que registra cada pedido a la base alcanza para verlo. Pensar siempre en "cuántas tandas", no en "cuántas consultas".

### 54. Una palabra clave de baja tiene que ser inequívoca en el negocio del cliente
- **Problema:** el estándar para dejar de recibir mensajes es una palabra ("BAJA", "STOP"), y la primera idea fue aceptar "baja".
- **Causa real:** en una mutual o un gremio, "baja" suele significar darse de baja de un servicio o de la afiliación: una gestión que tiene que llegar al agente o al equipo. Tratarla como "no quiero novedades" habría dejado a esa persona sin atención.
- **Solución:** solo frases inequívocas por coincidencia exacta ("STOP", "no recibir más", "dejar de recibir"…), probadas contra frases parecidas que no deben contar ("quiero la baja del gimnasio").
- **Cómo evitarlo:** antes de automatizar un comando por palabra, preguntarse qué otras cosas significa esa palabra para el cliente y probarlas.

### 55. Los ids de un servicio falso no se pueden repetir entre pruebas
- **Problema:** las pruebas de envíos fallaban con "duplicate key … messages_external_id_key" aunque el código estaba bien.
- **Causa real:** el Meta falso armaba el id del mensaje con el largo de la lista de llamadas, que la prueba vacía entre casos: se repetían los mismos ids y chocaban con los ya guardados.
- **Solución:** un contador aparte que nunca se reinicia.
- **Cómo evitarlo:** todo id que un doble de prueba inventa tiene que ser único en toda la corrida, no en cada caso.

### 56. El orden de un lote no es un orden fijo: no lo uses en una prueba
- **Problema:** una prueba de cancelación fallaba a veces: esperaba que el primer destinatario del lote fuera uno con nombre, y a veces era el que no tenía.
- **Causa real:** los destinatarios se toman por el orden de su identificador (aleatorio).
- **Solución:** que la prueba use solo datos para los que el resultado no depende del orden (aquí, un filtro que deja solo contactos con nombre) y repetirla varias veces para ver que es estable.
- **Cómo evitarlo:** si un resultado depende de cuál fila sale primero, o se ordena de forma explícita o se arma el caso para que todas den lo mismo.

## Agente con Claude real (2026-10-26)

### 57. El eval tiene que ver exactamente lo que recibe la persona
- **Problema:** en la prueba real por Telegram el agente decía dos veces "ya pasé tu consulta", pero los evals daban todo bien.
- **Causa real:** el mensaje oficial de derivación lo agrega el sistema al final del texto del modelo; el runner de evals juzgaba solo el texto del modelo, sin ese agregado, y el modelo no sabía que el sistema lo agregaba.
- **Solución:** una sola función (`composeReply`) arma el mensaje que se envía y la usan el agente real y los evals; el prompt le muestra al modelo el aviso oficial y le pide no repetirlo, tampoco el horario.
- **Cómo evitarlo:** todo lo que el sistema le agrega o le saca a la respuesta del modelo tiene que pasar también por los evals; si no, se evalúa otra conversación.

### 58. Al juez, criterios positivos y concretos
- **Problema:** con un criterio de "no debe" lleno de matices, el juez explicaba que no había falta y aun así la marcaba.
- **Causa real:** las negaciones con condiciones ("además de…", "en el último mensaje…") confunden al modelo juez.
- **Solución:** reescribir el criterio en positivo y verificable ("el último mensaje avisa una sola vez que…") y correr el caso varias veces.
- **Cómo evitarlo:** un criterio por idea, en positivo cuando se pueda, que describa algo que se ve en el texto; si un caso falla con una explicación que lo contradice, el problema es el criterio.

### 59. Los comentarios del conocimiento son para el equipo, no para el modelo
- **Problema:** las notas de `DECISIÓN PENDIENTE` dentro del conocimiento del cliente le llegaban al modelo, que podía repetirlas.
- **Solución:** la carga de la carpeta del cliente quita los comentarios HTML (`<!-- … -->`) antes de guardar el prompt y el conocimiento.
- **Cómo evitarlo:** las dudas abiertas sobre datos del cliente van en comentarios HTML; lo que sí debe saber el agente va en texto.

## Canales de Meta (2026-10-26)

### 60. El Markdown del modelo no lo entiende ningún canal
- **Problema:** el agente escribe `**negrita**`; en Telegram, Instagram y Messenger la persona vería los asteriscos tal cual, y WhatsApp usa un solo asterisco.
- **Solución:** `formatForChannel` adapta el texto del agente al canal antes de enviarlo, y el prompt le avisa por qué canal escribe.
- **Cómo evitarlo:** cada vez que se suma un canal, preguntarse qué formato, qué largo y qué datos del contacto (teléfono, nombre) trae realmente.

### 61. Una dirección de descarga que llega por un webhook es un dato de un tercero
- **Problema:** Messenger e Instagram mandan la URL del adjunto; bajar cualquier URL que llegue permite que alguien haga que el servidor pida direcciones internas (SSRF).
- **Solución:** solo se descarga de los servidores de archivos de Meta, por https, sin seguir redirecciones y con tope de tamaño; el resto se ignora sin romper el mensaje.
- **Cómo evitarlo:** toda URL que viene en un evento externo se valida contra una lista de dominios antes de hacer el pedido.

### 62. Un reintento no arregla algo que caduca
- **Problema:** si la descarga de un adjunto fallaba, el evento se reintentaba durante horas y mientras tanto el agente no contestaba.
- **Solución:** en los canales de Meta un adjunto que no se pudo bajar no frena nada: el mensaje se guarda, el agente lo ve sin adjunto y pide que lo reenvíen.
- **Cómo evitarlo:** antes de dejar que algo se reintente, preguntarse si en el próximo intento puede salir distinto.

### 63. Los avisos de estado llegan desordenados
- **Problema:** Meta puede mandar "sent" después de "delivered".
- **Solución:** el estado de un mensaje solo avanza (queued → sent → delivered → read); un fallo se guarda con su motivo.
- **Cómo evitarlo:** con avisos de un proveedor externo, definir el orden de los estados y aplicar solo los que avanzan.

### 64. Un disparador de auditoría no puede apuntar a lo que se está borrando
- **Problema:** las pruebas dejaban cientos de organizaciones de prueba sin borrar (179) y la base se fue poniendo lenta, hasta que pruebas que antes pasaban agotaban el tiempo. Borrar una organización con canales o integrantes de sector fallaba.
- **Causa real:** al borrar la organización en cascada, los disparadores de auditoría (ADR-035) registraban "canal borrado" con el id de una organización que ya no existía, y la clave foránea de `audit_log` lo rechazaba. La limpieza de las pruebas no avisaba del error.
- **Solución:** esos disparadores omiten el registro si la organización ya no existe (migración `20261026130000`), y se borraron las organizaciones de prueba acumuladas.
- **Cómo evitarlo:** todo disparador que escribe en otra tabla tiene que sobrevivir a un borrado en cascada; probar el borrado de una organización completa; y que la limpieza de las pruebas falle fuerte si no puede borrar.

### 65. Un envío en partes puede fallar a la mitad
- **Problema (revisión de seguridad independiente):** un texto largo sale en varios mensajes; si la segunda parte fallaba, todo se daba por fallido y el agente o un seguimiento reenviaban el texto completo: la persona recibía la primera parte dos veces.
- **Solución:** si ya salió una parte, el envío se da por hecho y queda anotado cuántas partes salieron (`messages.error = {partial, sent, total}`); solo si falla la primera es un error que se puede reintentar.
- **Cómo evitarlo:** cuando una operación tiene efectos externos en varios pasos, decidir qué pasa si se corta a la mitad antes de poner un reintento automático.

### 66. Un aviso de estado puede llegar antes que el dato al que se refiere
- **Problema:** Meta puede avisar "entregado" antes de que el envío termine de guardar el id del mensaje; el aviso no encontraba nada y se descartaba para siempre. Además, dos pasadas del trabajador podían pisarse el estado.
- **Solución:** un aviso de un mensaje que todavía no existe se deja pendiente unos minutos antes de descartarlo, y la actualización está condicionada al estado leído.
- **Cómo evitarlo:** con eventos externos asincrónicos, no suponer el orden de llegada y actualizar con condición (comparar y cambiar en una sola operación).

### 67. Leer "hasta el tope" no es leer todo y después comparar
- **Problema:** las descargas de adjuntos bajaban el cuerpo entero a memoria cuando la respuesta no declaraba su tamaño, y no tenían tiempo máximo.
- **Solución:** lectura por pedazos que corta al pasar el tope y `AbortSignal.timeout` en cada pedido; un índice único por mensaje evita registrar dos veces el mismo archivo.
- **Cómo evitarlo:** todo pedido a un servidor externo lleva tiempo máximo y tope de tamaño aplicados mientras se lee.
