# Este directorio contiene la SPA compilada (dist/) que la ESP32
# sirve por HTTP desde LittleFS (ver setupWebServer).
#
# Se regenera con:
#   bash firmware/scripts/deploy_frontend.sh   (Linux/macOS/Git-Bash)
#   .\firmware\scripts\deploy_frontend.ps1     (PowerShell)
#
# Estructura esperada después de copiar:
#   data/
#   ├── index.html
#   └── assets/
