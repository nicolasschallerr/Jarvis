# Sube a Vercel las variables de Supabase que están en .env.local.
# Se ejecuta desde la carpeta jarvis:  .\scripts\subir-variables-a-vercel.ps1
# Los valores van de tu archivo a Vercel por tu terminal; este script no los imprime.

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env.local")) {
    Write-Error "No encuentro .env.local. Ejecutá este script desde la carpeta jarvis."
}

$lineas = Get-Content ".env.local"

function Get-Valor($nombre) {
    $linea = $lineas | Where-Object { $_ -like "$nombre=*" } | Select-Object -First 1
    if (-not $linea) { return $null }
    return ($linea -replace "^$nombre=", "").Trim()
}

$publicas = @("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "JARVIS_ECHO_MODE")
$secretas = @("SUPABASE_SERVICE_ROLE_KEY", "META_WEBHOOK_VERIFY_TOKEN", "META_APP_SECRET", "WORKER_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET")

foreach ($nombre in $publicas + $secretas) {
    $valor = Get-Valor $nombre
    if (-not $valor) {
        # Una variable vacía no frena a las demás: se avisa y se sigue.
        Write-Warning "$nombre está vacía en .env.local: se omite."
        continue
    }

    $argumentos = @("vercel", "env", "add", $nombre, "--value", $valor, "--environment", "production,preview", "--force", "--yes")
    if ($secretas -contains $nombre) {
        $argumentos += "--sensitive"
    }

    Write-Host "Subiendo $nombre ..."
    & npx @argumentos | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Falló al subir $nombre. Probá repetirlo con solo production."
    }
}

Write-Host ""
Write-Host "Listo. Variables en Vercel:"
& npx vercel env ls
