/**
 * PIDController — el mismo PID que corre en el firmware (Arduino Uno / ESP32).
 *
 * Unidades del banco: altura en cm, salida en µs de PWM.
 *   e[k] = sp − y[k]                                   [cm]
 *   P    = Kp·e                                         Kp [µs/cm]
 *   I   += Ki·e·Ts   (solo si no empuja hacia la saturación; |I| ≤ I_max)
 *   D    = −Kd·ẏ_f   (derivada de la MEDIDA, filtrada: sin "derivative kick")
 *   u    = clamp(u0 + P + I + D, u_min, u_max)          [µs]
 *
 * u0 es el PWM de equilibrio (feedforward): el PID solo corrige alrededor
 * del punto de operación identificado.
 */

export interface PIDOutput {
  /** PWM saturado [µs] */
  output: number;
  /** Términos individuales [µs] */
  p: number;
  i: number;
  d: number;
}

export interface PIDLimits {
  uMin: number;
  uMax: number;
  iMax: number;
  /** Peso de la derivada nueva en su filtro (1 = sin filtro) */
  dFilter: number;
}

export class PIDController {
  kp: number;
  ki: number;
  kd: number;
  /** Periodo de muestreo [s] */
  dt: number;
  /** PWM de equilibrio [µs] */
  feedforward: number;
  readonly limits: PIDLimits;

  private integral = 0;
  private prevMeasure: number | null = null;
  private dFiltered = 0;

  constructor(kp: number, ki: number, kd: number, dt: number, feedforward: number, limits: PIDLimits) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.dt = dt;
    this.feedforward = feedforward;
    this.limits = limits;
  }

  /** Término integral acumulado [µs] */
  get integralState(): number {
    return this.integral;
  }

  /** Calcular el PWM [µs] para un setpoint y una medida en cm */
  update(setpointCm: number, measuredCm: number): PIDOutput {
    const { uMin, uMax, iMax, dFilter } = this.limits;
    const error = setpointCm - measuredCm;
    // Primera muestra: sin historia, derivada 0
    const rate = this.prevMeasure === null ? 0 : (measuredCm - this.prevMeasure) / this.dt;
    this.prevMeasure = measuredCm;
    this.dFiltered += dFilter * (rate - this.dFiltered);

    const p = this.kp * error;
    const d = -this.kd * this.dFiltered;
    const unsat = this.feedforward + p + this.integral + d;
    const pushingUp = unsat >= uMax && error > 0;
    const pushingDown = unsat <= uMin && error < 0;
    if (!pushingUp && !pushingDown) {
      this.integral = clamp(this.integral + this.ki * error * this.dt, -iMax, iMax);
    }
    const output = clamp(this.feedforward + p + this.integral + d, uMin, uMax);
    return { output, p, i: this.integral, d };
  }

  /** Resetear el estado interno (integral, derivada y medida previa) */
  reset(): void {
    this.integral = 0;
    this.prevMeasure = null;
    this.dFiltered = 0;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
