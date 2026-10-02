/**
 * main.cpp — Firmware WiFi UNIFICADO del Monocóptero 1-GDL
 *
 * Esta es la ÚNICA implementación del firmware (reemplaza a la antigua
 * `firmware_wifi/firmware_wifi.ino`). Combina:
 *  - ESPAsyncWebServer + AsyncWebSocket: telemetría en tiempo real /ws
 *  - PID de altura en el firmware (sensor HC-SR04 + ESC)
 *  - mDNS (http://monocoptero.local)
 *  - LittleFS: sirve la SPA del simulador 3D (dist/ → data/)
 *  - Comandos desde el teléfono/PC: set_setpoint, set_pid, set_pwm,
 *    start, stop, start_step, clear_failsafe, ping
 *  - Failsafe a 85 cm + rearme sin arrancar el motor (clear_failsafe)
 *  - Control multi-cliente opcional (ALLOW_MULTI_CONTROL)
 *  - Modo mock (UART_MOCK_MODE) para probar sin banco físico
 *
 * Build: PlatformIO (`pio run`). Para Arduino IDE, ver ARDUINO_IDE.md:
 * copia este archivo como `monocoptero.ino` y `config.h` a la carpeta
 * del sketch. El código es un único archivo autocontenido para que una
 * sola fuente sirva a ambas herramientas.
 *
 * REGLAS (AGENTS-wifi.md):
 *  - Sin delay() en loop(). Todo con millis().
 *  - Sin LittleFS dentro de loop(). Solo en setup().
 *  - ws.cleanupClients() cada WS_CLEANUP_INTERVAL_MS.
 *  - Callbacks WS mínimos: encolan el comando, loop() lo procesa.
 *  - JsonDocument en stack para tramas pequeñas.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <ESP32Servo.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>

#include "config.h"

// ── Objetos globales ────────────────────────────────────────────
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
Servo esc;

// ── Estado del sistema ──────────────────────────────────────────
static float distancia_cm = 0.0f;
static int pwm_actual = ESC_MIN_US;
static bool sistema_iniciado = false;
static bool failsafe_latched = false;

enum ControlMode : uint8_t { MODE_IDLE, MODE_PID, MODE_MANUAL, MODE_STEP };
static ControlMode control_mode = MODE_IDLE;

// ── PID ─────────────────────────────────────────────────────────
static float kp = DEFAULT_KP;
static float ki = DEFAULT_KI;
static float kd = DEFAULT_KD;
static float setpoint_cm = DEFAULT_SETPOINT_CM;
static float pid_integral = 0.0f;
static float pid_prev_error = 0.0f;
static unsigned long pid_prev_time = 0;

// ── Escalón ─────────────────────────────────────────────────────
static unsigned long step_start_time = 0;

// ── Timing no bloqueante ────────────────────────────────────────
static unsigned long t_inicio = 0;
static unsigned long t_previo = 0;
static unsigned long t_ws_cleanup = 0;
static unsigned long t_status = 0;
static unsigned long t_wifi_retry = 0;
static unsigned long t_fs_error = 0;

// ── Cola de comandos WS (callback → loop) ──────────────────────
// El callback solo copia el mensaje (y su cliente); loop() lo parsea.
static char pending_cmd[256];
static volatile bool has_pending_cmd = false;
static volatile uint32_t pending_client_id = 0;

// ── Control multi-cliente ───────────────────────────────────────
// 0 = todavía no hay controlador; el primer cliente que conecta lo es.
static volatile uint32_t first_client_id = 0;

// ── Modelo mock FOPDT ──────────────────────────────────────────
#ifdef UART_MOCK_MODE
static float mock_y = 0.0f;
static float mock_u_buf[MOCK_FOPDT_DELAY_SAMPLES] = {0.0f, 0.0f, 0.0f};
static uint8_t mock_idx = 0;
#endif

// ══════════════════════════════════════════════════════════════
// ██  Sensor HC-SR04 / Mock FOPDT
// ══════════════════════════════════════════════════════════════

#ifdef UART_MOCK_MODE
/** Simula Gp(s) = 0.4302·e^(-0.1188s)/(1.5719s+1) a Ts = 50 ms. */
static float mockStep(int pwm_us) {
  const float u_norm = constrain((pwm_us - 1000) / 1000.0f, 0.0f, 1.0f);
  mock_u_buf[mock_idx] = u_norm;
  mock_idx = (mock_idx + 1) % MOCK_FOPDT_DELAY_SAMPLES;
  // La muestra retardada L ≈ 2.38·Ts se toma del slot más antiguo.
  const float u_d = mock_u_buf[mock_idx];
  mock_y = MOCK_FOPDT_A * mock_y + MOCK_FOPDT_B * u_d;
  return mock_y * 100.0f;  // m → cm (hover 1762 µs ≈ 33 cm)
}
#else
static float leerUltrasonico() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  const long duracion = pulseIn(PIN_ECHO, HIGH, SENSOR_TIMEOUT_US);
  if (duracion == 0) return distancia_cm;  // mantener último valor
  const float d_nueva = (duracion * 0.0343f) / 2.0f;
  if (d_nueva < 1.0f || d_nueva > 110.0f) return distancia_cm;
  if (distancia_cm <= 0.1f) return d_nueva;
  return (0.75f * distancia_cm) + (0.25f * d_nueva);
}
#endif

