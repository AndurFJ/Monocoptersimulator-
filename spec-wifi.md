# SPEC — Sistema de acceso WiFi multi-dispositivo para el Simulador 3D del Monocóptero

> **Este documento amplía `spec.md` (simulador 3D base) con la capa de red WiFi+ESP32.**
> El simulador 3D descrito en `spec.md` NO se modifica. Todo el trabajo nuevo es:
> (a) firmware de la ESP32 que hace de servidor WiFi + puente serial, y
> (b) adaptaciones mínimas del front-end existente para conectarse al WebSocket de la ESP32
>     en lugar de hacerlo directamente al puerto serial del PC.
>
> Leer `spec.md` y `AGENTS.md` del simulador base antes de trabajar en este repo.

---

## 1. Objetivo en una sola oración

Hacer que **cualquier dispositivo en la misma red WiFi** (teléfono, tablet, segunda PC) pueda abrir
el simulador 3D del monocóptero en su navegador, ver los mismos datos en tiempo real, y controlar
los mismos parámetros, sin instalar ninguna aplicación y sin cables.

---

## 2. Qué cambia y qué NO cambia

| Capa | Estado | Descripción |
|------|--------|-------------|
| Simulador 3D (Three.js, panel, gráficas) | **Sin cambios** | El front-end que ya existe sigue siendo idéntico |
| `SerialSource.ts` (Web Serial API) | **Bidireccional** | Se conecta por USB al puerto de la ESP32; ahora envía comandos JSON y recibe eco de estado (mismo protocolo que WiFi) |
| `SimulationSource.ts` (PID interno) | **Sin cambios** | El modo simulación corre en el cliente, igual que antes |
| `ReplaySource.ts` (Excel/CSV) | **Sin cambios** | El modo reproducción lee el archivo local, igual que antes |
| Build del front-end | **Se empaqueta** | El `dist/` compilado del simulador se sube a la flash de la ESP32 vía LittleFS |
| **ESP32** | **Firmware unificado** | Un único `firmware/src/main.cpp` (PlatformIO o Arduino IDE) hace de servidor HTTP + WebSocket + puente USB, y es el árbitro del estado |

### Principio rector
El front-end no debe saber si los datos vienen del COM del PC o de la ESP32. Solo cambia
**el canal** (WebSocket `ws://monocoptero.local/ws` o puerto USB) cuando el modo activo es
"WiFi/ESP32 en vivo" o "Serial en vivo". Todo lo demás es idéntico.

### Sincronización dual-canal (ningún cliente queda ciego)
La ESP32 aplica cada comando y retransmite el estado (`{"type":"status",...}` con setpoint,
Kp/Ki/Kd, modo, PWM, failsafe) **por ambos canales**: WebSocket a todos los clientes WiFi y
eco JSON por USB (configurable con `SERIAL_STATUS_JSON`). Así, cambiar un parámetro desde el
teléfono (WiFi) se refleja en tiempo real en el PC (USB) y viceversa. El USB además conserva
los atajos del monitor serie (`1` escalón, `2` PID, `0` stop, `h` ayuda).

---

## 3. Arquitectura del sistema completo

```
┌─────────────────── Red WiFi local ──────────────────────────┐
│                                                               │
│  ┌──────────────┐   WebSocket (ws://monocoptero.local/ws)   │
│  │  PC / Laptop │◄──────────────────────────────────────┐   │
│  │  navegador   │   HTTP  (http://monocoptero.local)     │   │
│  │  Simulador   │◄──────────────────────────────────────┘   │
│  └──────────────┘                                            │
│                              ┌──────────────────────────┐   │
│  ┌──────────────┐  WS + HTTP │   ESP32                  │   │
│  │  Teléfono /  │◄───────────│   · WiFi STA o AP        │   │
│  │  Tablet      │            │   · ESPAsyncWebServer     │   │
│  │  navegador   │            │   · AsyncWebSocket        │   │
│  │  Simulador   │            │   · LittleFS (dist/ SPA)  │   │
│  └──────────────┘            │   · UART ↔ WS bridge      │   │
│                              └──────────┬─────────────┘   │
│  ┌──────────────┐                       │ UART/Serial      │
│  │  Tablet 2    │◄──WS + HTTP───┘       │ 115200 baud      │
│  └──────────────┘                       ▼                  │
└──────────────────────────────────── ┌─────────────┐ ───────┘
                                       │  Firmware   │
                                       │  del banco  │
                                       │  (Arduino / │
                                       │  sensor     │
                                       │  HC-SR04    │
                                       │  ESC + PID) │
                                       └─────────────┘
```

