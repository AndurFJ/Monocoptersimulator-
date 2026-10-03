/**
 * threePoint.ts — identificación del modelo de segundo orden con el método de
 * tres puntos (10–50–90 %) de la guía de la Etapa 2, sección 3, y Fit 3 (FOPDT)
 * sobre el mismo ensayo para Ziegler–Nichols.
 *
 * Pasos (los mismos que se hacen a mano):
 *   1. K  = Δy/Δu
 *   2. R  = (t90 − t50)/(t50 − t10)  →  ζ interpolando en la Tabla 1
 *   3. ωn = (x90 − x10)/(t90 − t10)
 *   4. θ  = t50 − x50/ωn
 *   5. Si hay sobreimpulso: ζ = −ln(Mp)/√(π² + ln²Mp)
 *   6. ke = m·ωn², B = 2ζ·m·ωn, kF = (K/100)·ke
 *   7. Si ζ > 1: τ1,2 = 1/[ωn(ζ ∓ √(ζ² − 1))]
 */

import { poles, timeConstants, zetaFromOvershoot, ratioR, xAt } from './sopdt';
import type { Fopdt, Sopdt } from './sopdt';

/** Tabla 1 de la guía: ζ, R, x10, x50, x90 */
export const TABLE_1: readonly { zeta: number; R: number; x10: number; x50: number; x90: number }[] = [
  { zeta: 0.3, R: 0.862, x10: 0.473, x50: 1.182, x90: 1.794 },
  { zeta: 0.5, R: 1.032, x10: 0.488, x50: 1.294, x90: 2.126 },
  { zeta: 0.6, R: 1.152, x10: 0.496, x50: 1.358, x90: 2.350 },
  { zeta: 0.7, R: 1.303, x10: 0.505, x50: 1.428, x90: 2.631 },
  { zeta: 0.8, R: 1.490, x10: 0.514, x50: 1.505, x90: 2.981 },
  { zeta: 0.9, R: 1.706, x10: 0.523, x50: 1.588, x90: 3.405 },
  { zeta: 1.0, R: 1.929, x10: 0.532, x50: 1.678, x90: 3.890 },
  { zeta: 1.1, R: 2.129, x10: 0.541, x50: 1.776, x90: 4.404 },
  { zeta: 1.2, R: 2.291, x10: 0.551, x50: 1.880, x90: 4.923 },
  { zeta: 1.3, R: 2.413, x10: 0.561, x50: 1.990, x90: 5.436 },
  { zeta: 1.4, R: 2.503, x10: 0.572, x50: 2.105, x90: 5.942 },
  { zeta: 1.5, R: 2.568, x10: 0.583, x50: 2.225, x90: 6.441 },
  { zeta: 1.6, R: 2.614, x10: 0.594, x50: 2.348, x90: 6.935 },
  { zeta: 2.0, R: 2.702, x10: 0.642, x50: 2.865, x90: 8.871 },
];

/** Por encima de esta R el segundo polo se confunde con el retardo (ζ no identificable) */
export const R_DOMINANT = 2.70;

export type DampingCase = 'subamortiguado' | 'critico' | 'sobreamortiguado' | 'polo-dominante';

export const CASE_LABELS: Record<DampingCase, string> = {
  subamortiguado: 'Subamortiguado',
  critico: 'Crítico',
  sobreamortiguado: 'Sobreamortiguado',
  'polo-dominante': 'Sobreamortiguado con polo dominante',
};

/** Umbrales de la tabla de casos de la guía */
export function classify(zeta: number, R: number): DampingCase {
  if (R >= R_DOMINANT) return 'polo-dominante';
  if (zeta < 0.95) return 'subamortiguado';
  if (zeta <= 1.05) return 'critico';
  return 'sobreamortiguado';
}

