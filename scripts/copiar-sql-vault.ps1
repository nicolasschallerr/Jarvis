# Copia al portapapeles el SQL que guarda tu WORKER_SECRET real en Supabase Vault.
# Se ejecuta desde la carpeta jarvis:  .\scripts\copiar-sql-vault.ps1
# El valor va de tu .env.local al portapapeles y de ahí al editor SQL con tu Ctrl+V:
# no se imprime en pantalla ni pasa por ningún otro lado.

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env.local")) {
    Write-Error "No encuentro .env.local. Ejecutá este script desde la carpeta jarvis."
}

$linea = Get-Content ".env.local" | Where-Object { $_ -like "WORKER_SECRET=*" } | Select-Object -First 1
$valor = if ($linea) { ($linea -replace "^WORKER_SECRET=", "").Trim() } else { "" }

if (-not $valor) {
    Write-Error "WORKER_SECRET está vacío en .env.local."
}

if ($valor -notmatch "^[A-Za-z0-9_-]+$") {
    Write-Error "WORKER_SECRET tiene caracteres inesperados; revisá el archivo."
}

$sql = "select vault.update_secret((select id from vault.secrets where name = 'jarvis_worker_secret'), '$valor');"
Set-Clipboard -Value $sql

Write-Host "Listo: el SQL ya está en tu portapapeles ($($valor.Length) caracteres de secreto)."
Write-Host "Pegalo en el Editor SQL de Supabase (Ctrl+V), reemplazando todo lo que haya, y ejecutalo."
