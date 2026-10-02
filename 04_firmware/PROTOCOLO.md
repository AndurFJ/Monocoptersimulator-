# Firmware del Monocóptero — guía rápida y protocolo

Hay dos firmwares con **el mismo comportamiento** (mismo filtro del sensor, mismo PID,
mismos comandos). Usa el que corresponda a tu placa:

| Carpeta | Placa | Para qué |
|---|---|---|
| `arduino_uno/monocoptero_uno/` | Arduino Uno | Banco por USB (simulador en modo **Serial**) |
| `esp32/monocoptero_esp32/` | ESP32 Dev Module | USB **y** WiFi: sirve el simulador en `http://monocoptero.local` |
| `ensayo_escalon_original/` | Arduino Uno | Sketch con el que se tomaron los datos del 13/09 (solo referencia) |

## Conexiones

| Señal | Arduino Uno | ESP32 |
|---|---|---|
| ESC (señal PWM) | D9 | GPIO27 |
| HC-SR04 TRIG | D7 | GPIO12 (si la placa no arranca, usa GPIO26 y cambia `config.h`) |
| HC-SR04 ECHO | D6 | GPIO14 **con divisor 1 kΩ / 2 kΩ** (ECHO sale a 5 V, la ESP32 es de 3.3 V) |
| HC-SR04 VCC | 5V | VIN (5 V) |
| GND | GND común con la fuente de 12 V del ESC | ídem |

El HC-SR04 va en la **base apuntando hacia arriba** al carro. Recomendación: pega bajo el carro
una placa plana (cartón rígido de ~8×8 cm). La tabla del carro es angosta y muchas veces el eco
rebota en el travesaño superior (~90 cm); el firmware filtra esos ecos, pero con la placa casi desaparecen.

## Cargar el firmware

**Arduino Uno** (Arduino IDE): abrir `monocoptero_uno.ino`, placa *Arduino Uno*, subir. Solo usa `Servo.h`.

**ESP32** (Arduino IDE): abrir `monocoptero_esp32.ino`, placa *ESP32 Dev Module*, partición
*Default 4MB with spiffs*. Librerías (Gestor de librerías):

- **ESP Async WebServer** — autor *ESP32Async* (v3.7 o superior)
- **Async TCP** — autor *ESP32Async* (v3.3 o superior)
- **ArduinoJson** (v7) y **ESP32Servo**

> ⚠ Las versiones que tienes instaladas en `Documentos/Arduino/libraries`
> (ESPAsyncWebServer 3.1.0 de *lacamera* y AsyncTCP 1.1.4 de *dvarrel*) **no compilan**
> con el core ESP32 3.3: dan `mbedtls_md5_starts_ret was not declared`. Desinstálalas e instala
> las de *ESP32Async*. Con esas versiones el firmware se verificó (81 % de la flash).

Edita `config.h` (WiFi, pines). Para probar sin banco descomenta `#define MODO_SIMULADO`.

**Interfaz web en la ESP32**: desde `04_firmware/esp32/` ejecuta `.\scripts\deploy_frontend.ps1`
(compila el simulador, lo copia a `data/` y lo comprime con gzip para que quepa) y súbelo con
`pio run -t uploadfs` o con el plugin *LittleFS Upload* del Arduino IDE.
Con PlatformIO: `pio run -t upload` desde `04_firmware/esp32/`.

## Protocolo serie (115200 baudios, ambos firmwares)

### Comandos (una línea de texto)

| Comando | Efecto |
|---|---|
| `PWM 1800` | Modo manual (lazo abierto). `PWM 1000` apaga el motor |
| `SP 30` | Setpoint del PID en cm (se limita a 12–80 cm) |
| `PID 4 2.5 0.3` | Kp [µs/cm], Ki [µs/(cm·s)], Kd [µs·s/cm] |
| `U0 1762` | PWM de equilibrio: feedforward del PID y base del escalón (1500–1900) |
| `START` o `2` | Arranca el PID |
| `STEP` o `1` | Escalón de identificación: 5 s en U0 → 10 s en U0+50 → apaga |
| `STOP` o `0` | Motor a 1000 µs |
| `CLEAR` | Reconoce un failsafe (el motor sigue apagado) |
| `STATUS` | Pide el estado |

La ESP32 acepta además JSON por USB y por WebSocket:
`{"type":"cmd","action":"set_setpoint","value":30}` (acciones `set_pwm`, `set_setpoint`,
`set_pid`, `set_u0`, `start`, `start_step`, `stop`, `clear_failsafe`, `get_status`).

### Lo que envía la placa

- **Telemetría** cada 50 ms, **siempre** (también con el motor apagado):
  `tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm`
  - `altura_cm`: altura filtrada (es la que usa el PID y la que muestra el simulador)
  - `crudo_cm`: lectura cruda del pulso; `-1` = no hubo eco
  - `setpoint_cm`: `-1` si no está en PID
  - Las 3 primeras columnas son las mismas del ensayo original: los scripts de MATLAB sirven igual.
- **Estado**: Uno → `STATUS:modo,sp,kp,ki,kd,pwm,altura,failsafe,u0,sensor_ok`;
  ESP32 → `{"type":"status",...}` (JSON). Cada 2 s y tras cada comando.
- **Eventos**: `READY`, `FAILSAFE`, `FIN_PRUEBA`. Los avisos empiezan con `# `.

## Filtro del sensor y seguridad

1. Un solo disparo del HC-SR04 por periodo (el sketch anterior disparaba 3 veces seguidas y
   recibía ecos fantasma del disparo anterior).
2. Se rechaza un salto > 12 cm entre muestras (el carro no se mueve a más de 2.4 m/s); si
   3 lecturas seguidas coinciden en la nueva altura (±5 cm), el salto es real y se acepta.
3. Mediana de las 3 últimas lecturas aceptadas.
4. Sin eco ≥ 0.5 s con el motor apagado → el carro está en la base (11 cm): la altura ya no se
   queda "pegada" al bajar a 1000 µs.
5. **Failsafe**: altura *filtrada* ≥ 85 cm durante 3 muestras seguidas, o 1 s sin eco en PID.

## PID

Posicional en µs alrededor de U0, derivada sobre la medida (filtrada, sin "derivative kick"),
anti-windup condicional, salida limitada a 1550–1950 µs. Ganancias por defecto Kp = 4.0,
Ki = 2.5, Kd = 0.3: sintonía SIMC (τc = 0.8 s) sobre Gp(s) = 0.4302 e^(−0.1188 s)/(1.5719 s + 1).
En simulación con ruido y ecos falsos: ≈ 2 % de sobrepico, ≈ 2 s de establecimiento. **Pruébalas
primero con setpoints cercanos a 20–30 cm y la parada de emergencia a mano.**
