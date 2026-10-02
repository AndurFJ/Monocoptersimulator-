#!/usr/bin/env bash
# deploy_frontend.sh — compila la SPA y la prepara para LittleFS.
#
#   1. npm run build            (genera dist/ del simulador)
#   2. Copia dist/ a firmware/data/ (LittleFS)
#   3. Instruye cómo subir LittleFS + firmware con PlatformIO
#
# Uso (desde la raíz del repo):
#   bash firmware/scripts/deploy_frontend.sh
set -e

SIMULATOR_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
FW_DATA_DIR="$SIMULATOR_DIR/firmware/data"

echo "▶ Build del simulador..."
cd "$SIMULATOR_DIR"
npm run build
cd - > /dev/null

echo "▶ Copiando dist/ a LittleFS (firmware/data)..."
rm -rf "$FW_DATA_DIR"
mkdir -p "$FW_DATA_DIR"
cp -r "$SIMULATOR_DIR/dist/." "$FW_DATA_DIR/"

KB=$(du -sk "$FW_DATA_DIR" | cut -f1)
echo "✅ SPA copiada ($KB KB)."

echo ""
echo "Siguiente paso (PlatformIO):"
echo "  pio run --target uploadfs   # sube LittleFS"
echo "  pio run --target upload     # sube el firmware"
echo "  pio device monitor          # monitor serial"
echo ""
echo "En Arduino IDE, ver firmware/ARDUINO_IDE.md."
echo "Accede en http://monocoptero.local"