// ══════════════════════════════════════════════════════════════
// ██  PID
// ══════════════════════════════════════════════════════════════

static int computePID(float medida_cm, unsigned long ahora_ms) {
  const float error = setpoint_cm - medida_cm;
  const float dt = (ahora_ms - pid_prev_time) / 1000.0f;
  if (dt <= 0.0f || dt > 1.0f) {
    pid_prev_error = error;
    pid_prev_time = ahora_ms;
    return constrain(PWM_HOVER_US + (int)(kp * error), ESC_MIN_US, ESC_MAX_US);
  }
  const float p = kp * error;
  pid_integral += ki * error * dt;
  pid_integral = constrain(pid_integral, (float)-PID_INTEGRAL_MAX, (float)PID_INTEGRAL_MAX);
  const float d = kd * (error - pid_prev_error) / dt;
  pid_prev_error = error;
  pid_prev_time = ahora_ms;
  float output = constrain(p + pid_integral + d, (float)PID_OUTPUT_MIN, (float)PID_OUTPUT_MAX);
  return constrain(PWM_HOVER_US + (int)output, ESC_MIN_US, ESC_MAX_US);
}

static void resetPID() {
  pid_integral = 0.0f;
  pid_prev_error = 0.0f;
  pid_prev_time = millis();
}

static int computeStep(unsigned long ahora_ms) {
  const unsigned long t_rel = ahora_ms - step_start_time;
  if (t_rel < STEP_HOVER_MS) return STEP_U0;
  if (t_rel < STEP_TOTAL_MS) return STEP_U0 + STEP_DELTA_U;
  control_mode = MODE_IDLE;
  Serial.println("[STEP] Prueba de escalón terminada");
  return ESC_MIN_US;
}

// ══════════════════════════════════════════════════════════════
// ██  Telemetría y estado (broadcast WS)
// ══════════════════════════════════════════════════════════════

static const char *modeStr(ControlMode m) {
  switch (m) {
    case MODE_PID: return "pid";
    case MODE_MANUAL: return "manual";
    case MODE_STEP: return "step";
    default: return "idle";
  }
}

static void broadcastTelemetry(unsigned long t_relativo_ms) {
  if (ws.count() == 0) return;
  JsonDocument doc;
  doc["type"] = "telemetry";
  doc["t"] = t_relativo_ms / 1000.0;
  doc["height"] = distancia_cm / 100.0;  // cm → m (front-end)
  doc["pwm"] = pwm_actual;
  doc["mode"] = modeStr(control_mode);
  if (control_mode == MODE_PID) doc["setpoint"] = setpoint_cm / 100.0;
  char buffer[256];
  const size_t len = serializeJson(doc, buffer);
  ws.textAll(buffer, len);
}

