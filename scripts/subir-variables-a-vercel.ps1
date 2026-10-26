# Sube a Vercel las variables de un archivo de entorno. Se ejecuta desde la carpeta del proyecto.
#
#   Producción (base de São Paulo):          .\scripts\subir-variables-a-vercel.ps1 -Archivo .env.produccion -Entorno production
#   Vistas previas (base de desarrollo):     .\scripts\subir-variables-a-vercel.ps1 -Archivo .env.local -Entorno preview
#
# Los valores van de tu archivo a Vercel por tu terminal; este script no los imprime.
param(
    [string]$Archivo = ".env.local",
    [ValidateSet("production", "preview", "production,preview")]
    [string]$Entorno = "production,preview"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Archivo)) {
    Write-Error "No encuentro $Archivo. Ejecutá este script desde la carpeta del proyecto."
}

$lineas = Get-Content $Archivo

function Get-Valor($nombre) {
    $linea = $lineas | Where-Object { $_ -like "$nombre=*" } | Select-Object -First 1
    if (-not $linea) { return $null }
    return ($linea -replace "^$nombre=", "").Trim()
}

$publicas = @("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
$secretas = @("SUPABASE_SERVICE_ROLE_KEY", "META_WEBHOOK_VERIFY_TOKEN", "META_APP_SECRET", "INSTAGRAM_APP_SECRET", "WORKER_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "ANTHROPIC_API_KEY", "WHATSAPP_ACCESS_TOKEN", "MESSENGER_ACCESS_TOKEN", "INSTAGRAM_ACCESS_TOKEN")

Write-Host "Archivo: $Archivo -> Vercel ($Entorno)"
foreach ($nombre in $publicas + $secretas) {
    $valor = Get-Valor $nombre
    if (-not $valor) {
        # Una variable vacía no frena a las demás: se avisa y se sigue.
        Write-Warning "$nombre está vacía en ${Archivo}: se omite."
        continue
    }

    $argumentos = @("vercel", "env", "add", $nombre, "--value", $valor, "--environment", $Entorno, "--force", "--yes")
    if ($secretas -contains $nombre) {
        $argumentos += "--sensitive"
    }

    Write-Host "Subiendo $nombre ..."
    & npx @argumentos | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Falló al subir $nombre."
    }
}

Write-Host ""
Write-Host "Listo. Variables en Vercel:"
& npx vercel env ls