### 3.1 Modos de red WiFi de la ESP32 (configurables en `firmware/config.h`)

**Modo A — Station (STA): la ESP32 se une a tu router WiFi existente** *(recomendado para uso en laboratorio)*

```
Router WiFi ──── ESP32 (STA) ──── misma red que PC, teléfono, etc.
URL de acceso: http://monocoptero.local  (o la IP que asigne el DHCP)
```

Ventaja: todos los dispositivos (PC y teléfono) están en la misma red sin cambiar de WiFi.
Desventaja: requiere que el router esté disponible.

**Modo B — Access Point (AP): la ESP32 crea su propia red WiFi**

```
ESP32 crea red "Monocoptero-Lab" ──── dispositivos se conectan a esa red
URL de acceso: http://192.168.4.1  (IP fija del AP de la ESP32)
```

Ventaja: funciona sin router, en campo abierto, totalmente autónomo.
Desventaja: el teléfono pierde acceso a internet mientras está conectado a la ESP32.

**Modo C — AP+STA simultáneo** *(para configuración inicial o escenario mixto)*

La ESP32 se une al router Y crea su propio AP al mismo tiempo. Útil cuando algunos clientes no
tienen acceso al router. Advertencia conocida: si el canal del router y el AP de la ESP32 difieren,
el AP cambia de canal transitoriamente al conectar el STA — los clientes del AP pueden desconectarse
brevemente. Para uso estable en laboratorio, preferir Modo A.

> El modo se selecciona compilando con una constante en `firmware/config.h` — no hay lógica
> en tiempo de ejecución para cambiar el modo (eso añade complejidad innecesaria para un laboratorio).

---

## 4. Stack tecnológico (firmware ESP32)

| Componente | Elección | Razón |
|-----------|----------|-------|
| Framework | **Arduino-ESP32** (framework Arduino de Espressif vía PlatformIO) | Ecosistema más maduro, máxima compatibilidad con las bibliotecas elegidas; PlatformIO gestiona dependencias con reproducibilidad |
| Build system | **PlatformIO** | Gestión de dependencias declarativa en `platformio.ini`; evita el infierno de versiones de Arduino IDE |
| Servidor HTTP+WS | **ESPAsyncWebServer** (fork ESP32Async, el más activo en 2026) + **AsyncTCP** | Asíncrono: maneja múltiples clientes simultáneos sin bloquear la tarea principal; soporte nativo de WebSocket con broadcast `ws.textAll()` |
| Sistema de archivos | **LittleFS** | SPIFFS está deprecado en el Arduino core 2.x; LittleFS tiene mejor fiabilidad ante pérdidas de energía y soporta subdirectorios |
| Serialización de mensajes | **JSON compacto** (ArduinoJson v7) | Igual formato que ya usa el front-end del simulador; fácil de depurar con cualquier cliente WS; overhead mínimo a 50 Hz con mensajes pequeños |
| mDNS | **ESPmDNS** (incluida en arduino-esp32) | Acceso por nombre `monocoptero.local` desde cualquier SO moderno sin buscar la IP. Nota: Android requiere Android 12+ o app Bonjour Browser para `.local`; documentar esto |
| OTA | **ArduinoOTA** (opcional, Fase 5) | Actualizar firmware sin conectar cable USB al ESP32; muy útil en el banco |
| UART (puente serial) | `HardwareSerial` nativo (`Serial2`, pines GPIO configurables) | Leer la trama del firmware del banco (HC-SR04, ESC) y reenviar a todos los clientes WebSocket |

---

## 5. Protocolo de comunicación (WebSocket)

Un único endpoint `/ws` bidireccional. Todos los mensajes son JSON compacto UTF-8.

### 5.1 Mensajes del ESP32 → todos los clientes (broadcast)

**Trama de telemetría** (se envía cada vez que llega una línea del UART, o a 50 Hz en modo autónomo):

