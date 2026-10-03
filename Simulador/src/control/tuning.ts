/**
 * tuning.ts — reglas de sintonización de la guía de la Etapa 2 (sección 4.2).
 *
 * Todas dan el PID en forma estándar ISA:  C(s) = Kc·[1 + 1/(Ti·s) + Td·s]
 *   Kc [µs/cm], Ti [s], Td [s].  Ti = 0 significa «sin acción integral» (como I0 en el firmware).
 *
 *  1. Ziegler–Nichols, curva de reacción (FOPDT de Fit 3) — obligatoria
 *  2. Lambda tuning (SOPDT) — obligatoria, λ ∈ [θ, 3θ]
 *  3. Regla del grupo (a elegir, con su fuente): SIMC, AMIGO o Cohen–Coon
 */

import type { Fopdt, Sopdt } from './sopdt';
import { timeConstants } from './sopdt';

export interface IsaGains {
  Kc: number;
  Ti: number;
  Td: number;
}

/** Ganancias en forma paralela, las que usa el firmware actual: Kp [µs/cm], Ki [µs/(cm·s)], Kd [µs·s/cm] */
export interface ParallelGains {
  kp: number;
  ki: number;
  kd: number;
}

/** ISA → paralela: Kp = Kc, Ki = Kc/Ti, Kd = Kc·Td (mismo controlador, otra forma de escribirlo) */
export function isaToParallel(g: IsaGains): ParallelGains {
  return { kp: g.Kc, ki: g.Ti > 0 ? g.Kc / g.Ti : 0, kd: g.Kc * g.Td };
}

/** Paralela → ISA: Kc = Kp, Ti = Kp/Ki, Td = Kd/Kp */
export function parallelToIsa(g: ParallelGains): IsaGains {
  if (g.kp <= 0) return { Kc: 0, Ti: 0, Td: 0 };
  return { Kc: g.kp, Ti: g.ki > 0 ? g.kp / g.ki : 0, Td: g.kd / g.kp };
}

/** 1. Ziegler–Nichols (curva de reacción, decaimiento 1/4): Kc = 1.2τ/(K·t0), Ti = 2t0, Td = 0.5t0 */
export function zieglerNichols(m: Fopdt): IsaGains {
  return { Kc: (1.2 * m.tau) / (m.K * m.t0), Ti: 2 * m.t0, Td: 0.5 * m.t0 };
}

/**
 * 2. Lambda tuning (IMC): los ceros del PID cancelan los dos polos de la planta.
 *    Ti = 2ζ/ωn (= τ1 + τ2), Td = 1/(2ζωn), Kc = Ti/[K(λ + θ)]
 *    El lazo cerrado queda ≈ e^(−θs)/(λs + 1): λ es la constante de tiempo que se pide.
 */
export function lambdaTuning(m: Sopdt, lambda: number): IsaGains {
  const Ti = (2 * m.zeta) / m.wn;
  return { Kc: Ti / (m.K * (lambda + m.theta)), Ti, Td: 1 / (2 * m.zeta * m.wn) };
}

/**
 * 3a. SIMC (Skogestad 2003, ref. [8] de la guía), con τc = θ por defecto («ajuste ajustado y robusto»).
 *     Con dos polos reales (ζ ≥ 1): PID en serie Kc' = τ1/[K(τc + θ)], τI = min(τ1, 4(τc + θ)), τD = τ2,
 *     pasado a forma ISA: Kc = Kc'(1 + τD/τI), Ti = τI + τD, Td = τI·τD/(τI + τD).
 *     Si ζ < 1 (polos complejos) se usa el FOPDT: PI con Kc = τ/[K(τc + t0)], Ti = min(τ, 4(τc + t0)).
 */
export function simc(so: Sopdt, fo: Fopdt, tauc?: number): IsaGains {
  const tau = timeConstants(so.zeta, so.wn);
  if (tau) {
    const tc = tauc ?? so.theta;
    const [t1, t2] = tau;
    const kcS = t1 / (so.K * (tc + so.theta));
    const tI = Math.min(t1, 4 * (tc + so.theta));
    const tD = t2;
    return { Kc: kcS * (1 + tD / tI), Ti: tI + tD, Td: (tI * tD) / (tI + tD) };
  }
  const tc = tauc ?? fo.t0;
  return { Kc: fo.tau / (fo.K * (tc + fo.t0)), Ti: Math.min(fo.tau, 4 * (tc + fo.t0)), Td: 0 };
}

/** 3b. AMIGO PID (Åström y Hägglund 2006, ref. [7]), FOPDT con L = t0 y T = τ */
export function amigo(m: Fopdt): IsaGains {
  const L = m.t0;
  const T = m.tau;
  return {
    Kc: (1 / m.K) * (0.2 + 0.45 * (T / L)),
    Ti: (L * (0.4 * L + 0.8 * T)) / (L + 0.1 * T),
    Td: (0.5 * L * T) / (0.3 * L + T),
  };
}

/** 3c. Cohen–Coon PID (1953, ref. [6]), el ejemplo de formato de la guía */
export function cohenCoon(m: Fopdt): IsaGains {
  const r = m.t0 / m.tau;
  return {
    Kc: (1 / m.K) * (1 / r) * (4 / 3 + r / 4),
    Ti: (m.t0 * (32 + 6 * r)) / (13 + 8 * r),
    Td: (m.t0 * 4) / (11 + 2 * r),
  };
}

export type GroupRule = 'simc' | 'amigo' | 'cohen-coon';

export const GROUP_RULES: Record<GroupRule, { label: string; ref: string }> = {
  simc: { label: 'SIMC (Skogestad)', ref: 'S. Skogestad, J. Process Control, vol. 13, n.º 4, pp. 291–309, 2003 [8]' },
  amigo: { label: 'AMIGO (Åström–Hägglund)', ref: 'K. J. Åström y T. Hägglund, Advanced PID Control, ISA, 2006 [7]' },
  'cohen-coon': { label: 'Cohen–Coon', ref: 'G. H. Cohen y G. A. Coon, Trans. ASME, vol. 75, pp. 827–834, 1953 [6]' },
};

export function groupRule(rule: GroupRule, so: Sopdt, fo: Fopdt, tauc?: number): IsaGains {
  if (rule === 'amigo') return amigo(fo);
  if (rule === 'cohen-coon') return cohenCoon(fo);
  return simc(so, fo, tauc);
}
