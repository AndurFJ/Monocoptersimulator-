#include <Servo.h>

Servo esc;
const int PIN_ESC = 9;
const int PIN_TRIG = 7;
const int PIN_ECHO = 6;

const int U0 = 1762;         // Punto de hovering calibrado
const int DELTA_U = 50;      // Escalón seguro (1812 us)
const int U_FINAL = U0 + DELTA_U;

unsigned long t_inicio = 0;
unsigned long t_previo = 0;
const unsigned long TS_MS = 50; // Periodo de muestreo determinístico

int pwm_actual = 1000;
bool prueba_activa = false;
float distancia_cm = 20.0;

float leerUltrasonico() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long duracion = pulseIn(PIN_ECHO, HIGH, 30000);
  if (duracion == 0) return distancia_cm; 
  return (duracion * 0.0343) / 2.0;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  
  esc.attach(PIN_ESC);
  esc.writeMicroseconds(1000);
  delay(2000);
  esc.writeMicroseconds(2000);
  delay(2000);
  esc.writeMicroseconds(1000);
  delay(2000);

  Serial.println("Listo. Envia '1' por Serial para iniciar la prueba.");
}

void loop() {
  if (!prueba_activa && Serial.available() > 0) {
    char c = Serial.read();
    if (c == '1') {
      prueba_activa = true;
      t_inicio = millis();
      t_previo = t_inicio;
      Serial.println("tiempo_ms,pwm_us,altura_cm"); // Cabecera CSV
    }
  }

  if (prueba_activa) {
    unsigned long t_actual = millis();

    // Muestreo determinístico a 50 ms
    if (t_actual - t_previo >= TS_MS) {
      t_previo = t_actual;
      unsigned long t_relativo = t_actual - t_inicio;

      // Fase 1: 0 a 5 s en hovering (1762 us) para estabilizar dY/dt = 0
      if (t_relativo < 5000) {
        pwm_actual = U0;
      }
      // Fase 2: 5 a 15 s escalón activo (1812 us)
      else if (t_relativo < 15000) {
        pwm_actual = U_FINAL;
      }
      // Fase 3: Fin de prueba, apagar motor
      else {
        pwm_actual = 1000;
        esc.writeMicroseconds(1000);
        Serial.println("FIN_PRUEBA");
        prueba_activa = false;
        return;
      }

      esc.writeMicroseconds(pwm_actual);
      distancia_cm = leerUltrasonico();

      // Failsafe por software (corte inmediato si supera 85 cm)
      if (distancia_cm >= 85.0) {
        esc.writeMicroseconds(1000);
        Serial.println("FAILSAFE_ACTIVADO");
        prueba_activa = false;
        return;
      }

      // Impresión de datos tipo CSV
      Serial.print(t_relativo); Serial.print(",");
      Serial.print(pwm_actual); Serial.print(",");
      Serial.println(distancia_cm);
    }
  }
}