# AGENTS.md — Módulo WiFi/ESP32 del Simulador Monocóptero

> Este archivo complementa el `AGENTS.md` del simulador base. Lee ambos antes de trabajar.
>
> **ACTUALIZACIÓN (arquitectura final):** el firmware está UNIFICADO en `firmware/`
> (`src/main.cpp` autocontenido, compila con PlatformIO o renombrado a `.ino` en
> Arduino IDE — ver `firmware/ARDUINO_IDE.md`). El sistema es **dual-canal sincronizado**:
> USB (Web Serial, bidireccional) y WiFi (WebSocket) hablan el MISMO protocolo JSON, y la
> ESP32 es el árbitro del estado: cada comando se aplica y el estado se retransmite por
> AMBOS canales (`SERIAL_STATUS_JSON` en `config.h`), de modo que PC y teléfono nunca
> quedan ciegos entre sí. `SerialSource.ts` NO está reemplazada: es bidireccional como
> `WifiSource.ts`. No reintroduzcas un `.ino` duplicado.

---

## 1. Rol de los agentes en este repo

Actúa como **ingeniero senior embebido + fullstack**, cómodo con:
- C++ en ESP32 (framework Arduino + FreeRTOS implícito de Espressif).
- Gestión de recursos en microcontroladores: RAM, flash, heap fragmentación, WDT.
- WebSocket en embedded: async I/O, broadcast eficiente, limpieza de clientes muertos.
- CSS responsive para un viewport móvil que convive con WebGL.

Prioridades en orden:
1. **Robustez del firmware**: la ESP32 no puede colgarse mientras corre un ensayo real. Un WDT
   reset en medio de un experimento es inaceptable.
2. **Fidelidad del dato**: cada muestra del UART llega a todos los clientes, en orden, sin pérdidas
   dentro de las limitaciones del hardware.
3. **Simplicidad**: este es un sistema de laboratorio para una persona, no un producto de millones
   de unidades. No over-engineerices.

---

## 2. Stack — límites duros para el firmware

Usa **exactamente** esto en `platformio.ini`:

```ini
lib_deps =
  ESP32Async/ESPAsyncWebServer @ ^3.7.0   ; fork activo con fix de thread-safety (PR #424, 2026)
  ESP32Async/AsyncTCP          @ ^3.3.0
  bblanchon/ArduinoJson        @ ^7.0.0
```

**Prohibido sin permiso explícito:**
- MQTT (requiere broker externo, complejidad innecesaria para red local).
- Socket.IO (overhead de protocolo, dependencia JS pesada, no aporta nada que WS puro no haga).
- HTTP polling (50 requests/s × n clientes = inaceptable).
- `delay()` en `loop()` — bloquea el stack de red de la ESP32 y dispara el WDT. Usar timers o
  variables de último timestamp (`if (millis() - lastSend > interval)`).
- Operaciones de LittleFS dentro del `loop()` principal — son bloqueantes; hacerlas solo en `setup()`.
- Librerías de terceros sin versión fija en `platformio.ini` — las versiones flotantes rompen builds.

---

## 3. Convenciones de código del firmware

- Todo en C++ con `#pragma once` en los `.h`.
- Nombres de archivo en `snake_case`, clases en `PascalCase`, constantes en `UPPER_SNAKE_CASE`.
- Ninguna credencial WiFi en el código fuente: van **siempre** en `config.h`, que está en `.gitignore`.
  Proveer un `config.h.example` con valores de placeholder.
- Toda constante configurable del hardware (pins, baudios, intervalos) vive en `config.h` — nunca
  hardcodeada dentro de los `.cpp`.
- Los valores que **dependen del usuario** (SSID, pines, baudios) llevan comentario
  `// CONFIRMAR CON USUARIO` la primera vez que aparecen.
- Usar `Serial.printf()` para logs de depuración, prefijados con `[WS]`, `[UART]`, `[FS]`, etc.,
  para poder filtrarlos en el monitor serial.
- No usar `String` de Arduino en paths críticos (fragmenta el heap): preferir `char[]` o
  `std::string` para buffers UART; está bien para mensajes de log poco frecuentes.

---

## 4. Reglas críticas para la ESP32 (no negociables)

### 4.1 No bloquear el core de red
El stack WiFi/TCP de la ESP32 corre en el Core 0. ESPAsyncWebServer usa callbacks que se ejecutan
en ese core. Nunca hagas operaciones bloqueantes dentro de los callbacks de `AsyncWebSocket`
(ni `delay()`, ni LittleFS, ni Serial que bloquee). Solo encola el mensaje y procésalo en `loop()`.

### 4.2 Limpiar clientes WebSocket muertos
Los clientes que se desconectan sin hacer un close limpio dejan sockets zombie que consumen RAM.
Llamar `ws.cleanupClients()` en `loop()` cada `WS_CLEANUP_INTERVAL_MS` (ver `config.h`).
No llamarlo en cada iteración del loop — es costoso.

### 4.3 Buffer UART con manejo de líneas incompletas
El UART llega byte a byte. Nunca asumir que una llamada a `Serial2.readStringUntil('\n')` devuelve
una trama completa — puede regresar parcialmente si el WDT o la ISR interrumpió. Usar un buffer
circular o acumular en un `char[]` local hasta recibir `\n`.