/** Resultado de interpolar R en la Tabla 1 (para mostrar la cuenta hecha a mano) */
export interface TableLookup {
  zeta: number;
  x10: number;
  x50: number;
  x90: number;
  /** Filas entre las que se interpoló y fracción entre ellas (null si R cae fuera de la tabla) */
  lo: (typeof TABLE_1)[number] | null;
  hi: (typeof TABLE_1)[number] | null;
  frac: number;
  /** 'bajo' = R < 0.862 (ζ < 0.3); 'alto' = R > 2.702 */
  outOfRange: 'bajo' | 'alto' | null;
}

/** Interpolación lineal en la Tabla 1, como se hace a mano */
export function lookupTable(R: number): TableLookup {
  const first = TABLE_1[0];
  const last = TABLE_1[TABLE_1.length - 1];
  if (R <= first.R) return { ...pick(first), lo: null, hi: first, frac: 0, outOfRange: R < first.R ? 'bajo' : null };
  if (R >= last.R) return { ...pick(last), lo: last, hi: null, frac: 1, outOfRange: R > last.R ? 'alto' : null };
  for (let i = 1; i < TABLE_1.length; i++) {
    const lo = TABLE_1[i - 1];
    const hi = TABLE_1[i];
    if (R <= hi.R) {
      const f = (R - lo.R) / (hi.R - lo.R);
      const lerp = (a: number, b: number) => a + f * (b - a);
      return {
        zeta: lerp(lo.zeta, hi.zeta), x10: lerp(lo.x10, hi.x10), x50: lerp(lo.x50, hi.x50), x90: lerp(lo.x90, hi.x90),
        lo, hi, frac: f, outOfRange: null,
      };
    }
  }
  return { ...pick(last), lo: last, hi: null, frac: 1, outOfRange: 'alto' };
}

function pick(r: (typeof TABLE_1)[number]) {
  return { zeta: r.zeta, x10: r.x10, x50: r.x50, x90: r.x90 };
}