static void broadcastStatus() {
  JsonDocument doc;
  doc["type"] = "status";
  doc["uart_connected"] = true;
  doc["clients"] = ws.count();
  doc["uptime_s"] = millis() / 1000;
  doc["ip"] = WiFi.localIP().toString();
#ifdef USE_WIFI_STA
  doc["wifi_mode"] = "STA";
#else
  doc["wifi_mode"] = "AP";
#endif
  doc["control_mode"] = modeStr(control_mode);
  doc["setpoint_cm"] = setpoint_cm;
  doc["kp"] = kp;
  doc["ki"] = ki;
  doc["kd"] = kd;
  doc["pwm"] = pwm_actual;
  doc["distancia_cm"] = distancia_cm;
  doc["failsafe"] = failsafe_latched;
  char buffer[384];
  const size_t len = serializeJson(doc, buffer);
#if SERIAL_STATUS_JSON
  // Eco por USB: los clientes conectados por Serial (PC) también reciben
  // el estado y se sincronizan con los clientes WiFi. Así nadie queda ciego.
  Serial.println(buffer);
#endif
  if (ws.count() > 0) ws.textAll(buffer, len);
}

// ══════════════════════════════════════════════════════════════
// ██  Comandos (procesados en loop, no en el callback)
// ══════════════════════════════════════════════════════════════

static void processCommand(const char *data, size_t len, uint32_t client_id) {
  JsonDocument doc;
  if (deserializeJson(doc, data, len)) {
    Serial.println("[WS] JSON inválido — ignorado");
    return;
  }
  const char *type = doc["type"] | "";
  // Ping → pong siempre permitido, sea quien sea el cliente.
  if (strcmp(type, "ping") == 0) {
    ws.textAll("{\"type\":\"pong\"}");
    return;
  }
  if (strcmp(type, "cmd") != 0) {
    Serial.printf("[WS] Tipo desconocido: %s\n", type);
    return;
  }

  // Arbitraje multi-cliente: si solo controla el primero, ignorar al resto.
  // El USB (client_id == 0) siempre puede controlar: es el operador local.
#if !ALLOW_MULTI_CONTROL
  if (client_id != 0 && client_id != first_client_id) {
    Serial.printf("[WS] Comando de cliente #%u ignorado (controlador: #%u)\n",
                  client_id, first_client_id);
    return;
  }
#endif

  const char *action = doc["action"] | "";
  Serial.printf("[WS] Comando: %s (cliente #%u)\n", action, client_id);

  if (strcmp(action, "start") == 0) {
    sistema_iniciado = true;
    failsafe_latched = false;
    control_mode = MODE_PID;
    resetPID();
    t_inicio = millis();
    t_previo = t_inicio;
  } else if (strcmp(action, "stop") == 0) {
    sistema_iniciado = false;
    control_mode = MODE_IDLE;
    pwm_actual = ESC_MIN_US;
    esc.writeMicroseconds(ESC_MIN_US);
    resetPID();
  } else if (strcmp(action, "start_step") == 0) {
    sistema_iniciado = true;
    failsafe_latched = false;
    control_mode = MODE_STEP;
    step_start_time = millis();
    t_inicio = step_start_time;
    t_previo = t_inicio;
  } else if (strcmp(action, "set_setpoint") == 0) {
    const float v = doc["value"] | -1.0f;
    if (v >= 0) setpoint_cm = (v <= 1.5f) ? v * 100.0f : v;  // m o cm
  } else if (strcmp(action, "set_pwm") == 0) {
    const int v = constrain(doc["value"] | ESC_MIN_US, ESC_MIN_US, ESC_MAX_US);
    sistema_iniciado = true;
    failsafe_latched = false;
    control_mode = MODE_MANUAL;
    pwm_actual = v;
    esc.writeMicroseconds(pwm_actual);
  } else if (strcmp(action, "set_pid") == 0) {
    kp = doc["kp"] | kp;
    ki = doc["ki"] | ki;
    kd = doc["kd"] | kd;
    pid_integral = 0.0f;
  } else if (strcmp(action, "clear_failsafe") == 0) {
    // Rearmar tras un failsafe SIN arrancar el motor: solo reconoce el aviso.
    failsafe_latched = false;
    control_mode = MODE_IDLE;
    pwm_actual = ESC_MIN_US;
    esc.writeMicroseconds(ESC_MIN_US);
    resetPID();
  } else if (strcmp(action, "get_status") == 0) {
    // Sin cambio de estado: el broadcastStatus() del final responde al solicitante.
  } else {
    Serial.printf("[WS] Acción desconocida: %s\n", action);
    return;
  }
  broadcastStatus();
}

