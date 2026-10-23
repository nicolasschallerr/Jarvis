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