### 4.4 ArduinoJson: stack vs heap
Para objetos JSON pequeños (< 256 bytes, como las tramas de telemetría), usar `JsonDocument` en el
stack. Para objetos grandes o de vida larga, usar `JsonDocument` en el heap con cuidado de no
fragmentarlo. No mezclar.

### 4.5 Watchdog Timer (WDT)
El WDT de la ESP32 se dispara si `loop()` no retorna en ~10 s (por defecto). Asegurarse de que
ninguna operación en `loop()` bloquee más de unos pocos ms. Si hay operaciones lentas inevitables,
llamar `esp_task_wdt_reset()`.

---

## 5. Flujo de trabajo por tarea

1. Leer la sección relevante de `spec-wifi.md` antes de escribir código.
2. Trabajar en una fase a la vez (§12 del spec). No implementar el puente UART (Fase 3) antes de
   verificar que el WebSocket básico funciona (Fase 2).
3. **Verificar en hardware real** cada fase antes de pasar a la siguiente — ver §6.
4. Terminar cada tarea con: resumen de verificación, preguntas abiertas, y `pio run` sin errores.

---

## 6. Verificación obligatoria por fase

La ESP32 no se puede simular en el navegador — el agente debe verificar en hardware o documentar
exactamente cómo verificar:

| Fase | Cómo verificar |
|------|----------------|
| 1 (HTTP+LittleFS) | Desde un teléfono conectado a la WiFi: abrir `http://monocoptero.local` y confirmar que carga el simulador. Captura de pantalla. |
| 2 (WebSocket echo) | Desde el PC: `npx wscat -c ws://monocoptero.local/ws` → enviar `{"type":"ping"}` → esperar `{"type":"pong"}`. |
| 3 (Puente UART) | Con el banco conectado por serial: confirmar que los datos del HC-SR04 aparecen en las gráficas del simulador en el teléfono. |
| 4 (Comandos) | Mover el slider de altura en el teléfono → el carro físico se mueve. |
| 5 (Responsive) | Abrir el simulador en Chrome DevTools modo iPhone 14 Pro (390×844) → verificar layout: panel colapsado, canvas táctil, gráficas scrollables. |

Si el agente no puede conectar hardware físico, debe:
- Implementar un generador de tramas UART de prueba en el firmware (datos sinusoidales simulados,
  activable con `#define UART_MOCK_MODE` en `config.h`).
- Documentar claramente que la verificación fue en modo mock, no con hardware real.

---

## 7. Manejo de errores

- **WiFi no conecta (modo STA):** mostrar mensaje en Serial, encender LED integrado en patrón de error
  (si existe), reintentar cada 10 s, no colgarse en un `while(!WiFi.isConnected()){}`.
- **Cliente WebSocket con frame inválido/malformado:** ignorar silenciosamente y logear con `[WS]`.
  No dejar que un mensaje malo de un cliente mate el servidor.
- **UART sin datos > 5 s:** broadcast `{"type":"status","uart_connected":false}` para que el HUD del
  simulador muestre el indicador en rojo.
- **LittleFS no monta:** entrar en un loop de error con log cada 5 s — nunca intentar servir HTTP
  sin el filesystem montado (resultaría en respuestas corruptas).
- **Heap < 20 KB libre:** logear advertencia `[MEM] Heap bajo: X bytes`. Si cae < 10 KB, dejar de
  aceptar nuevas conexiones WS hasta que suba.

---

## 8. Seguridad (proporcional al contexto)

Este es un sistema de laboratorio en una red WiFi local, no expuesto a internet. La seguridad
requerida es mínima pero real:

- El AP WiFi **siempre con contraseña WPA2** (mínimo 8 caracteres en `config.h`). Nunca AP abierto.
- No implementar autenticación HTTP/WebSocket — añade complejidad sin beneficio en este contexto.
- Si en el futuro se expone a internet (aunque no está en el alcance), revisar este punto.

---

## 9. `.gitignore` obligatorio

```
# Credenciales WiFi — NUNCA subir al repo
firmware/config.h

# PlatformIO
firmware/.pio/
firmware/.vscode/

# Build del simulador (se regenera con el script de deploy)
firmware/data/
```

Siempre incluir `firmware/config.h.example` con valores de placeholder y comentarios.

---

## 10. Definition of Done para este módulo

Una feature está terminada cuando:

- [ ] `pio run` compila sin errores ni warnings de tipo.
- [ ] Verificación en hardware (real o mock documentado) según §6.
- [ ] `config.h.example` refleja cualquier nueva constante añadida.
- [ ] `.gitignore` cubre `config.h` y cualquier credencial nueva.
- [ ] El simulador base no tiene commits nuevos salvo: `WifiSource.ts` + entrada en selector de modo.
- [ ] Las preguntas abiertas relevantes de `spec-wifi.md §13` tienen respuesta o están marcadas
      explícitamente como bloqueantes para la siguiente fase.
- [ ] El monitor serial no muestra errores repetidos ni reinicios del WDT durante 5 minutos de
      operación continua con el banco conectado.

---

## 11. Commits

Conventional Commits, con prefijo del módulo:

```
feat(esp32/wifi): implement STA mode + mDNS hostname (phase 1)
feat(esp32/ws): add WebSocket broadcast of UART telemetry (phase 3)
feat(frontend/wifi): add WifiSource.ts and mode selector entry
fix(esp32/ws): call cleanupClients() to prevent zombie socket memory leak
chore(esp32): add config.h.example and gitignore credentials
```
