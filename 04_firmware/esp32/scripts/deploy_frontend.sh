#!/usr/bin/env bash
# Compila el simulador (../../Simulador) y copia dist/ a data/ (LittleFS de la ESP32).
# Ejecutar desde 04_firmware/esp32:   bash scripts/deploy_frontend.sh
set -euo pipefail
ESP32_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIM_DIR="$(cd "$ESP32_DIR/../../Simulador" && pwd)"
echo "Compilando el simulador en $SIM_DIR ..."
(cd "$SIM_DIR" && npm run build)
find "$ESP32_DIR/data" -mindepth 1 ! -name LEEME.txt -exec rm -rf {} +
cp -r "$SIM_DIR/dist/." "$ESP32_DIR/data/"
# Sin comprimir no cabe en la partición LittleFS; ESPAsyncWebServer sirve el .gz solo
find "$ESP32_DIR/data" -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' \) -exec gzip -9 {} \;
echo "Listo: $(find "$ESP32_DIR/data" -type f | wc -l) archivos en data/. Sube con:  pio run -t uploadfs"
