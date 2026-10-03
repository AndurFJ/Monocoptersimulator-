/**
 * refine.ts — ajuste fino por mínimos cuadrados (como fminsearch en so_identificacion.m).
 *
 * Parte del modelo de tres puntos y busca K, ζ, ωn, θ que minimizan la suma de
 * errores al cuadrado entre la altura medida y la simulada con el PWM registrado.
 * Usa Nelder–Mead (el mismo algoritmo de fminsearch) sobre los logaritmos de los
 * parámetros, para que nunca salgan negativos.
 */

import { simulate, fitPercent } from './sopdt';
import type { Fopdt, Sopdt } from './sopdt';

/** Nelder–Mead: minimiza f desde x0 */
export function nelderMead(f: (x: number[]) => number, x0: number[], opts: { iters?: number; step?: number } = {}): number[] {
  const n = x0.length;
  const iters = opts.iters ?? 400;
  const step = opts.step ?? 0.1;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))];
  let values = simplex.map(f);
  for (let k = 0; k < iters; k++) {
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    if (Math.abs(values[n] - values[0]) < 1e-10 * (1 + Math.abs(values[0]))) break;
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const along = (t: number) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const xr = along(-1);
    const fr = f(xr);
    if (fr < values[0]) {
      const xe = along(-2);
      const fe = f(xe);
      [simplex[n], values[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < values[n - 1]) {
      [simplex[n], values[n]] = [xr, fr];
    } else {
      const xc = along(fr < values[n] ? -0.5 : 0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, values[n])) {
        [simplex[n], values[n]] = [xc, fc];
      } else {
        // Encoger hacia el mejor punto
        simplex = simplex.map((p, i) => (i === 0 ? p : p.map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]))));
        values = simplex.map((p, i) => (i === 0 ? values[0] : f(p)));
      }
    }
  }
  const best = values.indexOf(Math.min(...values));
  return simplex[best];
}

export interface RefineWindow {
  t: number[];
  y: number[];
  u: number[];
  u0: number;
  y0: number;
}

/** Ajuste fino del SOPDT; devuelve el modelo y su Fit [%] */
export function refineSopdt(start: Sopdt, w: RefineWindow): { model: Sopdt; fit: number } {
  const unpack = (p: number[]): Sopdt => ({
    K: start.K * Math.exp(p[0]),
    zeta: Math.exp(p[1]),
    wn: Math.exp(p[2]),
    theta: Math.exp(p[3]),
  });
  const sse = (p: number[]) => {
    const yhat = simulate(unpack(p), w.t, w.u, w.u0, w.y0, 0.01);
    let s = 0;
    for (let i = 0; i < yhat.length; i++) s += (w.y[i] - yhat[i]) ** 2;
    return Number.isFinite(s) ? s : 1e30;
  };
  const p = nelderMead(sse, [0, Math.log(start.zeta), Math.log(start.wn), Math.log(Math.max(start.theta, 0.01))], { iters: 300 });
  const model = unpack(p);
  return { model, fit: fitPercent(w.y, simulate(model, w.t, w.u, w.u0, w.y0)) };
}

/** Fit [%] de un modelo (SOPDT o FOPDT) sobre la ventana */
export function modelFit(model: Sopdt | Fopdt, w: RefineWindow): number {
  return fitPercent(w.y, simulate(model, w.t, w.u, w.u0, w.y0));
}