```json
{
  "type": "telemetry",
  "t": 12.345,
  "height": 0.342,
  "pwm": 1580,
  "raw": "12.345,0.342,1580"
}
```

Campos:
- `type`: siempre `"telemetry"` — permite añadir otros tipos de mensaje en el futuro sin romper nada.
- `t`: tiempo relativo en segundos desde el arranque del ensayo.
- `height`: altura en metros (ya convertida por el firmware del banco, o en `raw` para que el front haga la conversión).
- `pwm`: valor de PWM en la convención del hardware (µs o 0-255; **a confirmar con el usuario**).
- `raw`: línea original del UART, para depuración o si el front-end prefiere parsear él mismo.

**Mensaje de estado de conexión** (se envía cuando un cliente se une, o cuando el UART se conecta/desconecta):

```json
{
  "type": "status",
  "uart_connected": true,
  "clients": 3,
  "uptime_s": 245,
  "wifi_mode": "STA",
  "ip": "192.168.1.47"
}
```

### 5.2 Mensajes cliente → ESP32 (comandos de control)

El ESP32 reenvía estos comandos al UART del firmware del banco:

```json
{ "type": "cmd", "action": "set_setpoint", "value": 0.5 }
{ "type": "cmd", "action": "set_pwm",      "value": 1600 }
{ "type": "cmd", "action": "set_pid",      "kp": 1.2, "ki": 0.3, "kd": 0.05 }
{ "type": "cmd", "action": "start" }
{ "type": "cmd", "action": "stop" }
```

**Regla de arbitraje multi-cliente:** cuando hay más de un cliente conectado, cualquier cliente puede
enviar comandos. El ESP32 aplica el comando y hace broadcast del nuevo estado a todos. No hay un
"cliente maestro" — todos tienen los mismos permisos. Si esto causa conflictos en el laboratorio,
el usuario puede habilitar un modo "solo lectura para clientes adicionales" (ver `firmware/config.h`,
constante `ALLOW_MULTI_CONTROL`, por defecto `1`).

### 5.3 ¿Por qué no MQTT o HTTP polling?

- **HTTP polling** a 50 Hz genera 50 requests/s por cliente → overhead de headers HTTP en cada uno →
  inaceptable para telemetría en tiempo real.
- **MQTT** requiere un broker externo (Mosquitto en el PC u online) → dependencia externa, complejidad,
  fallo si el broker cae. Para una red local sin internet, WebSocket directo en la ESP32 es más simple
  y más robusto.
- **WebSocket** es una conexión TCP persistente. Una vez establecida, el overhead por mensaje es
  mínimo (2-10 bytes de header WS vs. ~500 bytes de header HTTP). La ESP32 mantiene la conexión
  con cada cliente y hace broadcast eficiente con `ws.textAll()`.

---

## 6. Adaptación del front-end (cambios mínimos)

El simulador existente tiene una `SerialSource` que usa Web Serial API. En la versión WiFi, se añade
una nueva fuente `WifiSource` que es funcionalmente idéntica pero conecta vía WebSocket:

```ts
// src/data/WifiSource.ts — NUEVO
export class WifiSource implements DataSource {
  readonly mode = 'wifi-live';
  private ws: WebSocket | null = null;
  private cb?: (s: TelemetrySample) => void;

  constructor(private url: string = 'ws://monocoptero.local/ws') {}

  start() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'telemetry' && this.cb) {
        this.cb({ t: msg.t, height: msg.height, pwm: msg.pwm });
      }
    };
    this.ws.onclose = () => { /* emitir evento de desconexión al HUD */ };
  }

  stop() { this.ws?.close(); }
  onSample(cb: (s: TelemetrySample) => void) { this.cb = cb; }

  sendCommand(cmd: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    }
  }
}
```

Cambios adicionales en el front-end:
1. Añadir `"WiFi/ESP32 en vivo"` como cuarta opción en el selector de modo (junto a Simulación,
   Excel, Serial).
2. Cuando se selecciona ese modo, el `ParamsPanel` muestra un campo de URL del WebSocket
   (pre-relleno con `ws://monocoptero.local/ws`, editable para IPs alternativas).
3. El indicador de conexión del HUD (ya existente en `spec.md §8`) muestra el estado del WebSocket:
   Conectando / Conectado (verde, IP, nº de clientes) / Desconectado (rojo).
