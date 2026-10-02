<#
.SYNOPSIS
  Despliega el simulador 3D a la flash de la ESP32 vía LittleFS.

.DESCRIPTION
  1. Ejecuta "npm run build" en el directorio del simulador
  2. Copia el contenido de dist/ a firmware/data/ (LittleFS)
  3. Muestra instrucciones para subir a la ESP32

.NOTES
  Ejecutar desde la raíz del proyecto del simulador:
    .\firmware\scripts\deploy_frontend.ps1
#>

$ErrorActionPreference = "Stop"

$SimulatorDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$FwDataDir    = Join-Path $SimulatorDir "firmware\data"

Write-Host "▶ Compilando el simulador..." -ForegroundColor Cyan
Push-Location $SimulatorDir
# Vite emite su aviso de chunk-size por stderr: no debe abortar el deploy.
$PrevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
npm run build 2>&1 | Out-Host
$buildCode = $LASTEXITCODE
$ErrorActionPreference = $PrevPref
if ($buildCode -ne 0) { throw "npm run build falló (código $buildCode)" }
Pop-Location

Write-Host "▶ Limpiando data/ (LittleFS)..." -ForegroundColor Cyan
if (Test-Path $FwDataDir) {
    Get-ChildItem $FwDataDir -Exclude "README.txt" | Remove-Item -Recurse -Force
} else {
    New-Item -ItemType Directory -Path $FwDataDir | Out-Null
}

Write-Host "▶ Copiando dist/ a firmware/data/..." -ForegroundColor Cyan
$DistDir = Join-Path $SimulatorDir "dist"
Copy-Item -Path "$DistDir\*" -Destination $FwDataDir -Recurse -Force

$fileCount = (Get-ChildItem $FwDataDir -Recurse -File).Count
$totalSize = (Get-ChildItem $FwDataDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
$totalKB   = [math]::Round($totalSize / 1024, 1)

Write-Host ""
Write-Host "✅ $fileCount archivos copiados ($totalKB KB)" -ForegroundColor Green
Write-Host ""
Write-Host "Siguiente paso (PlatformIO):" -ForegroundColor Yellow
Write-Host "  pio run --target uploadfs   # sube LittleFS"
Write-Host "  pio run --target upload     # sube el firmware"
Write-Host "  pio device monitor          # monitor serial"
Write-Host ""
Write-Host "En Arduino IDE, ver firmware/ARDUINO_IDE.md."