// ══════════════════════════════════════════════════════════════
// ██  Comandos por USB (Serial)
// ══════════════════════════════════════════════════════════════
// El puerto USB acepta el MISMO protocolo JSON que el WebSocket:
//   {"type":"cmd","action":"set_setpoint","value":0.35}
// y conserva los atajos del monitor: '1' escalón, '2' PID, '0' stop, 'h' ayuda.
// Así el PC (USB) y el teléfono (WiFi) hablan el mismo idioma con la ESP32.

static void handleSerialLine(const char *line) {
  while (*line == ' ' || *line == '\t') line++;
  if (*line == '{') {
    processCommand(line, strlen(line), 0);  // 0 = operador USB local
    return;
  }
  if (strlen(line) == 1) {
    const char c = line[0];
    if (c == '1') {
      sistema_iniciado = true;
      failsafe_latched = false;
      control_mode = MODE_STEP;
      step_start_time = millis();
      t_inicio = step_start_time;
      broadcastStatus();
    } else if (c == '2') {
      sistema_iniciado = true;
      failsafe_latched = false;
      control_mode = MODE_PID;
      resetPID();
      t_inicio = millis();
      broadcastStatus();
    } else if (c == '0') {
      sistema_iniciado = false;
      control_mode = MODE_IDLE;
      pwm_actual = ESC_MIN_US;
      esc.writeMicroseconds(ESC_MIN_US);
      resetPID();
      broadcastStatus();
    } else if (c == 'h' || c == '?') {
      Serial.printf("IP: %s | ws://%s/ws | http://%s.local/\n",
                    WiFi.localIP().toString().c_str(),
                    WiFi.localIP().toString().c_str(), MDNS_HOSTNAME);
      Serial.println("JSON: {\"type\":\"cmd\",\"action\":\"set_setpoint|set_pid|set_pwm|start|stop|start_step|clear_failsafe|get_status\"}");
    }
  }
}

static void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len) {
  (void)server;
  switch (type) {
    case WS_EVT_CONNECT:
      Serial.printf("[WS] Cliente #%u conectado\n", client->id());
      if (first_client_id == 0) first_client_id = client->id();
      broadcastStatus();
      break;
    case WS_EVT_DISCONNECT:
      Serial.printf("[WS] Cliente #%u desconectado\n", client->id());
      if (client->id() == first_client_id) first_client_id = 0;
      break;
    case WS_EVT_DATA: {
      AwsFrameInfo *info = (AwsFrameInfo *)arg;
      // Solo texto completo de un frame; el resto se ignora sin bloquear.
      if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
        const size_t n = len < sizeof(pending_cmd) - 1 ? len : sizeof(pending_cmd) - 1;
        memcpy(pending_cmd, data, n);
        pending_cmd[n] = '\0';
        pending_client_id = client->id();
        has_pending_cmd = true;
      }
      break;
    }
    case WS_EVT_ERROR:
      Serial.printf("[WS] Error en cliente #%u\n", client->id());
      break;
    case WS_EVT_PONG:
      break;
  }
}

// ══════════════════════════════════════════════════════════════
// ██  WiFi no bloqueante (reintento cada 10 s en STA)
// ══════════════════════════════════════════════════════════════

static bool wifi_was_connected = false;

static void wifiBegin() {
#ifdef USE_WIFI_STA
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASS);
  Serial.printf("[WIFI] Conectando a \"%s\"...\n", WIFI_STA_SSID);
#else
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASS, WIFI_AP_CHANNEL);
  Serial.printf("[WIFI] AP \"%s\" IP: %s\n", WIFI_AP_SSID, WiFi.softAPIP().toString().c_str());
