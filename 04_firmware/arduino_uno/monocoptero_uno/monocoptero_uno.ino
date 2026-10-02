/*
 * monocoptero_uno.ino — Firmware del banco Monocóptero 1-GDL para Arduino Uno
 * Universidad del Magdalena · Control Análogo
 *
 * Hardware (ver 06_presentacion/diagrama_conexiones.jpg):
 *   ESC 30 A (señal)  → D9   (Servo.h, 50 Hz, 1000–2000 µs)
 *   HC-SR04 TRIG      → D7
 *   HC-SR04 ECHO      → D6
 *   HC-SR04 VCC/GND   → 5V / GND   (GND común con la fuente de 12 V del ESC)
 *   El HC-SR04 está en la BASE apuntando hacia ARRIBA, al carro.
 *
 * Protocolo serie (115200 baudios) — idéntico al del firmware ESP32,
 * ver 04_firmware/PROTOCOLO.md:
 *   Comandos (texto, uno por línea):
 *     PWM 1800        modo manual, motor a 1800 µs (lazo abierto)
 *     SP 30           setpoint del PID en cm
 *     PID 4 2.5 0.3   ganancias Kp [µs/cm], Ki [µs/(cm·s)], Kd [µs·s/cm]
 *     U0 1762         PWM de equilibrio (feedforward del PID y base del escalón)
 *     START           control PID (también '2')
 *     STEP            prueba de escalón: 5 s en U0 → 10 s en U0+50 → apagar (también '1')
 *     STOP            motor a 1000 µs (también '0')
 *     CLEAR           reconocer un failsafe (el motor sigue apagado)
 *     STATUS          pedir el estado
 *   Telemetría (CSV cada 50 ms, SIEMPRE, también con el motor apagado):
 *     tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm
 *       altura_cm   = altura filtrada (mediana de 3 + rechazo de saltos)
 *       crudo_cm    = lectura cruda del pulso (-1 = sin eco)
 *       setpoint_cm = objetivo del PID (-1 si no está en PID)
 *   Estado:  STATUS:modo,sp,kp,ki,kd,pwm,altura,failsafe,u0,sensor_ok
 *   Eventos: READY · FAILSAFE · FIN_PRUEBA · # comentario
 *
 * Por qué el filtro del sensor: el carro es una tabla angosta y el haz del
 * HC-SR04 (~15°) a veces no rebota en él sino en el travesaño superior
 * (≈ 90 cm) o no vuelve (timeout). Esas lecturas falsas disparaban el
 * failsafe con el carro a 30 cm y dejaban la altura "pegada". Aquí:
 *   1) un solo disparo por periodo (los 3 disparos seguidos generaban ecos fantasma),
 *   2) se rechaza todo salto > MAX_SALTO_CM en 50 ms (el carro no se teletransporta),
 *      salvo que 3 lecturas seguidas confirmen la nueva altura,
 *   3) mediana de 3 de las lecturas aceptadas,
 *   4) failsafe solo con FAILSAFE_MUESTRAS lecturas filtradas seguidas ≥ 85 cm.
 */

#include <Servo.h>

// ── Pines ───────────────────────────────────────────────────────
#define PIN_ESC   9
#define PIN_TRIG  7
#define PIN_ECHO  6

// ── ESC ─────────────────────────────────────────────────────────
#define ESC_MIN_US 1000
#define ESC_MAX_US 2000
// 1 = secuencia de calibración min→max→min al encender (¡hélice despejada!)
#define ESC_CALIBRAR 0

// ── Muestreo ────────────────────────────────────────────────────
#define TS_MS 50                     // Ts = 50 ms (20 Hz), igual que el ensayo Fit 3

