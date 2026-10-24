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
- **Se repitió** (Fase 7) al agregar un texto con `
` a un archivo desde un script: el compilador lo marcó al instante y se corrigió con la herramienta de edición. La regla vale tal cual: texto con barras invertidas, siempre con la herramienta de edición.

### 41. Un dato obligatorio nuevo en la plantilla rompe las pruebas que derivan sin datos
- **Problema:** al definir `campos` en la plantilla, cuatro pruebas pasaron a fallar: derivaban sin datos y ahora el guardián lo bloquea, y otra quitaba una unidad a la que un campo apuntaba.
- **Causa real:** las pruebas usaban la plantilla como ejemplo mínimo y asumían que derivar siempre funciona.
- **Solución:** las pruebas que derivan por un tema sensible declaran la excepción (`datos_incompletos_ok`) y la que quita una unidad quita también sus campos. El esquema rechazando el campo huérfano es el comportamiento buscado.
- **Cómo evitarlo:** al sumar una regla de validación, correr la suite completa enseguida: las fallas muestran qué suponía cada prueba.
