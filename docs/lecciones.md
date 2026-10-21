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
