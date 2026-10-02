/*
 * monocoptero_esp32.ino — Firmware del banco Monocóptero 1-GDL para ESP32
 * Universidad del Magdalena · Control Análogo
 *
 * Hace lo mismo que el firmware del Arduino Uno (mismo filtro del sensor,
 * mismo PID, mismos comandos por USB) y además:
 *   - sirve el simulador web desde LittleFS (http://monocoptero.local),
 *   - WebSocket /ws: telemetría JSON a 20 Hz + comandos desde el teléfono/PC,
 *   - retransmite el estado a TODOS los clientes (USB y WiFi sincronizados).
 *
 * Protocolo: ver 04_firmware/PROTOCOLO.md
 *   USB (115200): comandos de texto (PWM, SP, PID, U0, START, STEP, STOP, CLEAR,
 *                 STATUS) o JSON; telemetría CSV
 *                 tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm
 *                 y estado JSON {"type":"status",...}. Los avisos empiezan con "# ".
 *   WiFi (/ws):   comandos JSON {"type":"cmd","action":"set_setpoint","value":30}
 *                 telemetría {"type":"telemetry","t":..,"height":m,"raw":m,"pwm":..}
 *
 * Librerías: ESPAsyncWebServer + AsyncTCP, ArduinoJson 7, ESP32Servo.
 * Compila con Arduino IDE (placa "ESP32 Dev Module") o PlatformIO (../platformio.ini).
 *
 * Reglas: nada bloqueante en loop() salvo el pulso del HC-SR04 (≤ 12 ms);
 * los callbacks del WebSocket solo encolan el texto, loop() lo procesa.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <ESP32Servo.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>

#include "config.h"

// ── Muestreo ────────────────────────────────────────────────────
#define TS_MS 50

// ── Sensor HC-SR04 (mismos valores que el Arduino Uno) ──────────
#define SENSOR_TIMEOUT_US   12000UL
#define SENSOR_MIN_CM       2.0f
#define SENSOR_MAX_CM       120.0f
#define MAX_SALTO_CM        12.0f
#define CONFIRMAR_SALTO     3
#define ALTURA_REPOSO_CM    11.0f
#define SIN_ECO_MUESTRAS    10

// ── Seguridad ───────────────────────────────────────────────────
#define FAILSAFE_CM         85.0f
#define FAILSAFE_MUESTRAS   3
#define SIN_SENSOR_PID      20

// ── Planta identificada y PID ───────────────────────────────────
// Gp(s) = 0.4302 e^(-0.1188 s) / (1.5719 s + 1), punto de operación (1762 µs, 13.45 cm)
#define U0_DEFECTO        1762
#define Y0_PLANTA_CM      13.45f
#define K_PLANTA          0.4302f
#define TAU_PLANTA_S      1.5719f
#define RETARDO_MUESTRAS  2           // 0.1188 s ≈ 2.4 · Ts
#define DELTA_U_ESCALON   50
#define ESCALON_PREVIO_MS 5000UL
#define ESCALON_TOTAL_MS  15000UL
#define KP_DEFECTO 4.0f               // µs/cm        (SIMC, tau_c = 0.8 s)
#define KI_DEFECTO 2.5f               // µs/(cm·s)
#define KD_DEFECTO 0.3f               // µs·s/cm
#define SP_DEFECTO 30.0f
#define SP_MIN_CM  12.0f
#define SP_MAX_CM  80.0f
#define PID_U_MIN  1550
#define PID_U_MAX  1950
#define PID_I_MAX  250.0f
#define D_FILTRO   0.3f

#define MODO_REPOSO  0
#define MODO_PID     1
#define MODO_MANUAL  2
#define MODO_ESCALON 3

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
Servo esc;

uint8_t modo = MODO_REPOSO;
int pwm_actual = ESC_MIN_US;
int pwm_manual = ESC_MIN_US;
int u0 = U0_DEFECTO;
bool failsafe = false;

// Sensor
float altura_cm = ALTURA_REPOSO_CM;
float crudo_cm = -1.0f;
float ventana[3] = {ALTURA_REPOSO_CM, ALTURA_REPOSO_CM, ALTURA_REPOSO_CM};
float saltos[CONFIRMAR_SALTO];
uint8_t n_saltos = 0;
uint8_t sin_eco = 0;
uint8_t n_failsafe = 0;
bool sensor_ok = false;
bool sensor_iniciado = false;

// PID
float kp = KP_DEFECTO, ki = KI_DEFECTO, kd = KD_DEFECTO;
float setpoint_cm = SP_DEFECTO;
float integral = 0.0f;
float derivada_f = 0.0f;
float altura_previa = ALTURA_REPOSO_CM;

// Tiempos
unsigned long t_muestra = 0;
unsigned long t_estado = 0;
unsigned long t_escalon = 0;
unsigned long t_motor_off = 0;
unsigned long t_ws_limpieza = 0;
unsigned long t_wifi_reintento = 0;

// Cola de comandos (callback WebSocket → loop). Productor: tarea AsyncTCP; consumidor: loop.
#define COLA_N 8
#define COLA_LARGO 200
char cola[COLA_N][COLA_LARGO];
uint32_t cola_cliente[COLA_N];
volatile uint8_t cola_ini = 0, cola_fin = 0;
portMUX_TYPE cola_mux = portMUX_INITIALIZER_UNLOCKED;
volatile uint32_t primer_cliente = 0;

#ifdef MODO_SIMULADO
float sim_y = ALTURA_REPOSO_CM;
int sim_buf[RETARDO_MUESTRAS + 1];
uint8_t sim_i = 0;
#endif

// El motor solo se mueve con el banco real; en MODO_SIMULADO el ESC no se toca.
void escribirESC(int us) {
#ifndef MODO_SIMULADO
  esc.writeMicroseconds(us);
#else
  (void)us;
#endif
}

// ════════════════════════════════════════════════════════════════
//  Sensor (real o simulado)
// ════════════════════════════════════════════════════════════════

#ifdef MODO_SIMULADO
// Planta identificada con sus no linealidades: apoyada en la base por debajo
// del PWM de despegue y tope físico arriba. Agrega ruido y ecos del travesaño.
float dispararSensor() {
  sim_buf[sim_i] = pwm_actual;
  sim_i = (sim_i + 1) % (RETARDO_MUESTRAS + 1);
  int u_ret = sim_buf[sim_i];
  float y_ss = Y0_PLANTA_CM + K_PLANTA * (u_ret - U0_DEFECTO);
  y_ss = constrain(y_ss, ALTURA_REPOSO_CM, 100.0f);
  sim_y += (y_ss - sim_y) * (TS_MS / 1000.0f) / TAU_PLANTA_S;
  if (random(1000) < 30) return 88.0f + random(1000) / 100.0f;   // eco del travesaño
  if (random(1000) < 10) return -1.0f;                           // sin eco
  return sim_y + (random(-40, 41) / 100.0f);
}
#else
float dispararSensor() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long dur = pulseIn(PIN_ECHO, HIGH, SENSOR_TIMEOUT_US);
  if (dur == 0) return -1.0f;
  float d = dur * 0.0343f / 2.0f;
  if (d < SENSOR_MIN_CM || d > SENSOR_MAX_CM) return -1.0f;
  return d;
}
#endif

float mediana3(float a, float b, float c) {
  if (a > b) { float t = a; a = b; b = t; }
  if (b > c) { float t = b; b = c; c = t; }
  if (a > b) { float t = a; a = b; b = t; }
  return b;
}

void aceptarLectura(float d) {
  ventana[0] = ventana[1];
  ventana[1] = ventana[2];
  ventana[2] = d;
  altura_cm = mediana3(ventana[0], ventana[1], ventana[2]);
}

void reiniciarVentana(float d) {
  ventana[0] = ventana[1] = ventana[2] = d;
  altura_cm = d;
  n_saltos = 0;
}

void actualizarSensor(unsigned long ahora) {
  crudo_cm = dispararSensor();

  if (crudo_cm < 0) {
    if (sin_eco < 255) sin_eco++;
    if (sin_eco >= SIN_ECO_MUESTRAS) sensor_ok = false;
    if (pwm_actual <= ESC_MIN_US + 50 && ahora - t_motor_off > 1000 && sin_eco >= SIN_ECO_MUESTRAS) {
      reiniciarVentana(ALTURA_REPOSO_CM);   // motor apagado y sin eco: está en la base
    }
    return;
  }

  sin_eco = 0;
  sensor_ok = true;
  if (!sensor_iniciado) {
    sensor_iniciado = true;
    reiniciarVentana(crudo_cm);
    return;
  }

  if (fabsf(crudo_cm - altura_cm) <= MAX_SALTO_CM) {
    n_saltos = 0;
    aceptarLectura(crudo_cm);
    return;
  }

  saltos[n_saltos++] = crudo_cm;
  if (n_saltos >= CONFIRMAR_SALTO) {
    float lo = saltos[0], hi = saltos[0];
    for (uint8_t i = 1; i < n_saltos; i++) {
      lo = fminf(lo, saltos[i]);
      hi = fmaxf(hi, saltos[i]);
    }
    if (hi - lo <= 5.0f) reiniciarVentana(crudo_cm);
    else n_saltos = 0;
  }
}

// ════════════════════════════════════════════════════════════════
//  PID
// ════════════════════════════════════════════════════════════════

void reiniciarPID() {
  integral = 0.0f;
  derivada_f = 0.0f;
  altura_previa = altura_cm;
}

int calcularPID() {
  const float dt = TS_MS / 1000.0f;
  float error = setpoint_cm - altura_cm;
  float dmed = (altura_cm - altura_previa) / dt;
  altura_previa = altura_cm;
  derivada_f += D_FILTRO * (dmed - derivada_f);

  float p = kp * error;
  float d = -kd * derivada_f;
  float u = u0 + p + integral + d;
  bool satura_arriba = (u >= PID_U_MAX && error > 0);
  bool satura_abajo = (u <= PID_U_MIN && error < 0);
  if (!satura_arriba && !satura_abajo) {
    integral = constrain(integral + ki * error * dt, -PID_I_MAX, PID_I_MAX);
  }
  u = u0 + p + integral + d;
  return (int)constrain(u, (float)PID_U_MIN, (float)PID_U_MAX);
}

// ════════════════════════════════════════════════════════════════
//  Estado y telemetría
// ════════════════════════════════════════════════════════════════

const char *nombreModo() {
  switch (modo) {
    case MODO_PID: return "pid";
    case MODO_MANUAL: return "manual";
    case MODO_ESCALON: return "step";
    default: return "idle";
  }
}

void enviarEstado() {
  JsonDocument doc;
  doc["type"] = "status";
  doc["uart_connected"] = true;
  doc["clients"] = ws.count();
  doc["uptime_s"] = millis() / 1000;
#ifdef USE_WIFI_STA
  doc["ip"] = WiFi.localIP().toString();
  doc["wifi_mode"] = "STA";
#else
  doc["ip"] = WiFi.softAPIP().toString();
  doc["wifi_mode"] = "AP";
#endif
  doc["control_mode"] = nombreModo();
  doc["setpoint_cm"] = setpoint_cm;
  doc["kp"] = kp;
  doc["ki"] = ki;
  doc["kd"] = kd;
  doc["u0"] = u0;
  doc["pwm"] = pwm_actual;
  doc["distancia_cm"] = altura_cm;
  doc["sensor_ok"] = sensor_ok;
  doc["failsafe"] = failsafe;
#ifdef MODO_SIMULADO
  doc["simulado"] = true;
#endif
  char buf[448];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  Serial.println(buf);                      // el PC por USB también se sincroniza
  if (ws.count() > 0) ws.textAll(buf, n);
}

void enviarTelemetria(unsigned long ahora) {
  // USB: CSV, igual que el Arduino Uno
  Serial.printf("%lu,%d,%.2f,%.2f,%.1f\n", ahora, pwm_actual, altura_cm, crudo_cm,
                modo == MODO_PID ? setpoint_cm : -1.0f);

  if (ws.count() == 0 || !ws.availableForWriteAll()) return;
  JsonDocument doc;
  doc["type"] = "telemetry";
  doc["t"] = ahora / 1000.0;
  doc["height"] = altura_cm / 100.0f;      // metros (el front-end trabaja en m)
  if (crudo_cm >= 0) doc["raw"] = crudo_cm / 100.0f;
  doc["pwm"] = pwm_actual;
  doc["mode"] = nombreModo();
  doc["ok"] = sensor_ok;
  if (modo == MODO_PID) doc["setpoint"] = setpoint_cm / 100.0f;
  char buf[200];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  ws.textAll(buf, n);
}

// ════════════════════════════════════════════════════════════════
//  Acciones (comunes a USB y WiFi)
// ════════════════════════════════════════════════════════════════

void apagarMotor() {
  if (pwm_actual > ESC_MIN_US) t_motor_off = millis();
  modo = MODO_REPOSO;
  pwm_actual = ESC_MIN_US;
  escribirESC(ESC_MIN_US);
  reiniciarPID();
}

void activarFailsafe(const char *motivo) {
  apagarMotor();
  failsafe = true;
  n_failsafe = 0;
  Serial.println("FAILSAFE");
  Serial.printf("# failsafe: %s\n", motivo);
  enviarEstado();
}

void accionPWM(int v) {
  pwm_manual = constrain(v, ESC_MIN_US, ESC_MAX_US);
  failsafe = false;
  if (pwm_manual <= ESC_MIN_US) {
    apagarMotor();
  } else {
    modo = MODO_MANUAL;
    pwm_actual = pwm_manual;
    escribirESC(pwm_actual);
  }
}

void accionSetpoint(float v) {
  if (v > 0 && v <= 1.5f) v *= 100.0f;      // llegó en metros
  setpoint_cm = constrain(v, SP_MIN_CM, SP_MAX_CM);
}

void accionGanancias(float nkp, float nki, float nkd) {
  if (nkp >= 0 && nki >= 0 && nkd >= 0) {
    kp = nkp; ki = nki; kd = nkd;           // el integral se conserva: sin salto
  }
}

void accionStart() {
  failsafe = false;
  n_failsafe = 0;
  reiniciarPID();
  modo = MODO_PID;
}

void accionEscalon() {
  failsafe = false;
  n_failsafe = 0;
  t_escalon = millis();
  modo = MODO_ESCALON;
}

void accionClear() {
  apagarMotor();
  failsafe = false;
  n_failsafe = 0;
}

// Comando de texto, igual al del Arduino Uno. Devuelve false si no se reconoce.
bool comandoTexto(char *cmd) {
  while (*cmd == ' ') cmd++;
  for (char *s = cmd; *s; s++) *s = toupper(*s);
  if (strcmp(cmd, "1") == 0) { accionEscalon(); return true; }
  if (strcmp(cmd, "2") == 0) { accionStart(); return true; }
  if (strcmp(cmd, "0") == 0) { apagarMotor(); return true; }
  if (strncmp(cmd, "PWM ", 4) == 0) { accionPWM(atoi(cmd + 4)); return true; }
  if (strncmp(cmd, "SP ", 3) == 0) { accionSetpoint(atof(cmd + 3)); return true; }
  if (strncmp(cmd, "U0 ", 3) == 0) { u0 = constrain(atoi(cmd + 3), 1500, 1900); return true; }
  if (strncmp(cmd, "PID ", 4) == 0) {
    char *p = cmd + 4;
    float a = strtof(p, &p), b = strtof(p, &p), c = strtof(p, &p);
    accionGanancias(a, b, c);
    return true;
  }
  if (strcmp(cmd, "START") == 0) { accionStart(); return true; }
  if (strcmp(cmd, "STEP") == 0) { accionEscalon(); return true; }
  if (strcmp(cmd, "STOP") == 0) { apagarMotor(); return true; }
  if (strcmp(cmd, "CLEAR") == 0) { accionClear(); return true; }
  if (strcmp(cmd, "STATUS") == 0) return true;
  if (strcmp(cmd, "H") == 0 || strcmp(cmd, "?") == 0) {
    Serial.printf("# http://%s.local  ws://%s/ws\n", MDNS_HOSTNAME, WiFi.localIP().toString().c_str());
    Serial.println("# comandos: PWM n | SP cm | PID kp ki kd | U0 us | START | STEP | STOP | CLEAR | STATUS");
    return false;
  }
  return false;
}

// Comando JSON (WebSocket o USB). Devuelve false si no cambia nada.
bool comandoJson(const char *txt, uint32_t cliente) {
  JsonDocument doc;
  if (deserializeJson(doc, txt)) {
    Serial.println("# JSON inválido");
    return false;
  }
  const char *tipo = doc["type"] | "";
  if (strcmp(tipo, "ping") == 0) {
    ws.textAll("{\"type\":\"pong\"}");
    return false;
  }
  if (strcmp(tipo, "cmd") != 0) return false;
#if !PERMITIR_MULTI_CONTROL
  if (cliente != 0 && cliente != primer_cliente) return false;   // 0 = USB, siempre manda
#endif
  const char *a = doc["action"] | "";
  if (strcmp(a, "set_pwm") == 0) accionPWM(doc["value"] | ESC_MIN_US);
  else if (strcmp(a, "set_setpoint") == 0) accionSetpoint(doc["value"] | setpoint_cm);
  else if (strcmp(a, "set_pid") == 0) accionGanancias(doc["kp"] | kp, doc["ki"] | ki, doc["kd"] | kd);
  else if (strcmp(a, "set_u0") == 0) u0 = constrain((int)(doc["value"] | u0), 1500, 1900);
  else if (strcmp(a, "start") == 0) accionStart();
  else if (strcmp(a, "start_step") == 0) accionEscalon();
  else if (strcmp(a, "stop") == 0) apagarMotor();
  else if (strcmp(a, "clear_failsafe") == 0) accionClear();
  else if (strcmp(a, "get_status") != 0) {
    Serial.printf("# acción desconocida: %s\n", a);
    return false;
  }
  return true;
}

void procesarLinea(char *linea, uint32_t cliente) {
  while (*linea == ' ' || *linea == '\t') linea++;
  if (!*linea) return;
  bool ok = (*linea == '{') ? comandoJson(linea, cliente) : comandoTexto(linea);
  if (ok) enviarEstado();
}

// ════════════════════════════════════════════════════════════════
//  WebSocket
// ════════════════════════════════════════════════════════════════

void encolar(const uint8_t *data, size_t len, uint32_t cliente) {
  portENTER_CRITICAL(&cola_mux);
  uint8_t sig = (cola_fin + 1) % COLA_N;
  if (sig != cola_ini) {                    // si la cola está llena se descarta
    size_t n = len < COLA_LARGO - 1 ? len : COLA_LARGO - 1;
    memcpy(cola[cola_fin], data, n);
    cola[cola_fin][n] = '\0';
    cola_cliente[cola_fin] = cliente;
    cola_fin = sig;
  }
  portEXIT_CRITICAL(&cola_mux);
}

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type,
               void *arg, uint8_t *data, size_t len) {
  (void)server;
  if (type == WS_EVT_CONNECT) {
    if (primer_cliente == 0) primer_cliente = client->id();
    encolar((const uint8_t *)"STATUS", 6, client->id());   // estado al recién llegado
  } else if (type == WS_EVT_DISCONNECT) {
    if (client->id() == primer_cliente) primer_cliente = 0;
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo *)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
      encolar(data, len, client->id());
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  WiFi y servidor web
// ════════════════════════════════════════════════════════════════

bool wifi_conectado = false;

void iniciarWifi() {
#ifdef USE_WIFI_STA
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);                     // menos latencia en el WebSocket
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASS);
  Serial.printf("# WiFi: conectando a \"%s\"...\n", WIFI_STA_SSID);
#else
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASS, WIFI_AP_CHANNEL);
  Serial.printf("# WiFi AP \"%s\" en http://%s/\n", WIFI_AP_SSID, WiFi.softAPIP().toString().c_str());
#endif
}

void vigilarWifi(unsigned long ahora) {
#ifdef USE_WIFI_STA
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifi_conectado) {
      wifi_conectado = true;
      Serial.printf("# WiFi conectado: http://%s/  ·  http://%s.local/\n",
                    WiFi.localIP().toString().c_str(), MDNS_HOSTNAME);
      enviarEstado();
    }
    return;
  }
  wifi_conectado = false;
  if (ahora - t_wifi_reintento < 10000) return;
  t_wifi_reintento = ahora;
  WiFi.disconnect();
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASS);
#else
  (void)ahora;
#endif
}

void iniciarServidor() {
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
  server.onNotFound([](AsyncWebServerRequest *req) {
    if (req->method() == HTTP_GET && LittleFS.exists("/index.html")) {
      req->send(LittleFS, "/index.html", "text/html");
    } else {
      req->send(404, "text/plain", "Falta la interfaz en LittleFS: ejecuta scripts/deploy_frontend y sube data/.");
    }
  });
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.begin();
}

// ════════════════════════════════════════════════════════════════
//  setup / loop
// ════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("# Monocoptero ESP32 — firmware unificado (USB + WiFi)");

#ifndef MODO_SIMULADO
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);
#else
  Serial.println("# MODO_SIMULADO: planta FOPDT simulada, motor sin mover");
  for (uint8_t i = 0; i <= RETARDO_MUESTRAS; i++) sim_buf[i] = ESC_MIN_US;
#endif

  ESP32PWM::allocateTimer(0);
  esc.setPeriodHertz(50);
  esc.attach(PIN_ESC, ESC_MIN_US, ESC_MAX_US);
  // Por defecto el temporizador es de 10 bits (pasos de 19.5 µs a 50 Hz). Con 16 bits
  // son 0.3 µs. Va después de attach(): attach() vuelve a poner los 10 bits.
  esc.setTimerWidth(16);
  esc.writeMicroseconds(ESC_MIN_US);
#if ESC_CALIBRAR && !defined(MODO_SIMULADO)
  Serial.println("# calibrando ESC (¡hélice despejada!): 1000 -> 2000 -> 1000 us");
  delay(2000);
  esc.writeMicroseconds(ESC_MAX_US);
  delay(2000);
  esc.writeMicroseconds(ESC_MIN_US);
  delay(2000);
#else
  delay(1500);
#endif

  if (!LittleFS.begin()) Serial.println("# LittleFS no monta: la página web no estará disponible");
  iniciarWifi();
  if (MDNS.begin(MDNS_HOSTNAME)) MDNS.addService("http", "tcp", 80);
  iniciarServidor();

  t_muestra = t_estado = t_ws_limpieza = t_wifi_reintento = millis();
  Serial.println("READY");
  Serial.println("tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm");
  enviarEstado();
}

void loop() {
  unsigned long ahora = millis();
  vigilarWifi(ahora);

  // Comandos por USB
  static char linea[COLA_LARGO];
  static size_t n_linea = 0;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (n_linea > 0) {
        linea[n_linea] = '\0';
        procesarLinea(linea, 0);
        n_linea = 0;
      }
    } else if (n_linea < sizeof(linea) - 1) {
      linea[n_linea++] = c;
    }
  }

  // Comandos por WiFi (encolados por el callback)
  while (cola_ini != cola_fin) {
    char cmd[COLA_LARGO];
    uint32_t cliente;
    portENTER_CRITICAL(&cola_mux);
    memcpy(cmd, cola[cola_ini], COLA_LARGO);
    cliente = cola_cliente[cola_ini];
    cola_ini = (cola_ini + 1) % COLA_N;
    portEXIT_CRITICAL(&cola_mux);
    procesarLinea(cmd, cliente);
  }

  if (ahora - t_ws_limpieza >= 1000) {
    t_ws_limpieza = ahora;
    ws.cleanupClients(8);
  }
  if (ahora - t_estado >= 2000) {
    t_estado = ahora;
    enviarEstado();
  }

  if (ahora - t_muestra < TS_MS) return;
  t_muestra += TS_MS;
  if (ahora - t_muestra > TS_MS) t_muestra = ahora;

  actualizarSensor(ahora);

  if (modo != MODO_REPOSO) {
    n_failsafe = (altura_cm >= FAILSAFE_CM) ? n_failsafe + 1 : 0;
    if (n_failsafe >= FAILSAFE_MUESTRAS) {
      activarFailsafe("altura >= 85 cm");
    } else if (modo == MODO_PID && sin_eco >= SIN_SENSOR_PID) {
      activarFailsafe("sin lectura del sensor en PID");
    }
  }

  switch (modo) {
    case MODO_PID:
      pwm_actual = calcularPID();
      break;
    case MODO_MANUAL:
      pwm_actual = pwm_manual;
      break;
    case MODO_ESCALON: {
      unsigned long t = ahora - t_escalon;
      if (t < ESCALON_PREVIO_MS) pwm_actual = u0;
      else if (t < ESCALON_TOTAL_MS) pwm_actual = u0 + DELTA_U_ESCALON;
      else {
        apagarMotor();
        Serial.println("FIN_PRUEBA");
        enviarEstado();
      }
      break;
    }
    default:
      pwm_actual = ESC_MIN_US;
      break;
  }
  escribirESC(pwm_actual);
  enviarTelemetria(ahora);
}
