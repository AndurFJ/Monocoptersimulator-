/**
 * PIDController — controlador PID discreto.
 * TODO: implementar en Fase 3
 *
 * spec.md §6:
 *   e[k]  = setpoint − height_medida[k]
 *   I[k]  = clamp(I[k-1] + e[k]·dt, -I_max, I_max)   // anti-windup
 *   D[k]  = (e[k] − e[k-1]) / dt
 *   u[k]  = clamp(Kp·e[k] + Ki·I[k] + Kd·D[k], 0, 1)
 */

export class PIDController {
  kp: number;
  ki: number;
  kd: number;
  dt: number;
  iMax: number;

  constructor(
    kp: number,
    ki: number,
    kd: number,
    dt: number,
    iMax: number,
  ) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.dt = dt;
    this.iMax = iMax;
    // TODO: Fase 3
  }

  /** Calcular la salida del PID dado el error actual */
  update(_error: number): { output: number; p: number; i: number; d: number } {
    // TODO: Fase 3
    return { output: 0, p: 0, i: 0, d: 0 };
  }

  /** Resetear el estado interno (integral acumulada, error previo) */
  reset(): void {
    // TODO: Fase 3
  }
}
