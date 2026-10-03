/**
 * sopdt.ts — modelos de la planta alrededor del hovering y su respuesta al escalón.
 *
 *   SOPDT (Etapa 2):  Gp(s) = K·ωn²·e^(−θs) / (s² + 2ζωn·s + ωn²)   [cm/µs]
 *   FOPDT (Etapa 1):  Gp(s) = K·e^(−t0·s) / (τs + 1)
 *
 * Todo en unidades del banco: y en cm, u en µs, t en s.
 */

/** Modelo de segundo orden con tiempo muerto */
export interface Sopdt {
  /** Ganancia [cm/µs] */
  K: number;
  /** Amortiguamiento [-] */
  zeta: number;
  /** Frecuencia natural [rad/s] */
  wn: number;
  /** Tiempo muerto [s] */
  theta: number;
}

/** Modelo de primer orden con tiempo muerto (Fit 3 de la Etapa 1) */
export interface Fopdt {
  K: number;
  tau: number;
  t0: number;
}

/**
 * Respuesta normalizada al escalón del segundo orden estándar, sin retardo:
 * F(x) con x = ωn·t. Va de 0 a 1 (puede pasar de 1 si ζ < 1).
 */
export function stepNormalized(x: number, zeta: number): number {
  if (x <= 0) return 0;
  if (Math.abs(zeta - 1) < 1e-6) {
    // Crítico: polo doble en −ωn
    return 1 - (1 + x) * Math.exp(-x);
  }
  if (zeta < 1) {
    // Subamortiguado: oscilación amortiguada
    const wd = Math.sqrt(1 - zeta * zeta);
    return 1 - (Math.exp(-zeta * x) / wd) * Math.sin(wd * x + Math.acos(zeta));
  }
  // Sobreamortiguado: dos polos reales p1, p2 (normalizados por ωn)
  const r = Math.sqrt(zeta * zeta - 1);
  const p1 = -zeta + r;
  const p2 = -zeta - r;
  return 1 + (p2 * Math.exp(p1 * x) - p1 * Math.exp(p2 * x)) / (p1 - p2);
}

/** x_p(ζ): primer x = ωn·(t − θ) en que F alcanza la fracción p (0 < p < 1) */
export function xAt(p: number, zeta: number): number {
  let lo = 0;
  let hi = 0.01;
  while (stepNormalized(hi, zeta) < p) {
    lo = hi;
    hi += 0.05;
    if (hi > 500) return NaN;
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (stepNormalized(mid, zeta) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Razón de tiempos R(ζ) = (x90 − x50)/(x50 − x10): no depende de ωn ni de θ */
export function ratioR(zeta: number): number {
  const x10 = xAt(0.1, zeta);
  const x50 = xAt(0.5, zeta);
  const x90 = xAt(0.9, zeta);
  return (x90 - x50) / (x50 - x10);
}

/** Polos s1,2 = −ζωn ± ωn·√(ζ² − 1) (partes real e imaginaria) [rad/s] */
export function poles(zeta: number, wn: number): { re: number; im: number }[] {
  if (zeta >= 1) {
    const r = wn * Math.sqrt(zeta * zeta - 1);
    return [{ re: -zeta * wn + r, im: 0 }, { re: -zeta * wn - r, im: 0 }];
  }
  const im = wn * Math.sqrt(1 - zeta * zeta);
  return [{ re: -zeta * wn, im }, { re: -zeta * wn, im: -im }];
}

/** Constantes de tiempo si ζ ≥ 1: τ1,2 = 1/[ωn(ζ ∓ √(ζ² − 1))] [s] (τ1 el lento) */
export function timeConstants(zeta: number, wn: number): [number, number] | null {
  if (zeta < 1) return null;
  const r = Math.sqrt(zeta * zeta - 1);
  return [1 / (wn * (zeta - r)), 1 / (wn * (zeta + r))];
}

/** Sobreimpulso → ζ (solo si la respuesta pasa del valor final): ζ = −ln(Mp)/√(π² + ln²Mp) */
export function zetaFromOvershoot(mp: number): number {
  const l = Math.log(mp);
  return -l / Math.sqrt(Math.PI * Math.PI + l * l);
}

/**
 * Simular un modelo ante la señal u(t) registrada (retenida entre muestras, como el PWM real).
 * Devuelve y(t) en cada instante de t. El modelo está en variables de desviación
 * alrededor de (u0, y0): Δy = G·Δu.
 */
export function simulate(
  model: Sopdt | Fopdt, t: number[], u: number[], u0: number, y0: number, maxDt = 0.005,
): number[] {
  const out: number[] = new Array(t.length);
  const isSo = 'zeta' in model;
  const delay = isSo ? model.theta : model.t0;
  // u retenido: valor vigente en el instante τ (u0 antes de empezar)
  let j = 0;
  const uAt = (tau: number): number => {
    if (tau < t[0]) return u0;
    while (j + 1 < t.length && t[j + 1] <= tau) j++;
    while (j > 0 && t[j] > tau) j--;
    return u[j];
  };
  let x1 = 0; // Δy
  let x2 = 0; // dΔy/dt (solo segundo orden)
  out[0] = y0;
  for (let k = 1; k < t.length; k++) {
    const span = t[k] - t[k - 1];
    const n = Math.max(1, Math.ceil(span / maxDt));
    const h = span / n;
    for (let s = 0; s < n; s++) {
      const tau = t[k - 1] + s * h - delay;
      const du = uAt(tau) - u0;
      if (isSo) {
        const { K, zeta, wn } = model;
        // Euler semi-implícito (estable y preciso con h ≤ 5 ms para ωn ~ 2–10 rad/s)
        x2 += h * (wn * wn * (K * du - x1) - 2 * zeta * wn * x2);
        x1 += h * x2;
      } else {
        x1 += (h / model.tau) * (model.K * du - x1);
      }
    }
    out[k] = y0 + x1;
  }
  return out;
}

/** Ajuste (Fit) en % como el de MATLAB: 100·(1 − ‖y − ŷ‖/‖y − media(y)‖) */
export function fitPercent(y: number[], yhat: number[]): number {
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < y.length; i++) {
    num += (y[i] - yhat[i]) ** 2;
    den += (y[i] - mean) ** 2;
  }
  return den > 0 ? 100 * (1 - Math.sqrt(num / den)) : 0;
}