4. Los sliders/inputs del panel de parámetros (setpoint, PID, PWM) envían comandos via
   `WifiSource.sendCommand()` cuando el modo activo es WiFi.

**Sin más cambios al simulador.** El modelo 3D, las gráficas y el HUD reciben `TelemetrySample`
exactamente igual que antes — no saben si vienen de la simulación local o de la ESP32.

---

## 7. Layout adaptado para móvil

El simulador existente fue diseñado para monitor de laboratorio. Para el teléfono, la misma SPA
debe reorganizarse automáticamente:

```
Pantalla de escritorio (> 900 px):        Pantalla móvil (< 900 px):
┌─────────────┬──────────┐               ┌──────────────────┐
│   3D (60%)  │ Params   │               │  Params + HUD    │
│             │──────────│               │  (colapsable)    │
│             │ Gráficas │               ├──────────────────┤
└─────────────┴──────────┘               │  3D viewer       │
                                          │  (touch orbit)   │
                                          ├──────────────────┤
                                          │  Gráficas        │
                                          │  (scroll)        │
                                          └──────────────────┘
```

Reglas específicas para móvil (CSS + JS):
- El canvas 3D ocupa el **100% del ancho** y ≈ 45% del alto de la ventana en portrait.
- `OrbitControls` de Three.js soporta touch nativo (pinch-zoom, un dedo = rotar) — habilitado por
  defecto, no requiere código adicional.
- El panel de parámetros es **colapsable** (acordeón) para no ocupar espacio cuando no se usa.
- Los sliders tienen `min-height: 44px` (guía de Apple/Google para targets táctiles).
- Las gráficas de uPlot son scroll-horizontal para ver historia en pantalla estrecha.
- **No se sirven dos SPAs distintas** — es la misma `index.html` con CSS responsive. El simulador
  ya tiene el layout CSS correcto si se sigue el breakpoint de `spec.md §3.2`.

---

## 8. Estructura del nuevo repo / submódulo

```
monocoptero-wifi/               ← nuevo proyecto (al lado de monocoptero-3d-sim/)
├── AGENTS.md                   ← este archivo (reglas para agentes en este repo)
├── spec.md                     ← este documento
├── firmware/                   ← código de la ESP32
│   ├── platformio.ini
│   ├── config.h                ← SSID, password, modo WiFi, pines UART, baudios
│   ├── src/
│   │   ├── main.cpp
│   │   ├── wifi_manager.cpp/h
│   │   ├── ws_server.cpp/h
│   │   ├── uart_bridge.cpp/h
│   │   └── fs_manager.cpp/h    ← LittleFS: servir la SPA
│   └── data/                   ← carpeta donde va el dist/ del simulador
│       └── (vacía hasta correr el script de deploy)
├── scripts/
│   └── deploy_frontend.sh      ← copia el dist/ del simulador a firmware/data/ y sube LittleFS
└── docs/
    ├── wiring.md               ← diagrama de conexión ESP32 ↔ firmware del banco
    └── android-mdns.md         ← instrucciones para acceso .local en Android
```

### `platformio.ini` mínimo

```ini
[env:esp32dev]
platform  = espressif32
board     = esp32dev
framework = arduino

lib_deps =
  ESP32Async/ESPAsyncWebServer @ ^3.7.0
  ESP32Async/AsyncTCP          @ ^3.3.0
  bblanchon/ArduinoJson        @ ^7.0.0
  ; LittleFS y ESPmDNS vienen incluidas en el core arduino-esp32

board_build.filesystem = littlefs
upload_port = /dev/ttyUSB0   ; cambiar según el sistema operativo
monitor_speed = 115200
```

### `config.h` — todos los parámetros en un solo lugar