// ── Sensor HC-SR04 ──────────────────────────────────────────────
#define SENSOR_TIMEOUT_US   12000UL  // ≈ 2 m de ida y vuelta: más lejos no hay nada útil
#define SENSOR_MIN_CM       2.0f     // zona ciega del HC-SR04
#define SENSOR_MAX_CM       120.0f   // por encima del travesaño = lectura inválida
#define MAX_SALTO_CM        12.0f    // máx. desplazamiento creíble en 50 ms (2.4 m/s)
#define CONFIRMAR_SALTO     3        // lecturas coherentes para aceptar un salto real
#define ALTURA_REPOSO_CM    11.0f    // lectura con el carro apoyado en los resortes
#define SIN_ECO_MUESTRAS    10       // 0.5 s sin eco → sensor_ok = 0

// ── Seguridad ───────────────────────────────────────────────────
#define FAILSAFE_CM         85.0f    // zona inestable: cortar motor
#define FAILSAFE_MUESTRAS   3        // 150 ms seguidos por encima del límite
#define SIN_SENSOR_PID      20       // 1 s sin sensor en PID → failsafe

// ── Planta identificada (Fit 3) y PID ───────────────────────────
// Gp(s) = 0.4302 e^(-0.1188 s) / (1.5719 s + 1), punto de operación (1762 µs, 13.45 cm)
#define U0_DEFECTO      1762         // PWM de equilibrio [µs]
#define DELTA_U_ESCALON 50           // escalón de identificación [µs]
#define ESCALON_PREVIO_MS 5000UL
#define ESCALON_TOTAL_MS  15000UL
// Sintonía SIMC (tau_c = 0.8 s) sobre el modelo identificado: ≈2 % de sobrepico, ts ≈ 2 s
#define KP_DEFECTO 4.0f              // µs/cm
#define KI_DEFECTO 2.5f              // µs/(cm·s)
#define KD_DEFECTO 0.3f              // µs·s/cm (derivada de la medida, filtrada)
#define SP_DEFECTO 30.0f             // cm
#define SP_MIN_CM  12.0f             // por debajo el carro está apoyado (zona muerta)
#define SP_MAX_CM  80.0f             // por encima, zona inestable / failsafe
#define PID_U_MIN  1550              // no dejarlo caer en picada sobre los resortes
#define PID_U_MAX  1950
#define PID_I_MAX  250.0f            // anti-windup [µs]
#define D_FILTRO   0.3f              // peso de la nueva derivada (filtro de 1.er orden)

// Modos (uint8_t en vez de enum: el IDE de Arduino genera prototipos antes de los tipos)
#define MODO_REPOSO 0
#define MODO_PID    1
#define MODO_MANUAL 2
#define MODO_ESCALON 3

Servo esc;

uint8_t modo = MODO_REPOSO;
int pwm_actual = ESC_MIN_US;
int pwm_manual = ESC_MIN_US;
int u0 = U0_DEFECTO;
bool failsafe = false;

// Sensor
float altura_cm = ALTURA_REPOSO_CM;  // altura filtrada
float crudo_cm = -1.0f;              // última lectura cruda (-1 = sin eco)
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

char rx[48];
uint8_t rx_n = 0;

// ════════════════════════════════════════════════════════════════
//  Sensor
// ════════════════════════════════════════════════════════════════

// Un disparo del HC-SR04. Devuelve cm o -1 si no hubo eco válido.
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

