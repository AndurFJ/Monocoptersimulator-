/**
 * arduino_serial.ino — Firmware Arduino Uno para control en tiempo real
 * del banco de pruebas de 1-GDL del Monocóptero.
 *
 * Protocolo serial (115200 baudios):
 *
 *   COMANDOS QUE RECIBE (texto simple, terminados en \n):
 *     PWM 1500        → modo manual, motor a 1500 µs
 *     SP 30.0         → setpoint del PID a 30.0 cm
 *     PID 2.0 0.5 0.8 → ganancias Kp Ki Kd
 *     START           → iniciar control PID
 *     STOP            → detener motor (PWM → 1000 µs)
 *     STEP            → prueba de escalón (hovering 5 s → escalón 10 s → apagar)
 *     STATUS          → pedir estado actual
 *     CLEAR           → rearmar tras failsafe
 *
 *   TELEMETRÍA QUE ENVÍA (CSV cada 50 ms):
 *     tiempo_ms,pwm_us,altura_cm
 *
 *   ESTADO (al cambiar de modo y cada 5 s):
 *     STATUS:mode,setpoint_cm,kp,ki,kd,pwm,distancia_cm,failsafe
 *
 *   EVENTOS:
 *     FAILSAFE    → corte por altura > FAILSAFE_CM cm
 *     FIN_PRUEBA  → la prueba de escalón terminó
 *     READY       → firmware listo para recibir comandos
 *
 * Hardware:
 *   - ESC en pin 9 (Servo.h, 50 Hz)
 *   - HC-SR04: TRIG en pin 7, ECHO en pin 6
 */

#include <Servo.h>

// ── Pines ────────────────────────────────────────────────────────
#define PIN_ESC   9
#define PIN_TRIG  7
#define PIN_ECHO  6

// ── Límites ESC ─────────────────────────────────────────────────
#define ESC_MIN_US  1000
#define ESC_MAX_US  2000

// ── Punto de equilibrio calibrado ───────────────────────────────
// Este valor lo obtuviste experimentalmente: el carro se queda
// estático cuando el motor recibe ~1762 µs. El PID suma/resta
// sobre este punto para subir o bajar.
#define PWM_HOVER   1762

// ── Failsafe ────────────────────────────────────────────────────
// Límite de seguridad: si el sensor lee por encima de esto
// durante FAILSAFE_COUNT muestreos consecutivos, corta el motor.
#define FAILSAFE_CM 90.0f
// Lecturas consecutivas > FAILSAFE_CM necesarias para activar
#define FAILSAFE_COUNT 3

// ── Escalón (igual que tu código original) ──────────────────────
#define STEP_U0         1762
#define STEP_DELTA_U    50
#define STEP_HOVER_MS   5000UL
#define STEP_TOTAL_MS   15000UL

// ── Muestreo ────────────────────────────────────────────────────
#define SAMPLE_MS  50    // 20 Hz (50 ms)

// ── PID (valores por defecto, se pueden cambiar desde la web) ───
#define DEFAULT_KP  2.0f
#define DEFAULT_KI  0.5f
#define DEFAULT_KD  0.8f
#define PID_INTEGRAL_MAX 200.0f
#define PID_OUTPUT_MAX   500.0f

// ── Calibración ESC ─────────────────────────────────────────────
// true = min→max→min al arrancar (6 s). Pon false si el ESC ya
// está calibrado y quieres arrancar rápido.
#define ESC_CALIBRATE false

// ══════════════════════════════════════════════════════════════
// ██  Variables globales
// ══════════════════════════════════════════════════════════════

Servo esc;

enum Mode : uint8_t { IDLE, PID_CTRL, MANUAL_CTRL, STEP_TEST };
static Mode mode = IDLE;
static int pwm_actual = ESC_MIN_US;
static float distancia_cm = -1.0f;   // -1 = aún sin lectura válida
static bool failsafe_active = false;
static uint8_t failsafe_counter = 0; // lecturas consecutivas > límite

// PID
static float kp = DEFAULT_KP;
static float ki = DEFAULT_KI;
static float kd = DEFAULT_KD;
static float setpoint_cm = 30.0f;
static float pid_integral = 0.0f;
static float pid_prev_error = 0.0f;
static unsigned long pid_prev_time = 0;

