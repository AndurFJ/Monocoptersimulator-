# Plan de continuación — Monocóptero (retomar con el prototipo armado)

Estado al 01/10/2026. Lo que está hecho, lo que falta y en qué orden hacerlo.

## Estado actual

| Parte | Estado |
|---|---|
| MATLAB (`03_matlab/`) | ✅ Corregido y verificado: K = 0.4302, τ = 1.5719 s, t₀ = 0.1188 s, Fit 85.77 % |
| Firmware Arduino Uno (`04_firmware/arduino_uno/`) | ✅ Compila (30 % flash). **No probado en el banco** |
| Firmware ESP32 (`04_firmware/esp32/`) | ✅ Subido a la ESP32 (COM3, CH340), WiFi OK en `192.168.101.88` / `monocoptero.local`, página web OK |
| Sensor HC-SR04 en la ESP32 | ❌ **No mide**: todas las lecturas crudas = −1 (sin eco), `sensor_ok: false` |
| Simulador (`Simulador/`) | ✅ 54 tests OK, revisado en Chrome. Cambios **sin commit** en git |
| Informe IEEE (`05_informe_ieee/`) | 🟡 Redactado, sin compilar; faltan las marcas `[COMPLETAR]` |
| `ESC_CALIBRAR` en `config.h` | Puesto en `0` (el ESC se arma en 1000 µs, sin girar el motor) |

## Paso 1 — Cableado del sensor a la ESP32 (bloqueante)

- [ ] HC-SR04 **VCC → VIN (5 V)** y GND → GND común con la fuente de 12 V del ESC.
- [ ] **TRIG → GPIO12** (si la ESP32 no arranca con el sensor conectado, pasar a GPIO26 y cambiar `PIN_TRIG` en `config.h`).
- [ ] **ECHO → divisor → GPIO14**: ECHO —1 kΩ— GPIO14 —2 kΩ— GND (ECHO sale a 5 V; la ESP32 solo aguanta 3.3 V).
- [ ] ESC señal → GPIO27.
- [ ] Sensor en la base apuntando al carro. Pegar bajo el carro una **placa reflectora** plana (cartón rígido ~8×8 cm).
- [ ] Verificar por el monitor serie (115200): la columna `crudo_cm` debe dar ~11 cm con el carro apoyado y `sensor_ok: true`.

## Paso 2 — ESC y primeras pruebas en lazo abierto

- [ ] Si el ESC nunca se calibró: **quitar la hélice**, poner `ESC_CALIBRAR 1`, subir, esperar la secuencia, volver a `0` y subir de nuevo.
- [ ] Con hélice y a distancia: modo **Manual** en la web, subir el PWM de a poco. Anotar el PWM de despegue (el modelo predice ≈ 1755 µs).
- [ ] Confirmar que con `PWM 1000` el carro baja y la altura vuelve a ~11 cm (ya no se queda "pegada").
- [ ] Comprobar que los ecos falsos del travesaño aparecen solo como puntos grises en la gráfica y no mueven la altura filtrada.

## Paso 3 — Repetir el ensayo de identificación (mejora el informe)

- [ ] Ajustar `U0` (comando `U0 nnnn`) hasta que el carro flote estable en **≈ 20 cm** (la guía lo pide; el ensayo viejo fue en 13.45 cm).
- [ ] Verificar 5 s quieto (dy/dt ≈ 0) antes del escalón — en el ensayo viejo subió 3 cm justo antes.
- [ ] Comando `STEP` (5 s en U0 → 10 s en U0+50). Grabar con el botón **Excel para PID Tuner** o copiar el CSV del monitor serie.
- [ ] Guardar el CSV en `02_datos/` y correr `03_matlab/IdentificacionFIT3.m` (cambiar el nombre del archivo en la sección 1).
- [ ] Si cambian K, τ o t₀: actualizarlos en `Simulador/src/physics/constants.ts` (`PLANT_*`), en los firmwares (`U0_DEFECTO`) y en el informe.

## Paso 4 — PID en el banco (Etapa 2)

- [ ] Ganancias por defecto: Kp = 4.0 µs/cm, Ki = 2.5 µs/(cm·s), Kd = 0.3 µs·s/cm (SIMC, τc = 0.8 s).
- [ ] Primera prueba con setpoint **20–30 cm** y la **parada de emergencia** a mano.
- [ ] Probar escalones de setpoint (20 → 30 → 40 cm) y anotar sobrepico y tiempo de establecimiento (tarjeta "Respuesta al escalón").
- [ ] Comparar con la simulación (≈ 2 % sobrepico, ≈ 2 s establecimiento). Si oscila: bajar Kp/Ki; si es lento: subirlos.
- [ ] Verificar que el failsafe (85 cm) ya no salta a 30 cm.

## Paso 5 — Informe y entregables

- [ ] `05_informe_ieee/informe_ieee.tex`: llenar `[COMPLETAR]` (autores, correos, fotos del montaje, captura del Scope de Simulink, tabla Fit 1/Fit 2 opcional).
- [ ] Compilar en Overleaf (subir `informe_ieee.tex` + `figuras/`).
- [ ] Si se repitió el ensayo, regenerar figuras con MATLAB y copiarlas a `05_informe_ieee/figuras/`.
- [ ] Actualizar presentaciones si cambian los números (`06_presentacion/`).

## Paso 6 — Mantenimiento del código

- [ ] Hacer commit de los cambios del simulador en `Simulador/` (git).
- [ ] Si cambia la interfaz web: `04_firmware/esp32/scripts/deploy_frontend.ps1` y subir LittleFS (`pio run -t uploadfs`, o pedírmelo: se graba con esptool en `0x290000`).

## Referencias rápidas

- Protocolo, pines y comandos: `04_firmware/PROTOCOLO.md`
- Comandos serie: `PWM n`, `SP cm`, `PID kp ki kd`, `U0 us`, `START`, `STEP`, `STOP`, `CLEAR`, `STATUS`
- Telemetría: `tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm` (crudo −1 = sin eco)
- Librerías ESP32 instaladas: ESP Async WebServer 3.12.1 y Async TCP 3.5.0 (ESP32Async). Las viejas están en `_archivo/librerias_arduino_antiguas/`.