// Lee el sensor y actualiza altura_cm (filtrada), crudo_cm y sensor_ok.
void actualizarSensor(unsigned long ahora) {
  crudo_cm = dispararSensor();

  if (crudo_cm < 0) {
    if (sin_eco < 255) sin_eco++;
    if (sin_eco >= SIN_ECO_MUESTRAS) sensor_ok = false;
    // Motor apagado más de 1 s y sin eco: el carro está apoyado en la base
    // (evita que la altura se quede "pegada" en el último valor).
    if (pwm_actual <= ESC_MIN_US + 50 && ahora - t_motor_off > 1000 && sin_eco >= SIN_ECO_MUESTRAS) {
      reiniciarVentana(ALTURA_REPOSO_CM);
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

  if (fabs(crudo_cm - altura_cm) <= MAX_SALTO_CM) {
    n_saltos = 0;
    aceptarLectura(crudo_cm);
    return;
  }

  // Salto grande: posible eco del travesaño. Se acepta solo si se repite.
  saltos[n_saltos++] = crudo_cm;
  if (n_saltos >= CONFIRMAR_SALTO) {
    float lo = saltos[0], hi = saltos[0];
    for (uint8_t i = 1; i < n_saltos; i++) {
      if (saltos[i] < lo) lo = saltos[i];
      if (saltos[i] > hi) hi = saltos[i];
    }
    if (hi - lo <= 5.0f) {
      reiniciarVentana(crudo_cm);        // el carro de verdad está allá
    } else {
      n_saltos = 0;                      // ruido incoherente: descartar
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  PID (posición, derivada sobre la medida, anti-windup condicional)
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
  // Integrar solo si no empuja más hacia la saturación
  bool satura_arriba = (u >= PID_U_MAX && error > 0);
  bool satura_abajo = (u <= PID_U_MIN && error < 0);
  if (!satura_arriba && !satura_abajo) {
    integral += ki * error * dt;
    integral = constrain(integral, -PID_I_MAX, PID_I_MAX);
  }
  u = u0 + p + integral + d;
  return (int)constrain(u, (float)PID_U_MIN, (float)PID_U_MAX);
}

// ════════════════════════════════════════════════════════════════
//  Estado y comandos
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
  Serial.print(F("STATUS:"));
  Serial.print(nombreModo()); Serial.print(',');
  Serial.print(setpoint_cm, 1); Serial.print(',');
  Serial.print(kp, 3); Serial.print(',');
  Serial.print(ki, 3); Serial.print(',');
  Serial.print(kd, 3); Serial.print(',');
  Serial.print(pwm_actual); Serial.print(',');
  Serial.print(altura_cm, 1); Serial.print(',');
  Serial.print(failsafe ? '1' : '0'); Serial.print(',');
  Serial.print(u0); Serial.print(',');
  Serial.println(sensor_ok ? '1' : '0');
}

void apagarMotor() {
  if (pwm_actual > ESC_MIN_US) t_motor_off = millis();
  modo = MODO_REPOSO;
  pwm_actual = ESC_MIN_US;
  esc.writeMicroseconds(ESC_MIN_US);
  reiniciarPID();
}

void activarFailsafe(const __FlashStringHelper *motivo) {
  apagarMotor();
  failsafe = true;
  n_failsafe = 0;
  Serial.println(F("FAILSAFE"));
  Serial.print(F("# failsafe: "));
  Serial.println(motivo);
  enviarEstado();
}

// Mayúsculas in situ para aceptar "start", "Start", etc.
void aMayusculas(char *s) {
  for (; *s; s++) if (*s >= 'a' && *s <= 'z') *s -= 32;
}

void procesarComando(char *cmd) {
  while (*cmd == ' ') cmd++;
  aMayusculas(cmd);

  if (strcmp(cmd, "1") == 0) strcpy(cmd, "STEP");
  else if (strcmp(cmd, "2") == 0) strcpy(cmd, "START");
  else if (strcmp(cmd, "0") == 0) strcpy(cmd, "STOP");

  if (strncmp(cmd, "PWM ", 4) == 0) {
    pwm_manual = constrain(atoi(cmd + 4), ESC_MIN_US, ESC_MAX_US);
    failsafe = false;
    if (pwm_manual <= ESC_MIN_US) {
      apagarMotor();                     // PWM 1000 = motor apagado
    } else {
      modo = MODO_MANUAL;
      pwm_actual = pwm_manual;
      esc.writeMicroseconds(pwm_actual);
    }
  } else if (strncmp(cmd, "SP ", 3) == 0) {
    setpoint_cm = constrain(atof(cmd + 3), SP_MIN_CM, SP_MAX_CM);
  } else if (strncmp(cmd, "PID ", 4) == 0) {
    char *p = cmd + 4;
    float nkp = strtod(p, &p), nki = strtod(p, &p), nkd = strtod(p, &p);
    if (nkp >= 0 && nki >= 0 && nkd >= 0) {
      kp = nkp; ki = nki; kd = nkd;      // el integral se conserva: cambio sin salto
    }
  } else if (strncmp(cmd, "U0 ", 3) == 0) {
    u0 = constrain(atoi(cmd + 3), 1500, 1900);
  } else if (strcmp(cmd, "START") == 0) {
    failsafe = false;
    n_failsafe = 0;
    reiniciarPID();
    modo = MODO_PID;
  } else if (strcmp(cmd, "STEP") == 0) {
    failsafe = false;
    n_failsafe = 0;
    t_escalon = millis();
    modo = MODO_ESCALON;
  } else if (strcmp(cmd, "STOP") == 0) {
    apagarMotor();
  } else if (strcmp(cmd, "CLEAR") == 0) {
    apagarMotor();
    failsafe = false;
    n_failsafe = 0;
  } else if (strcmp(cmd, "STATUS") != 0) {
    Serial.print(F("# comando desconocido: "));
    Serial.println(cmd);
    return;
  }
  enviarEstado();
}

void leerSerie() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (rx_n > 0) {
        rx[rx_n] = '\0';
        procesarComando(rx);
        rx_n = 0;
      }
    } else if (rx_n < sizeof(rx) - 1) {
      rx[rx_n++] = c;
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  setup / loop
// ════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);

  esc.attach(PIN_ESC, ESC_MIN_US, ESC_MAX_US);
  esc.writeMicroseconds(ESC_MIN_US);
#if ESC_CALIBRAR
  Serial.println(F("# calibrando ESC: 2000 us (2 s) -> 1000 us (2 s)"));
  delay(2000);
  esc.writeMicroseconds(ESC_MAX_US);
  delay(2000);
  esc.writeMicroseconds(ESC_MIN_US);
  delay(2000);
#else
  delay(1500);                           // el ESC se arma con 1000 µs
#endif

  t_muestra = t_estado = millis();
  Serial.println(F("READY"));
  Serial.println(F("tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm"));
  enviarEstado();
}

void loop() {
  unsigned long ahora = millis();
  leerSerie();

  if (ahora - t_estado >= 2000) {
    t_estado = ahora;
    enviarEstado();
  }

  if (ahora - t_muestra < TS_MS) return;
  t_muestra += TS_MS;
  if (ahora - t_muestra > TS_MS) t_muestra = ahora;   // si se atrasó, no acumular

  actualizarSensor(ahora);

  // Failsafe por altura: solo con el motor encendido y con la altura FILTRADA
  if (modo != MODO_REPOSO) {
    n_failsafe = (altura_cm >= FAILSAFE_CM) ? n_failsafe + 1 : 0;
    if (n_failsafe >= FAILSAFE_MUESTRAS) {
      activarFailsafe(F("altura >= 85 cm"));
    } else if (modo == MODO_PID && sin_eco >= SIN_SENSOR_PID) {
      activarFailsafe(F("sin lectura del sensor en PID"));
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
      if (t < ESCALON_PREVIO_MS) {
        pwm_actual = u0;
      } else if (t < ESCALON_TOTAL_MS) {
        pwm_actual = u0 + DELTA_U_ESCALON;
      } else {
        apagarMotor();
        Serial.println(F("FIN_PRUEBA"));
        enviarEstado();
      }
      break;
    }
    default:
      pwm_actual = ESC_MIN_US;
      break;
  }
  esc.writeMicroseconds(pwm_actual);

  // Telemetría: SIEMPRE, también en reposo, para ver el sensor en tiempo real
  Serial.print(ahora); Serial.print(',');
  Serial.print(pwm_actual); Serial.print(',');
  Serial.print(altura_cm, 2); Serial.print(',');
  Serial.print(crudo_cm, 2); Serial.print(',');
  Serial.println(modo == MODO_PID ? setpoint_cm : -1.0f, 1);
}
