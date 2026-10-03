/**
 * isaPid.ts — el PID digital de la guía de la Etapa 2 (sección 4.4), tal cual:
 *
 *   e_k = sp_k − y_k                       Tf = Td/N   (N = 10)
 *   D_k = [Tf/(Tf + Ts)]·D_{k−1} − [Kc·Td/(Tf + Ts)]·(y_k − y_{k−1})
 *   u_k = sat[uMin, uMax](u0 + Kc·e_k + I_k + D_k)
 *   I_{k+1} = I_k + (Kc·Ts/Ti)·e_k   (solo si no hay saturación o si el error la reduce)
 *
 * - Derivada sobre la MEDICIÓN: un salto del setpoint no produce un golpe en u.
 * - Filtro derivativo (N = 10): la derivada no amplifica el ruido del sensor.
 * - Anti-windup por integración condicional: la integral no se «infla» mientras u está saturado.
 * - u0 (PWM de hovering) se captura al pasar a AUTO: transferencia sin salto.
 */

import type { IsaGains } from './tuning';

export interface IsaPidConfig {
  /** Periodo de muestreo [s] */
  ts: number;
  uMin: number;
  uMax: number;
  /** Filtro derivativo: Tf = Td/N */
  N: number;
}

export interface IsaPidOutput {
  u: number;
  /** Términos [µs] para graficar */
  p: number;
  i: number;
  d: number;
  saturated: boolean;
}

export class IsaPid {
  gains: IsaGains;
  readonly cfg: IsaPidConfig;
  /** PWM de hovering capturado al pasar a AUTO [µs] */
  u0 = 0;
  private I = 0;
  private D = 0;
  private yPrev = 0;

  constructor(gains: IsaGains, cfg: IsaPidConfig) {
    this.gains = gains;
    this.cfg = cfg;
  }

  /** Paso a AUTO sin salto: u0 = PWM actual, integral y derivada a cero */
  start(uNow: number, yNow: number): void {
    this.u0 = uNow;
    this.I = 0;
    this.D = 0;
    this.yPrev = yNow;
  }

  update(sp: number, y: number): IsaPidOutput {
    const { Kc, Ti, Td } = this.gains;
    const { ts, uMin, uMax, N } = this.cfg;
    const e = sp - y;
    if (Td > 0) {
      const tf = Td / N;
      this.D = (tf / (tf + ts)) * this.D - ((Kc * Td) / (tf + ts)) * (y - this.yPrev);
    } else {
      this.D = 0;
    }
    this.yPrev = y;
    const p = Kc * e;
    const v = this.u0 + p + this.I + this.D;
    const u = Math.min(uMax, Math.max(uMin, v));
    const i = this.I;
    // Integración condicional: se integra si no hay saturación, o si el error ayuda a salir de ella
    if (Ti > 0) {
      const high = v > uMax;
      const low = v < uMin;
      if ((!high && !low) || (high && e < 0) || (low && e > 0)) this.I += ((Kc * ts) / Ti) * e;
    }
    return { u, p, i, d: this.D, saturated: v > uMax || v < uMin };
  }
}
