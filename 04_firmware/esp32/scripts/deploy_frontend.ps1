<#
  Compila el simulador (../../Simulador) y copia dist/ a data/ (LittleFS de la ESP32).
  Ejecutar desde 04_firmware/esp32:   .\scripts\deploy_frontend.ps1
#>
$ErrorActionPreference = "Stop"
$Esp32Dir     = Split-Path -Parent $PSScriptRoot
$SimuladorDir = Join-Path $Esp32Dir "..\..\Simulador" | Resolve-Path
$DataDir      = Join-Path $Esp32Dir "data"

Write-Host "Compilando el simulador en $SimuladorDir ..." -ForegroundColor Cyan
Push-Location $SimuladorDir
$prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
npm run build 2>&1 | Out-Host
$code = $LASTEXITCODE
$ErrorActionPreference = $prev
Pop-Location
if ($code -ne 0) { throw "npm run build falló (código $code)" }

Get-ChildItem $DataDir -Exclude "LEEME.txt" | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $SimuladorDir "dist\*") -Destination $DataDir -Recurse -Force

# Comprimir JS/CSS/SVG con gzip: sin comprimir (~1.4 MB) no caben en la partición
# LittleFS de 1.4 MB. ESPAsyncWebServer sirve "archivo.gz" cuando se pide "archivo".
Get-ChildItem $DataDir -Recurse -File -Include *.js, *.css, *.svg | ForEach-Object {
    $src = [System.IO.File]::OpenRead($_.FullName)
    $dst = [System.IO.File]::Create("$($_.FullName).gz")
    $gz  = New-Object System.IO.Compression.GZipStream($dst, [System.IO.Compression.CompressionLevel]::Optimal)
    $src.CopyTo($gz); $gz.Dispose(); $dst.Dispose(); $src.Dispose()
    Remove-Item $_.FullName
}
$files = Get-ChildItem $DataDir -Recurse -File
$kb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1024)
Write-Host "Listo: $($files.Count) archivos ($kb KB) en data/. Sube con:  pio run -t uploadfs" -ForegroundColor Green