#endif
}

static void wifiLoop(unsigned long ahora) {
#ifdef USE_WIFI_STA
  if (WiFi.status() == WL_CONNECTED) {
    // Avisar UNA vez al engancharse, con la IP para copiarla en el navegador.
    if (!wifi_was_connected) {
      wifi_was_connected = true;
      Serial.println("[WIFI] ¡Conectado!");
      Serial.printf("[WIFI]  IP:           %s\n", WiFi.localIP().toString().c_str());
      Serial.printf("[WIFI]  Simulador:    http://%s/\n", WiFi.localIP().toString().c_str());
      Serial.printf("[WIFI]  mDNS:         http://%s.local/\n", MDNS_HOSTNAME);
      Serial.printf("[WIFI]  WebSocket:    ws://%s/ws\n", WiFi.localIP().toString().c_str());
    }
    return;
  }
  wifi_was_connected = false;
  if (ahora - t_wifi_retry < 10000) return;  // reintentar cada 10 s, sin colgarse
  t_wifi_retry = ahora;
  Serial.println("[WIFI] Reintentando conexión STA...");
  WiFi.disconnect();
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASS);
#endif
}

// ══════════════════════════════════════════════════════════════
// ██  HTTP + LittleFS: servir la SPA (dist/)
// ══════════════════════════════════════════════════════════════

static void setupWebServer() {
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html").setCacheControl("max-age=86400");
  // Fallback SPA: rutas desconocidas devuelven index.html.
  server.onNotFound([](AsyncWebServerRequest *request) {
    if (request->method() == HTTP_GET && LittleFS.exists("/index.html")) {
      request->send(LittleFS, "/index.html", "text/html");
    } else {
      request->send(404, "text/plain", "LittleFS sin SPA: ejecuta deploy_frontend.");
    }
  });
}

// ══════════════════════════════════════════════════════════════
// ██  Failsafe: altura > 85 cm → PWM 1000 µs + aviso
// ══════════════════════════════════════════════════════════════

static void activateFailsafe(const char *reason) {
  pwm_actual = ESC_MIN_US;
  esc.writeMicroseconds(ESC_MIN_US);
  control_mode = MODE_IDLE;
  failsafe_latched = true;
  resetPID();
  Serial.printf("[SAFETY] FAILSAFE: %s (PWM→1000)\n", reason);
  broadcastStatus();
}

// ══════════════════════════════════════════════════════════════
// ██  SETUP / LOOP
// ══════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] Monocóptero WiFi + SPA (firmware unificado)");
#ifdef UART_MOCK_MODE
  Serial.println("[BOOT] Modo MOCK: FOPDT simulada, sin banco físico");
#endif

  wifiBegin();
  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("http", "tcp", 80);
    Serial.printf("[MDNS] http://%s.local\n", MDNS_HOSTNAME);
  } else {
    Serial.println("[MDNS] Error al iniciar mDNS");
  }

  // LittleFS solo en setup (bloqueante permitido aquí, nunca en loop).
  if (!LittleFS.begin()) {
    Serial.println("[FS] ERROR: LittleFS no monta — HTTP sin SPA");
  } else {
    Serial.println("[FS] LittleFS montado");
  }

#ifndef UART_MOCK_MODE
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
#endif

  // ESC: secuencia de calibración opcional (solo con hardware real).
  ESP32PWM::allocateTimer(0);
  esc.setPeriodHertz(50);
  esc.attach(PIN_ESC, ESC_MIN_US, ESC_MAX_US);
  esc.writeMicroseconds(ESC_MIN_US);
#ifndef UART_MOCK_MODE
  #if ESC_ARM_SEQUENCE
    Serial.println("[ESC] Secuencia de calibración (¡hélice despejada!): min→max→min");
    delay(2000);
    esc.writeMicroseconds(ESC_MAX_US);
    delay(2000);
    esc.writeMicroseconds(ESC_MIN_US);
    delay(2000);
    Serial.println("[ESC] Calibración completa");
  #else
    Serial.println("[ESC] Armado en mínimo (sin calibración)");
  #endif
