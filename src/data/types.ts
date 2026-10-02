/**
 * Interfaz común de telemetría — spec.md §5.1
 * Todos los modos (Simulación, Reproducción, Serial) producen muestras
 * con esta forma; los consumidores (3D, HUD, gráficas) no necesitan
 * saber de dónde vienen los datos.
 */
export interface TelemetrySample {
  /** Segundos, tiempo relativo desde el inicio del ensayo */
  t: number;
  /** Metros — altura del carro que mide el sensor (filtrada como en el firmware) */
  height: number;
  /** Metros — lectura cruda del pulso del HC-SR04 (sin filtrar; ausente si no hubo eco) */
  raw?: number;
  /** false si el sensor lleva ≥ 0.5 s sin eco */
  sensorOk?: boolean;
  /** Metros — altura real sin ruido de sensor (solo en Simulación) */
  heightTrue?: number;
  /** Unidad según convención configurada (µs 1000-2000 o 0-255) */
  pwm: number;
  /** Metros — solo en modo Simulación/PID */
  setpoint?: number;
  /** Metros — setpoint - height */
  error?: number;
  /** Términos individuales del PID para diagnóstico [µs] */
  pidTerms?: { p: number; i: number; d: number };
  /** true si en esta muestra se disparó el failsafe (altura ≥ 85 cm) */
  failsafe?: boolean;
}

/** Tipo literal de los modos de operación */
export type DataMode = 'simulacion' | 'reproduccion' | 'serial' | 'wifi';

/** Mensaje de estado que una fuente puede reportar a la UI */
export interface SourceStatus {
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  /** true si la fuente se detuvo por sí misma (fin de archivo, puerto cerrado…) */
  stopped?: boolean;
}

/**
 * Contrato que implementan las 4 fuentes de datos.
 * El bus de eventos se suscribe a `onSample` una sola vez.
 */
export interface DataSource {
  /** Empezar/continuar la emisión de muestras (puede ser asíncrono, p.ej. serial) */
  start(): void | Promise<void>;
  /** Pausar la emisión de muestras */
  stop(): void | Promise<void>;
  /** Volver al instante inicial */
  reset(): void;
  onSample(cb: (s: TelemetrySample) => void): void;
  onStatus(cb: (s: SourceStatus) => void): void;
  readonly mode: DataMode;
}

/**
 * Estado del sistema embebido (ESP32) reportado por WiFi (WebSocket)
 * o por USB (Serial). Es el "eco" que mantiene sincronizados a todos
 * los clientes: lo que cambia en el teléfono se ve en el PC y viceversa.
 */
export interface EspStatus {
  uart_connected?: boolean;
  clients?: number;
  uptime_s?: number;
  wifi_mode?: string;
  ip?: string;
  control_mode?: string;
  setpoint_cm?: number;
  kp?: number;
  ki?: number;
  kd?: number;
  /** PWM de equilibrio (feedforward del PID) [µs] */
  u0?: number;
  pwm?: number;
  distancia_cm?: number;
  /** false si el HC-SR04 no devuelve eco */
  sensor_ok?: boolean;
  /** true si la ESP32 corre la planta simulada (MODO_SIMULADO) */
  simulado?: boolean;
  /** true cuando el firmware activó el failsafe (altura > 85 cm → motor a 1000 µs) */
  failsafe?: boolean;
}
