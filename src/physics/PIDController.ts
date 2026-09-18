/**
 * PIDController — controlador PID discreto.
 *
 * spec.md §6:
 *   e[k]  = setpoint − height_medida[k]
 *   I[k]  = clamp(I[k-1] + e[k]·dt, -I_max, I_max)   // anti-windup
 *   D[k]  = (e[k] − e[k-1]) / dt
 *   u[k]  = clamp(Kp·e[k] + Ki·I[k] + Kd·D[k], 0, 1)
 *
 * Extensión: `feedforward` (u₀) se suma antes de saturar. Con u₀ = 0 el
 * controlador es exactamente el de la spec; con u₀ ≈ throttle de hover
 * el PID solo corrige alrededor del punto de equilibrio.
 */

export interface PIDOutput {
  /** Throttle saturado ∈ [0, 1] */
  output: number;
  p: number;
  i: number;
  d: number;
}

export class PIDController {
  kp: number;
  ki: number;
  kd: number;
  dt: number;
  iMax: number;
  feedforward: number;

  private integral = 0;
  private prevError: number | null = null;

  constructor(
    kp: number,
    ki: number,
    kd: number,
    dt: number,
    iMax: number,
    feedforward = 0,
  ) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.dt = dt;
    this.iMax = iMax;
    this.feedforward = feedforward;
  }

  /** Integral acumulada (sin multiplicar por Ki) */
  get integralState(): number {
    return this.integral;
  }

  /** Calcular la salida del PID dado el error actual */
  update(error: number): PIDOutput {
    this.integral = clamp(this.integral + error * this.dt, -this.iMax, this.iMax);
    // En la primera muestra no hay error previo: D = 0 evita el "derivative kick"
    const derivative = this.prevError === null ? 0 : (error - this.prevError) / this.dt;
    this.prevError = error;

    const p = this.kp * error;
    const i = this.ki * this.integral;
    const d = this.kd * derivative;
    const output = clamp(this.feedforward + p + i + d, 0, 1);
    return { output, p, i, d };
  }

  /** Resetear el estado interno (integral acumulada, error previo) */
  reset(): void {
    this.integral = 0;
    this.prevError = null;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