#endif

  setupWebServer();
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.begin();
  Serial.println("[HTTP] Puerto 80 — SPA + /ws listos");

  t_inicio = millis();
  t_previo = t_inicio;
  t_ws_cleanup = t_inicio;
  t_status = t_inicio;
  t_wifi_retry = t_inicio;
  pid_prev_time = t_inicio;
}

void loop() {
  const unsigned long ahora = millis();

  wifiLoop(ahora);

  // LittleFS caído: log cada 5 s, nunca servir HTTP corrupto.
  if (!LittleFS.exists("/index.html") && ahora - t_fs_error > 5000) {
    t_fs_error = ahora;
    Serial.println("[FS] Aviso: /index.html ausente — ejecuta deploy_frontend");
  }

  // Limpieza de zombies sin costo por iteración.
  if (ahora - t_ws_cleanup >= WS_CLEANUP_INTERVAL_MS) {
    t_ws_cleanup = ahora;
    ws.cleanupClients(WS_MAX_CLIENTS);
    const uint32_t heap = ESP.getFreeHeap();
    if (heap < 20000) Serial.printf("[MEM] Heap bajo: %u bytes\n", heap);
  }

  // Comandos encolados por el callback WS.
  if (has_pending_cmd) {
    has_pending_cmd = false;
    const uint32_t cid = pending_client_id;
    pending_client_id = 0;
    processCommand(pending_cmd, strlen(pending_cmd), cid);
  }

  // Comandos por USB: líneas JSON (mismo protocolo que /ws) o atajos '1'/'2'/'0'/'h'.
  static char serial_line[256];
  static size_t serial_len = 0;
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serial_len > 0) {
        serial_line[serial_len] = '\0';
        handleSerialLine(serial_line);
        serial_len = 0;
      }
    } else if (serial_len < sizeof(serial_line) - 1) {
      serial_line[serial_len++] = c;
    }
  }

  // Estado periódico a TODOS los canales (también en reposo).
  if (ahora - t_status >= 5000) {
    t_status = ahora;
    broadcastStatus();
  }

  // Reposo: motor apagado pero telemetría viva (monitoreo continuo).
  if (!sistema_iniciado) {
    static unsigned long t_idle_pwm = 0;
    if (ahora - t_idle_pwm >= 100) {
      t_idle_pwm = ahora;
      esc.writeMicroseconds(ESC_MIN_US);
    }
    if (ahora - t_previo >= SAMPLE_INTERVAL_MS) {
      t_previo = ahora;
#ifdef UART_MOCK_MODE
      distancia_cm = mockStep(ESC_MIN_US);
#else
      distancia_cm = leerUltrasonico();
#endif
      broadcastTelemetry(ahora - t_inicio);
    }
    return;
  }

  // Muestreo determinístico Ts = 50 ms (20 Hz).
  if (ahora - t_previo >= SAMPLE_INTERVAL_MS) {
    t_previo = ahora;
#ifdef UART_MOCK_MODE
    distancia_cm = mockStep(pwm_actual);
#else
    distancia_cm = leerUltrasonico();
#endif

    if (distancia_cm >= FAILSAFE_CM && control_mode != MODE_IDLE) {
      activateFailsafe("Altura excesiva");
      return;
    }

    switch (control_mode) {
      case MODE_PID:
        pwm_actual = computePID(distancia_cm, ahora);
        esc.writeMicroseconds(pwm_actual);
        break;
      case MODE_MANUAL:
        esc.writeMicroseconds(pwm_actual);
        break;
      case MODE_STEP:
        pwm_actual = computeStep(ahora);
        esc.writeMicroseconds(pwm_actual);
        break;
      case MODE_IDLE:
      default:
        pwm_actual = ESC_MIN_US;
        esc.writeMicroseconds(ESC_MIN_US);
        break;
    }

    const unsigned long t_rel = ahora - t_inicio;
    if (control_mode != MODE_IDLE) Serial.printf("%lu,%d,%.2f\n", t_rel, pwm_actual, distancia_cm);
    broadcastTelemetry(t_rel);
  }
}