```cpp
// ── Modo WiFi ──────────────────────────────────────────────────
#define WIFI_MODE_STA      // Comentar esta línea y descomentar AP para modo Access Point
//#define WIFI_MODE_AP

// Credenciales STA (modo Station — se une a tu router)
#define WIFI_STA_SSID     "NombreDeTuRed"
#define WIFI_STA_PASS     "TuContraseña"

// Credenciales AP (modo Access Point — ESP32 crea su propia red)
#define WIFI_AP_SSID      "Monocoptero-Lab"
#define WIFI_AP_PASS      "monocoptero2026"   // mínimo 8 caracteres para WPA2
#define WIFI_AP_CHANNEL   6                   // elegir canal fijo para estabilidad

// ── mDNS ────────────────────────────────────────────────────────
#define MDNS_HOSTNAME     "monocoptero"       // acceso: http://monocoptero.local

// ── UART (puente serial → firmware del banco) ───────────────────
#define UART_NUM          2                   // Serial2 del ESP32
#define UART_RX_PIN       16                  // GPIO RX — a confirmar según tu cableado
#define UART_TX_PIN       17                  // GPIO TX — a confirmar según tu cableado
#define UART_BAUD         115200              // debe coincidir con el firmware del banco

// ── Control multi-cliente ───────────────────────────────────────
#define ALLOW_MULTI_CONTROL  1                // 1 = todos controlan · 0 = solo el primer cliente

// ── WebSocket ───────────────────────────────────────────────────
#define WS_CLEANUP_INTERVAL_MS  1000          // limpiar clientes desconectados cada 1 s
#define WS_MAX_CLIENTS          8             // límite de clientes simultáneos
```

---

## 9. Flujo de datos completo (modo WiFi/ESP32 en vivo)

```
Sensor HC-SR04
      │ (distancia)
      ▼
Firmware del banco (Arduino/otro MCU)
      │ Serial UART 115200 baud
      │ Formato: "t,height,pwm\n"  ← confirmar con el usuario
      ▼
ESP32 Serial2 (RX, GPIO 16)
      │ ISR / tarea FreeRTOS lee la línea
      ▼
uart_bridge.cpp: parsear + construir JSON
      │
      ▼
AsyncWebSocket::textAll(json)   ← broadcast a TODOS los clientes WS conectados
      │
  ┌───┴────────────────────────────┐
  ▼                                ▼
Cliente 1 (PC, Chrome)      Cliente 2 (Teléfono, Safari)
  │                                │
  ▼                                ▼
WifiSource.onSample()       WifiSource.onSample()
  │                                │
  ▼                                ▼
EventBus → SceneManager     EventBus → SceneManager
           ChartsPanel                 ChartsPanel
           HUD                         HUD
(render 3D local)           (render 3D local)
```

Cada dispositivo renderiza su propio modelo 3D localmente — la ESP32 **no transmite gráficos**,
solo datos. Esto garantiza 60 FPS en el render independientemente de cuántos clientes haya.

---

## 10. Rendimiento y limitaciones de la ESP32

La ESP32 es un microcontrolador, no un servidor web de producción. Estas son las limitaciones reales
a tener en cuenta:

| Recurso | Valor real | Implicación para este proyecto |
|---------|-----------|-------------------------------|
| RAM total | 520 KB (SRAM) | El heap disponible para las tareas es ~200–300 KB; los buffers WS no deben ser grandes |
| Flash | 4 MB típico en dev boards | LittleFS partition ≈ 1.5 MB; el `dist/` del simulador compilado debe caber (ver §11) |
| CPU | Dual-core 240 MHz | Core 0: WiFi/networking stack; Core 1: `loop()` de Arduino + lógica del usuario; no bloquear `loop()` |
| Clientes WS simultáneos | Probado hasta 8 con ESPAsyncWebServer | Suficiente para un laboratorio; más clientes = más RAM consumida por sockets |
| Throughput serial | 115200 baud ≈ 11.5 KB/s | A 50 Hz y ~30 bytes/trama → ≈ 1.5 KB/s, muy por debajo del límite |
| Broadcast WS a 50 Hz | Factible hasta ≈ 5-6 clientes | A mayor número de clientes, aumentar el intervalo de envío o agrupar muestras |

**Acción sobre el tamaño del `dist/`:** el simulador usa Three.js (~600 KB gzip) y uPlot (~45 KB).
Con gzip habilitado en ESPAsyncWebServer, el total puede rondar 200-400 KB en flash — confirmar
con `du -sh firmware/data/` después del build. Si excede el espacio disponible, opciones:
1. Servir Three.js desde CDN (requiere internet en el cliente — no válido en modo AP).
2. Ajustar la partición LittleFS en el `partition.csv` de PlatformIO.
3. Usar una ESP32 con 8 MB de flash (ESP32-S3, etc.).

