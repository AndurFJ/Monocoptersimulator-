/**
 * twin.ts — gemelo digital de la guía (sección 4.5): simula muestra a muestra el
 * algoritmo del firmware (IsaPid: saturación, anti-windup, filtro derivativo) sobre
 * la planta SOPDT identificada, con el retardo θ, ante el perfil de setpoint de P2.
 *
 * El lazo arranca en hovering en el primer setpoint (P1 ya hecho): y = sp0 y
 * u = u0 + (sp0 − y0)/K, que es el PWM que se captura al pasar a AUTO.
 */

import { IsaPid } from './isaPid';
import type { IsaGains } from './tuning';
import type { Sopdt } from './sopdt';

export interface TwinConfig {
  plant: Sopdt;
  /** Punto de operación del modelo: con u0 [µs] el carro queda en y0 [cm] */
  u0: number;
  y0: number;
  ts: number;
  uMin: number;
  uMax: number;
  N: number;
  /** Perfil de setpoint [cm] y duración de cada tramo [s] */
  profile: number[];
  segment: number;
  /** Ruido del sensor (desviación estándar) [cm]; 0 = sin ruido */
  noise?: number;
}

export interface TwinRun {
  t: number[];
  y: number[];
  sp: number[];
  u: number[];
}

/** Especificaciones de la guía (sección 4.3) */
export const SPECS = { mp: 10, ts: 5, ess: 1 } as const;

export interface SegmentMetrics {
  from: number;
  to: number;
  /** Sobreimpulso [% del salto] */
  mp: number;
  /** Tiempo de establecimiento al 2 % del salto [s]; null = no se establece en el tramo */
  ts: number | null;
  /** Integral del error absoluto en el tramo [cm·s] */
  iae: number;
  /** |error medio| de los últimos 2 s del tramo [cm] */
  ess: number;
}

export interface TwinMetrics {
  segments: SegmentMetrics[];
  /** Rango de u en todo el perfil [µs] */
  uLo: number;
  uHi: number;
  saturated: boolean;
}

/** Ruido gaussiano reproducible (semilla fija): las tres reglas ven el mismo ruido */
function gaussian(seed: number): () => number {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
}

export function runTwin(gains: IsaGains, cfg: TwinConfig): TwinRun {
  const { plant, ts } = cfg;
  const { K, zeta, wn, theta } = plant;
  const sub = 20;
  const h = ts / sub;
  const total = cfg.profile.length * cfg.segment;
  const steps = Math.round(total / ts);
  const noise = gaussian(12345);

  // Hovering en el primer setpoint
  const sp0 = cfg.profile[0];
  const uHover = cfg.u0 + (sp0 - cfg.y0) / K;
  let x1 = sp0 - cfg.y0; // Δy
  let x2 = 0;
  const pid = new IsaPid(gains, { ts, uMin: cfg.uMin, uMax: cfg.uMax, N: cfg.N });
  pid.start(uHover, sp0);

  // Retardo en muestras enteras, como lo ve el firmware (y como el gemelo de la guía:
  // con θ redondeado a 5 muestras reproduce su tabla de Mp, ts e IAE)
  const delaySteps = Math.round(theta / ts) * sub;
  const uHist: number[] = [];
  const out: TwinRun = { t: [], y: [], sp: [], u: [] };
  let u = uHover;

  for (let k = 0; k <= steps; k++) {
    const t = k * ts;
    const sp = cfg.profile[Math.min(cfg.profile.length - 1, Math.floor(t / cfg.segment + 1e-9))];
    const yTrue = cfg.y0 + x1;
    const yMeas = yTrue + (cfg.noise ? cfg.noise * noise() : 0);
    u = pid.update(sp, yMeas).u;
    out.t.push(t);
    out.y.push(yTrue);
    out.sp.push(sp);
    out.u.push(u);
    // La planta avanza un periodo con u retenido; ve la entrada con θ de atraso
    for (let s = 0; s < sub; s++) {
      uHist.push(u);
      const idx = uHist.length - 1 - delaySteps;
      const du = (idx < 0 ? uHover : uHist[idx]) - cfg.u0;
      x2 += h * (wn * wn * (K * du - x1) - 2 * zeta * wn * x2);
      x1 += h * x2;
    }
  }
  return out;
}

/** Métricas por tramo (Mp, ts al 2 %, IAE, |e| final) y rango de u */
export function twinMetrics(run: TwinRun, cfg: TwinConfig): TwinMetrics {
  const segments: SegmentMetrics[] = [];
  const perSeg = Math.round(cfg.segment / cfg.ts);
  for (let s = 1; s < cfg.profile.length; s++) {
    const from = cfg.profile[s - 1];
    const to = cfg.profile[s];
    const i0 = s * perSeg;
    const i1 = Math.min(run.t.length, i0 + perSeg);
    const step = to - from;
    const dir = Math.sign(step);
    const band = 0.02 * Math.abs(step);
    let peak = 0;
    let iae = 0;
    let lastOut = -1;
    for (let i = i0; i < i1; i++) {
      const e = to - run.y[i];
      peak = Math.max(peak, -dir * e);
      iae += Math.abs(e) * cfg.ts;
      if (Math.abs(e) > band) lastOut = i;
    }
    const tail = run.y.slice(Math.max(i0, i1 - Math.round(2 / cfg.ts)), i1);
    const ess = Math.abs(to - tail.reduce((a, b) => a + b, 0) / tail.length);
    segments.push({
      from, to,
      mp: (100 * peak) / Math.abs(step),
      ts: lastOut >= i1 - 1 ? null : (lastOut + 1 - i0) * cfg.ts,
      iae, ess,
    });
  }
  const uLo = Math.min(...run.u);
  const uHi = Math.max(...run.u);
  return { segments, uLo, uHi, saturated: uLo <= cfg.uMin + 1e-9 || uHi >= cfg.uMax - 1e-9 };
}