// Escalón
static unsigned long step_start = 0;

// Timing
static unsigned long t_inicio = 0;
static unsigned long t_previo = 0;
static unsigned long t_status_auto = 0;

// Buffer de recepción serial
static char rx_buf[64];
static uint8_t rx_len = 0;

// ══════════════════════════════════════════════════════════════
// ██  Sensor HC-SR04 — lectura directa
// ══════════════════════════════════════════════════════════════

/**
 * Hace UNA lectura cruda del HC-SR04.
 * Devuelve la distancia en cm, o -1.0 si no hubo eco (timeout).
 */
static float leerPulso() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long dur = pulseIn(PIN_ECHO, HIGH, 30000);
  if (dur == 0) return -1.0f;  // timeout → sin eco
  float d = (dur * 0.0343f) / 2.0f;
  if (d < 1.0f || d > 400.0f) return -1.0f;  // fuera de rango
  return d;
}

/**
 * Lectura robusta: toma 3 pulsos rápidos y devuelve la mediana.
 * La mediana rechaza lecturas espurias (1 de cada 3 mala → se descarta).
 * Si no hay ninguna lectura válida, devuelve el último valor conocido.
 */
static float leerSensor() {
  float a = leerPulso();
  float b = leerPulso();
  float c = leerPulso();

  // Contar válidas y tomar la mediana de las que haya
  float vals[3];
  uint8_t n = 0;
  if (a >= 0) vals[n++] = a;
  if (b >= 0) vals[n++] = b;
  if (c >= 0) vals[n++] = c;

  if (n == 0) {
    // Ninguna lectura válida: mantener la anterior
    return (distancia_cm > 0) ? distancia_cm : 0.0f;
  }

  // Ordenar (insertion sort de 3 o menos)
  for (uint8_t i = 1; i < n; i++) {
    float tmp = vals[i];
    uint8_t j = i;
    while (j > 0 && vals[j - 1] > tmp) { vals[j] = vals[j - 1]; j--; }
    vals[j] = tmp;
  }
  float mediana = vals[n / 2];

  // Filtro paso bajo suave: 50% anterior + 50% nueva lectura.
  // Mucho más reactivo que 75/25; la mediana ya eliminó el ruido.
  if (distancia_cm < 0) return mediana;  // primera lectura válida
  return 0.5f * distancia_cm + 0.5f * mediana;
}

// ══════════════════════════════════════════════════════════════
// ██  PID
// ══════════════════════════════════════════════════════════════

static int computePID(float medida, unsigned long ahora) {
  float error = setpoint_cm - medida;
  float dt = (ahora - pid_prev_time) / 1000.0f;
  if (dt <= 0.0f || dt > 1.0f) {
    pid_prev_error = error;
    pid_prev_time = ahora;
    return constrain(PWM_HOVER + (int)(kp * error), ESC_MIN_US, ESC_MAX_US);
  }
  float p = kp * error;
  pid_integral += ki * error * dt;
  pid_integral = constrain(pid_integral, -PID_INTEGRAL_MAX, PID_INTEGRAL_MAX);
  float d_term = kd * (error - pid_prev_error) / dt;
  pid_prev_error = error;
  pid_prev_time = ahora;
  float output = constrain(p + pid_integral + d_term, -PID_OUTPUT_MAX, PID_OUTPUT_MAX);
  return constrain(PWM_HOVER + (int)output, ESC_MIN_US, ESC_MAX_US);
}

static void resetPID() {
  pid_integral = 0.0f;
  pid_prev_error = 0.0f;
  pid_prev_time = millis();
}

// ══════════════════════════════════════════════════════════════
// ██  Escalón
// ══════════════════════════════════════════════════════════════

static int computeStep(unsigned long ahora) {
  unsigned long rel = ahora - step_start;
  if (rel < STEP_HOVER_MS) return STEP_U0;
  if (rel < STEP_TOTAL_MS) return STEP_U0 + STEP_DELTA_U;
  // Fin de la prueba
  mode = IDLE;
  Serial.println(F("FIN_PRUEBA"));
  return ESC_MIN_US;
}

