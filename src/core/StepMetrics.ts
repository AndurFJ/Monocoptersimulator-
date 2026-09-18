/**
 * StepMetrics — métricas de la respuesta al escalón, calculadas en vivo.
 *
 * Cada vez que cambia el setpoint empieza un nuevo escalón y se mide:
 *  - tiempo de subida (10 % → 90 % del salto)
 *  - sobrepico (% del salto que se pasa del objetivo)
 *  - tiempo de establecimiento (último instante fuera de la banda ±2 %)
 *  - error en régimen (media del error en la última ventana)
 */

import type { TelemetrySample } from '../data/types';

/** Banda de establecimiento relativa al salto */
const SETTLE_BAND = 0.02;
/** Banda mínima absoluta [m] — el ruido del sensor no permite menos */
const MIN_SETTLE_BAND_M = 0.005;
/** Tiempo que debe permanecer en banda para considerarse estable [s] */
const SETTLE_HOLD_S = 1.0;
/** Ventana para promediar el error en régimen [s] */
const STEADY_WINDOW_S = 1.0;
/** Saltos menores que esto no se analizan [m] */
const MIN_STEP_M = 0.01;

export interface StepResult {
  /** Setpoint de este escalón [m] */
  setpoint: number;
  /** Salto de altura [m] (con signo) */
  step: number;
  riseTime: number | null;
  /** Sobrepico en % del salto */
  overshoot: number;
  settlingTime: number | null;
  /** Error medio reciente [m] */
  steadyError: number | null;
  settled: boolean;
}

export class StepMetrics {
  private active: {
    t0: number;
    h0: number;
    sp: number;
    t10: number | null;
    t90: number | null;
    peak: number;
    lastOutside: number;
  } | null = null;
  private recent: { t: number; e: number }[] = [];
  private lastT = 0;

  /** Registrar una muestra. Devuelve las métricas del escalón en curso (o null). */
  push(s: TelemetrySample): StepResult | null {
    if (s.setpoint === undefined) {
      this.reset();
      return null;
    }
    // En simulación se usa la altura real: el ruido del sensor inflaría el sobrepico
    const h = s.heightTrue ?? s.height;

    // Nuevo escalón si cambia el setpoint o el tiempo retrocede (reset)
    if (!this.active || s.t < this.lastT || Math.abs(s.setpoint - this.active.sp) > 1e-9) {
      this.begin(s.t, h, s.setpoint);
    }
    this.lastT = s.t;

    const a = this.active!;
    const step = a.sp - a.h0;
    const dir = Math.sign(step) || 1;
    const progress = step !== 0 ? (h - a.h0) / step : 1;

    if (a.t10 === null && progress >= 0.1) a.t10 = s.t;
    if (a.t90 === null && progress >= 0.9) a.t90 = s.t;
    if ((h - a.peak) * dir > 0) a.peak = h;

    const band = Math.max(Math.abs(step) * SETTLE_BAND, MIN_SETTLE_BAND_M);
    if (Math.abs(h - a.sp) > band) a.lastOutside = s.t;

    this.recent.push({ t: s.t, e: a.sp - h });
    while (this.recent.length && this.recent[0].t < s.t - STEADY_WINDOW_S) this.recent.shift();

    return this.result(s.t);
  }

  reset(): void {
    this.active = null;
    this.recent = [];
    this.lastT = 0;
  }

  private begin(t: number, h0: number, sp: number): void {
    this.active = { t0: t, h0, sp, t10: null, t90: null, peak: h0, lastOutside: t };
    this.recent = [];
  }

  private result(now: number): StepResult {
    const a = this.active!;
    const step = a.sp - a.h0;
    const valid = Math.abs(step) >= MIN_STEP_M;
    const settled = now - a.lastOutside >= SETTLE_HOLD_S;
    const overshoot = valid ? Math.max(0, ((a.peak - a.sp) / step) * 100) : 0;
    const window = now - a.t0 >= STEADY_WINDOW_S;
    return {
      setpoint: a.sp,
      step,
      riseTime: valid && a.t10 !== null && a.t90 !== null ? a.t90 - a.t10 : null,
      overshoot,
      settlingTime: settled ? a.lastOutside - a.t0 : null,
      steadyError: window && this.recent.length
        ? this.recent.reduce((acc, r) => acc + r.e, 0) / this.recent.length
        : null,
      settled,
    };
  }
}