---

## 11. Script de despliegue

El único paso "no obvio" del workflow es copiar el `dist/` del simulador a la flash de la ESP32.
El script `scripts/deploy_frontend.sh` lo automatiza:

```bash
#!/usr/bin/env bash
set -e

SIMULATOR_DIR="../monocoptero-3d-sim"
FIRMWARE_DATA_DIR="firmware/data"

echo "▶ Build del simulador..."
cd "$SIMULATOR_DIR"
npm run build
cd -

echo "▶ Copiando dist/ al filesystem de la ESP32..."
rm -rf "$FIRMWARE_DATA_DIR"/*
cp -r "$SIMULATOR_DIR/dist/"* "$FIRMWARE_DATA_DIR/"

echo "▶ Subiendo LittleFS a la ESP32..."
pio run --target uploadfs

echo "✅ Frontend desplegado. Accede en http://monocoptero.local"
```

Para el firmware del ESP32 en sí:
```bash
pio run --target upload    # sube el firmware
pio device monitor         # monitor serial para depuración
```

---

## 12. Plan de fases

| Fase | Entregable | Criterio de aceptación |
|------|-----------|--------------------------|
| 0 | Setup PlatformIO, `config.h`, `platformio.ini` | `pio run` compila sin errores |
| 1 | ESP32 en modo STA, sirve `index.html` estático desde LittleFS | Desde el teléfono, `http://monocoptero.local` carga el simulador |
| 2 | WebSocket `/ws` activo: el servidor hace echo de mensajes de prueba | Desde el PC, `wscat -c ws://monocoptero.local/ws` recibe mensajes a 1 Hz |
| 3 | Puente UART→WS: las tramas del firmware del banco llegan a todos los clientes | Con el banco conectado, tanto el PC como el teléfono ven los mismos datos en sus gráficas |
| 4 | Comandos WS→UART: sliders del simulador controlan el banco en tiempo real desde el teléfono | Mover el slider de altura en el teléfono mueve el carro físico |
| 5 | CSS responsive: layout de móvil funciona en portrait en un teléfono Android e iOS | Panel colapsable, 3D interactivo con touch, gráficas scrollables |
| 6 (opcional) | ArduinoOTA: actualizar firmware de la ESP32 sin cable USB | `pio run --target upload --upload-port monocoptero.local` funciona vía WiFi |

---

## 13. Preguntas abiertas (a confirmar con el usuario antes de Fase 3)

1. **Formato exacto de la trama UART** que envía el firmware del banco: ¿`"t,height,pwm\n"`? ¿CSV? ¿JSON ya? ¿Qué separador?
2. **Pines GPIO de la ESP32** disponibles para UART_RX y UART_TX (no deben estar ocupados por el ESC u otros periféricos).
3. **Modelo exacto de ESP32** (ESP32-WROOM-32, ESP32-S3, etc.) — importante para la partición de flash.
4. **Red WiFi del laboratorio**: ¿hay router disponible? ¿SSID y contraseña? → decide si usar Modo A o Modo B.
5. **Convención de PWM** (µs 1000-2000 vs 0-255) — ya pendiente de `spec.md §12` y sigue sin confirmar.
6. **¿El teléfono objetivo es Android o iOS?** — mDNS `.local` funciona en iOS/macOS sin configuración; en Android < 12 puede requerir un paso adicional documentado en `docs/android-mdns.md`.

---

## 14. Criterios de aceptación global

- Desde el teléfono conectado a la misma WiFi, `http://monocoptero.local` carga el simulador sin instalar ninguna app.
- El modelo 3D, el HUD y las gráficas en el teléfono muestran los mismos datos que en el PC, con latencia < 200 ms extremo a extremo (sensor → UART → ESP32 → WS → cliente → render).
- Mover el slider de altura en el teléfono envía el comando al banco físico.
- Si un segundo dispositivo se conecta mientras el primero ya está usando el simulador, ambos ven los mismos datos sin que el primero se desconecte.
- El simulador 3D en el repositorio original no tiene ningún cambio de código — solo se añade `WifiSource.ts` y una entrada en el selector de modo.