// ══════════════════════════════════════════════════════════════
// ██  Failsafe — con debounce (N lecturas consecutivas)
// ══════════════════════════════════════════════════════════════

static void activateFailsafe() {
  pwm_actual = ESC_MIN_US;
  esc.writeMicroseconds(ESC_MIN_US);
  mode = IDLE;
  failsafe_active = true;
  failsafe_counter = 0;
  resetPID();
  Serial.println(F("FAILSAFE"));
  sendStatus();
}

/**
 * Evalúa el failsafe con debounce.
 * Solo se activa si hay FAILSAFE_COUNT lecturas consecutivas
 * por encima del límite. Esto evita falsos positivos por una
 * lectura espuria del sensor ultrasónico.
 * Devuelve true si se activó.
 */
static bool checkFailsafe(float dist) {
  if (mode == IDLE) {
    failsafe_counter = 0;
    return false;
  }
  if (dist >= FAILSAFE_CM) {
    failsafe_counter++;
    if (failsafe_counter >= FAILSAFE_COUNT) {
      activateFailsafe();
      return true;
    }
  } else {
    failsafe_counter = 0;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════
// ██  Estado — formato: STATUS:mode,sp,kp,ki,kd,pwm,dist,fs
// ══════════════════════════════════════════════════════════════

static const char* modeStr() {
  switch (mode) {
    case PID_CTRL:    return "pid";
    case MANUAL_CTRL: return "manual";
    case STEP_TEST:   return "step";
    default:          return "idle";
  }
}

static void sendStatus() {
  Serial.print(F("STATUS:"));
  Serial.print(modeStr());       Serial.print(',');
  Serial.print(setpoint_cm, 1);  Serial.print(',');
  Serial.print(kp, 2);           Serial.print(',');
  Serial.print(ki, 2);           Serial.print(',');
  Serial.print(kd, 2);           Serial.print(',');
  Serial.print(pwm_actual);      Serial.print(',');
  Serial.print(distancia_cm < 0 ? 0.0f : distancia_cm, 1); Serial.print(',');
  Serial.println(failsafe_active ? '1' : '0');
}

// ══════════════════════════════════════════════════════════════
// ██  Parseo de comandos recibidos desde la web
// ══════════════════════════════════════════════════════════════

static void handleCommand(const char* cmd) {
  // ── PWM 1500 — modo manual directo ──
  if (strncmp(cmd, "PWM ", 4) == 0) {
    int v = atoi(cmd + 4);
    v = constrain(v, ESC_MIN_US, ESC_MAX_US);
    mode = MANUAL_CTRL;
    failsafe_active = false;
    failsafe_counter = 0;
    pwm_actual = v;
    esc.writeMicroseconds(pwm_actual);
    sendStatus();
    return;
  }
  // ── SP 30.0 — cambiar setpoint del PID ──
  if (strncmp(cmd, "SP ", 3) == 0) {
    setpoint_cm = atof(cmd + 3);
    sendStatus();
    return;
  }
  // ── PID 2.0 0.5 0.8 — cambiar ganancias ──
  if (strncmp(cmd, "PID ", 4) == 0) {
    char* p = (char*)(cmd + 4);
    kp = strtod(p, &p);
    ki = strtod(p, &p);
    kd = strtod(p, &p);
    pid_integral = 0.0f;  // reset integral al cambiar ganancias
    sendStatus();
    return;
  }
  // ── START — iniciar control PID ──
  if (strcmp(cmd, "START") == 0) {
    mode = PID_CTRL;
    failsafe_active = false;
    failsafe_counter = 0;
    resetPID();
    t_inicio = millis();
    t_previo = t_inicio;
    sendStatus();
    return;
  }
  // ── STOP — detener motor ──
  if (strcmp(cmd, "STOP") == 0) {
    mode = IDLE;
    pwm_actual = ESC_MIN_US;
    esc.writeMicroseconds(ESC_MIN_US);
    resetPID();
    failsafe_counter = 0;
    sendStatus();
    return;
  }
  // ── STEP — prueba de escalón ──
  if (strcmp(cmd, "STEP") == 0) {
    mode = STEP_TEST;
    failsafe_active = false;
    failsafe_counter = 0;
    step_start = millis();
    t_inicio = step_start;
    t_previo = t_inicio;
    sendStatus();
    return;
  }
  // ── STATUS — pedir estado ──
  if (strcmp(cmd, "STATUS") == 0) {
    sendStatus();
    return;
  }
  // ── CLEAR — rearmar tras failsafe ──
  if (strcmp(cmd, "CLEAR") == 0) {
    failsafe_active = false;
    failsafe_counter = 0;
    mode = IDLE;
    pwm_actual = ESC_MIN_US;
    esc.writeMicroseconds(ESC_MIN_US);
    resetPID();
    sendStatus();
    return;
  }
}

// ══════════════════════════════════════════════════════════════
// ██  SETUP
// ══════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  esc.attach(PIN_ESC);
  esc.writeMicroseconds(ESC_MIN_US);

#if ESC_CALIBRATE
  // Secuencia de calibración del ESC: min → max → min (6 s en total)
  delay(2000);
  esc.writeMicroseconds(ESC_MAX_US);
  delay(2000);
  esc.writeMicroseconds(ESC_MIN_US);
  delay(2000);
#else
  delay(1000);  // Dar tiempo al ESC para inicializar
#endif

  // Tomar una primera lectura real del sensor para inicializar
  // distancia_cm con un valor real (no 0 ni -1).
  for (uint8_t i = 0; i < 5; i++) {
    float d = leerPulso();
    if (d > 0) {
      distancia_cm = d;
      break;
    }
    delay(60);
  }
  // Si tras 5 intentos no hay lectura, dejar en 0
  if (distancia_cm < 0) distancia_cm = 0.0f;

  t_inicio = millis();
  t_previo = t_inicio;
  t_status_auto = t_inicio;
  pid_prev_time = t_inicio;

  Serial.println(F("READY"));
  sendStatus();
}

// ══════════════════════════════════════════════════════════════
// ██  LOOP PRINCIPAL
// ══════════════════════════════════════════════════════════════

void loop() {
  unsigned long ahora = millis();

  // ── Leer comandos del Serial ──────────────────────────
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (rx_len > 0) {
        rx_buf[rx_len] = '\0';
        handleCommand(rx_buf);
        rx_len = 0;
      }
    } else if (rx_len < sizeof(rx_buf) - 1) {
      rx_buf[rx_len++] = c;
    }
  }

  // ── Estado periódico (cada 5 s) ───────────────────────
  if (ahora - t_status_auto >= 5000) {
    t_status_auto = ahora;
    sendStatus();
  }

  // ── Motor apagado cuando está en reposo ───────────────
  if (mode == IDLE) {
    esc.writeMicroseconds(ESC_MIN_US);
  }

  // ── Muestreo a 20 Hz (50 ms) ─────────────────────────
  if (ahora - t_previo >= SAMPLE_MS) {
    t_previo = ahora;

    // Leer sensor ultrasónico (mediana de 3 + filtro paso bajo)
    distancia_cm = leerSensor();

    // Failsafe con debounce: requiere N lecturas consecutivas > límite
    if (checkFailsafe(distancia_cm)) {
      return;
    }

    // Computar salida según el modo activo
    switch (mode) {
      case PID_CTRL:
        pwm_actual = computePID(distancia_cm, ahora);
        esc.writeMicroseconds(pwm_actual);
        break;
      case MANUAL_CTRL:
        esc.writeMicroseconds(pwm_actual);
        break;
      case STEP_TEST:
        pwm_actual = computeStep(ahora);
        esc.writeMicroseconds(pwm_actual);
        break;
      case IDLE:
      default:
        pwm_actual = ESC_MIN_US;
        break;
    }

    // Telemetría CSV (siempre, para monitoreo continuo)
    unsigned long t_rel = ahora - t_inicio;
    Serial.print(t_rel);       Serial.print(',');
    Serial.print(pwm_actual);  Serial.print(',');
    Serial.println(distancia_cm, 2);
  }
}
