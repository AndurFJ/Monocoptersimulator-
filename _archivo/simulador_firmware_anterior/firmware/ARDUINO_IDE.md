# Firmware en Arduino IDE

El firmware está **unificado** en un único archivo autocontenido:
`firmware/src/main.cpp` + `firmware/src/config.h`. Se compila con
**PlatformIO** (`pio run` en `firmware/`) sin pasos extra.

Si prefieres **Arduino IDE**, usa la MISMA fuente (no hay un `.ino` duplicado):

## Pasos

1. Crea una carpeta de sketch, p. ej. `monocoptero/monocoptero.ino`.
2. Copia el contenido de `firmware/src/main.cpp` → `monocoptero/monocoptero.ino`.
   (El `#include <Arduino.h>` del inicio es inocuo; Arduino lo ignora.)
3. Copia `firmware/src/config.h` → `monocoptero/config.h`.
   Edita SSID/password/pines si hace falta.
4. En Arduino IDE:
   - Placa: **ESP32 Dev Module**
   - Partition Scheme: **Default 4MB with spiffs** (o LittleFS)
5. Instala las librerías desde el Gestor de librerías:
   - `ESPAsyncWebServer` (autor "ESP32Async")
   - `AsyncTCP` (autor "ESP32Async")
   - `ArduinoJson` (Benoit Blanchon, v7+)
   - `ESP32Servo`
6. Compila y sube el `.ino`.

## Subir la SPA (interfaz web) a LittleFS

1. Desde la raíz del repo: `.\firmware\scripts\deploy_frontend.ps1`
   (genera `dist/` y lo copia a `firmware/data/`).
2. En Arduino IDE instala el plugin **ESP32 LittleFS Data Upload** y apunta
   a la carpeta `firmware/data/` (copiada junto a tu sketch).
   O usa PlatformIO: `pio run --target uploadfs`.

## Notas

- El código es **idéntico** en PlatformIO y Arduino IDE; solo cambia el
  nombre del archivo (`main.cpp` → `.ino`) y dónde se busca `config.h`.
- `config.h` contiene credenciales reales y está en `.gitignore`.
- Para probar **sin banco físico**, descomenta `#define UART_MOCK_MODE`
  en `config.h` (la ESP32 simula la planta FOPDT y envía telemetría).