/** ζ exacto que da una R (sin interpolar), para comparar con la tabla */
export function zetaFromR(R: number): number | null {
  if (R < ratioR(0.1) || R >= ratioR(20)) return null;
  let lo = 0.1;
  let hi = 20;
  for (let i = 0; i < 50; i++) {
    const mid = Math.sqrt(lo * hi);
    if (ratioR(mid) < R) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

// ── Cálculo con tiempos ya medidos (el «ejemplo resuelto» de la guía) ──

export interface ThreePointInput {
  du: number;
  dy: number;
  /** Instantes medidos desde el escalón [s] */
  t10: number;
  t50: number;
  t90: number;
  /** Sobreimpulso como fracción (0.08 = 8 %), si la curva pasa del valor final */
  mp?: number;
  /** Masa del carro [kg] (para ke, B, kF) */
  massKg?: number;
}

export interface ThreePointResult {
  K: number;
  R: number;
  table: TableLookup;
  zeta: number;
  /** ζ exacto de la respuesta de segundo orden (control de la interpolación) */
  zetaExact: number | null;
  /** ζ calculado con el sobreimpulso (paso 5), si lo hubo */
  zetaMp: number | null;
  wn: number;
  theta: number;
  /** x10, x50, x90 usados (de la tabla, o exactos si ζ salió del sobreimpulso) */
  x: { x10: number; x50: number; x90: number };
  dampingCase: DampingCase;
  poles: { re: number; im: number }[];
  tau: [number, number] | null;
  /** Dimensionamiento físico (paso 6), si se dio la masa */
  ke: number | null;
  B: number | null;
  kF: number | null;
  model: Sopdt;
}

export function threePoint(input: ThreePointInput): ThreePointResult {
  const K = input.dy / input.du;
  const R = (input.t90 - input.t50) / (input.t50 - input.t10);
  const table = lookupTable(R);
  const zetaMp = input.mp && input.mp > 0 ? zetaFromOvershoot(input.mp) : null;
  // ζ sale de la Tabla 1; el sobreimpulso solo lo verifica (paso 5). Si R cae por
  // debajo de la tabla (ζ < 0.3) no hay de dónde interpolar y se usa el del sobreimpulso.
  const useMp = table.outOfRange === 'bajo' && zetaMp !== null;
  const zeta = useMp ? zetaMp : table.zeta;
  const x10 = useMp ? xAt(0.1, zeta) : table.x10;
  const x50 = useMp ? xAt(0.5, zeta) : table.x50;
  const x90 = useMp ? xAt(0.9, zeta) : table.x90;
  const wn = (x90 - x10) / (input.t90 - input.t10);
  const theta = Math.max(0, input.t50 - x50 / wn);
  const m = input.massKg;
  const ke = m ? m * wn * wn : null;
  return {
    K, R, table, zeta, zetaExact: zetaFromR(R), zetaMp, wn, theta,
    x: { x10, x50, x90 },
    dampingCase: classify(zeta, R),
    poles: poles(zeta, wn),
    tau: timeConstants(zeta, wn),
    ke,
    B: m ? 2 * zeta * m * wn : null,
    kF: ke !== null ? (K / 100) * ke : null,
    model: { K, zeta, wn, theta },
  };
}

// ── Análisis de un ensayo registrado ───────────────────────────

export interface StepRecord {
  t: number[];
  y: number[];
  u: number[];
}

export interface StepAnalysis {
  /** Instante del escalón y fin del tramo en u0 + Δu [s] */
  tStep: number;
  tEnd: number;
  u0: number;
  u1: number;
  du: number;
  y0: number;
  yInf: number;
  dy: number;
  /** Instantes medidos desde el escalón [s] */
  t10: number;
  t50: number;
  t90: number;
  /** Para Fit 3 (Smith & Corripio): 28.3 % y 63.2 % */
  t283: number;
  t632: number;
  /** Sobreimpulso (fracción), 0 si no pasa del valor final */
  mp: number;
  /** Pendiente de la altura en los 2 s antes del escalón [cm/s] (debería ser ≈ 0) */
  preSlope: number;
  /** Avisos sobre la calidad del ensayo (carro no quieto, salto pequeño…) */
  warnings: string[];
  /** Altura suavizada (mediana móvil de 5) usada para medir los tiempos */
  ySmooth: number[];
  result: ThreePointResult;
  fopdt: Fopdt;
}

/** Mediana móvil centrada (como movmedian de MATLAB): quita picos sin retrasar la curva */
export function movingMedian(y: number[], window = 5): number[] {
  const h = Math.floor(window / 2);
  return y.map((_, i) => {
    const s = y.slice(Math.max(0, i - h), Math.min(y.length, i + h + 1)).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  });
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** Detectar el escalón: primer cambio de PWM > 10 µs y su final (cuando vuelve o termina el archivo) */
export function detectStep(t: number[], u: number[]): { iStep: number; iEnd: number } | null {
  const base = median(u.slice(0, Math.max(3, Math.min(20, u.length))));
  const iStep = u.findIndex((v) => Math.abs(v - base) > 10);
  if (iStep <= 0) return null;
  const u1 = u[Math.min(u.length - 1, iStep + 2)];
  let iEnd = u.length;
  for (let i = iStep + 3; i < u.length; i++) {
    if (Math.abs(u[i] - u1) > 10) { iEnd = i; break; }
  }
  return t[iEnd - 1] - t[iStep] > 1 ? { iStep, iEnd } : null;
}

/** Primer instante (interpolado) en que la curva normalizada alcanza p, desde iFrom */
function crossing(t: number[], f: number[], p: number, iFrom: number, iTo: number): number {
  for (let i = Math.max(iFrom, 1); i < iTo; i++) {
    if (f[i] >= p && f[i - 1] < p) {
      return t[i - 1] + ((p - f[i - 1]) / (f[i] - f[i - 1])) * (t[i] - t[i - 1]);
    }
    if (i === iFrom && f[i] >= p) return t[i];
  }
  return NaN;
}

/**
 * Analizar un ensayo de escalón: y0 = promedio antes del escalón, y∞ = promedio
 * del último 20 % del tramo (mínimo 1 s), tiempos medidos sobre la curva suavizada.
 */
export function analyzeStep(rec: StepRecord, massKg?: number): StepAnalysis | null {
  const { t, y, u } = rec;
  const step = detectStep(t, u);
  if (!step) return null;
  const { iStep, iEnd } = step;
  const tStep = t[iStep];
  const tEnd = t[iEnd - 1];
  const ySmooth = movingMedian(y, 5);

  // y0: el último segundo antes del escalón (donde realmente arranca la respuesta)
  const pre = ySmooth.filter((_, i) => i < iStep && t[i] >= tStep - 1);
  const y0 = mean(pre.length ? pre : [ySmooth[0]]);
  // ¿Estaba quieto? Pendiente (mínimos cuadrados) de los 2 s anteriores
  const iPre = t.map((_, i) => i).filter((i) => i < iStep && t[i] >= tStep - 2);
  const preSlope = slope(iPre.map((i) => t[i]), iPre.map((i) => ySmooth[i]));
  // Valor final: último 20 % del tramo en u0 + Δu, al menos 1 s
  const tailFrom = tEnd - Math.max(1, 0.2 * (tEnd - tStep));
  const tail = ySmooth.filter((_, i) => i >= iStep && i < iEnd && t[i] >= tailFrom);
  const yInf = mean(tail);
  const u0 = median(u.slice(Math.max(0, iStep - 20), iStep));
  const u1 = median(u.slice(iStep, iEnd));
  const du = u1 - u0;
  const dy = yInf - y0;
  if (Math.abs(du) < 1 || Math.abs(dy) < 0.5) return null;

  const f = ySmooth.map((v) => (v - y0) / dy);
  const rel = (p: number) => crossing(t, f, p, iStep, iEnd) - tStep;
  const t10 = rel(0.1);
  const t50 = rel(0.5);
  const t90 = rel(0.9);
  const t283 = rel(0.283);
  const t632 = rel(0.632);
  const peak = Math.max(...f.slice(iStep, iEnd));
  // Sobreimpulso solo si supera claramente el ruido (> 3 % del salto)
  const mp = peak > 1.03 ? peak - 1 : 0;

  const result = threePoint({ du, dy, t10, t50, t90, mp: mp || undefined, massKg });
  const warnings: string[] = [];
  if (Math.abs(preSlope) * 2 > 0.1 * Math.abs(dy)) {
    warnings.push(`El carro no estaba quieto antes del escalón (se movía ${preSlope.toFixed(2)} cm/s). `
      + 'Los tiempos t10, t50 y t90 quedan corridos: repite el ensayo con el carro quieto al menos 3 s en u0.');
  }
  if (!(t10 > 0.05)) warnings.push('La curva ya pasaba del 10 % al aplicar el escalón: t10 no es fiable.');
  if (Math.abs(dy) < 5) warnings.push(`El salto es pequeño (${dy.toFixed(1)} cm) comparado con el ruido del sensor (±0.4 cm).`);
  if (tEnd - tStep < 6) warnings.push('El tramo en u0 + Δu es corto: puede que y∞ aún no se haya asentado.');
  // Fit 3: τ = 1.5(t63.2 − t28.3), t0 = t63.2 − τ
  const tau = 1.5 * (t632 - t283);
  const fopdt: Fopdt = { K: dy / du, tau, t0: Math.max(0, t632 - tau) };

  return { tStep, tEnd, u0, u1, du, y0, yInf, dy, t10, t50, t90, t283, t632, mp, preSlope, warnings, ySmooth, result, fopdt };
}

/** Pendiente de la recta de mínimos cuadrados */
function slope(x: number[], y: number[]): number {
  if (x.length < 3) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return den > 0 ? num / den : 0;
}
