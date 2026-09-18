/**
 * Interfaz común de telemetría — spec.md §5.1
 * Todos los modos (Simulación, Reproducción, Serial) producen muestras
 * con esta forma; los consumidores (3D, HUD, gráficas) no necesitan
 * saber de dónde vienen los datos.
 */
export interface TelemetrySample {
  /** Segundos, tiempo relativo desde el inicio del ensayo */
  t: number;
  /** Metros — altura del carro sobre la base */
  height: number;
  /** Unidad según convención configurada (µs 1000-2000 o 0-255) */
  pwm: number;
  /** Metros — solo en modo Simulación/PID */
  setpoint?: number;
  /** Metros — setpoint - height */
  error?: number;
  /** Términos individuales del PID para diagnóstico */
  pidTerms?: { p: number; i: number; d: number };
}

/** Tipo literal de los modos de operación */
export type DataMode = 'simulacion' | 'reproduccion' | 'serial';

/**
 * Contrato que implementan las 3 fuentes de datos.
 * El bus de eventos se suscribe a `onSample` una sola vez.
 */
export interface DataSource {
  start(): void;
  stop(): void;
  onSample(cb: (s: TelemetrySample) => void): void;
  readonly mode: DataMode;
}
