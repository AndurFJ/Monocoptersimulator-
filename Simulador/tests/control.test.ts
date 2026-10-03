/**
 * control.test.ts — identificación de segundo orden, reglas de sintonía y gemelo
 * digital, verificados contra los números publicados en la guía de la Etapa 2.
 */

import { describe, it, expect } from 'vitest';
import { stepNormalized, xAt, ratioR, simulate, fitPercent } from '../src/control/sopdt';
import { TABLE_1, threePoint, lookupTable, analyzeStep, classify } from '../src/control/threePoint';
import { refineSopdt } from '../src/control/refine';
import {
  zieglerNichols, lambdaTuning, cohenCoon, simc, amigo, isaToParallel, parallelToIsa,
} from '../src/control/tuning';
import { IsaPid } from '../src/control/isaPid';
import { runTwin, twinMetrics } from '../src/control/twin';
import type { TwinConfig } from '../src/control/twin';

describe('respuesta de segundo orden', () => {
  it('reproduce la Tabla 1 de la guía (R, x10, x50, x90)', () => {
    for (const row of TABLE_1) {
      expect(ratioR(row.zeta)).toBeCloseTo(row.R, 2);
      expect(xAt(0.1, row.zeta)).toBeCloseTo(row.x10, 2);
      expect(xAt(0.5, row.zeta)).toBeCloseTo(row.x50, 2);
      expect(xAt(0.9, row.zeta)).toBeCloseTo(row.x90, 2);
    }
  });

  it('R se aplana en ≈ 2.74 para ζ grande (polo dominante)', () => {
    expect(ratioR(20)).toBeGreaterThan(2.7);
    expect(ratioR(20)).toBeLessThan(2.74);
  });

  it('el subamortiguado pasa de 1 y el sobreamortiguado no', () => {
    const peak = (z: number) => Math.max(...Array.from({ length: 400 }, (_, i) => stepNormalized(i * 0.05, z)));
    expect(peak(0.5)).toBeGreaterThan(1.1);
    expect(peak(1.5)).toBeLessThanOrEqual(1);
  });
});

describe('método de tres puntos', () => {
  // Ejemplo resuelto de la guía: m = 0.120 kg, Δu = +150 µs, Δy = 30 cm
  const r = threePoint({ du: 150, dy: 30, t10: 0.53, t50: 1.19, t90: 2.71, massKg: 0.12 });

  it('da los números del ejemplo resuelto de la guía', () => {
    expect(r.K).toBeCloseTo(0.2, 3);
    expect(r.R).toBeCloseTo(2.303, 3);
    expect(r.zeta).toBeCloseTo(1.21, 2);
    expect(r.wn).toBeCloseTo(2.03, 2);
    expect(r.theta).toBeCloseTo(0.26, 2);
    expect(r.poles[0].re).toBeCloseTo(-1.07, 1);
    expect(r.poles[1].re).toBeCloseTo(-3.84, 1);
    expect(r.tau![0]).toBeCloseTo(0.93, 2);
    expect(r.tau![1]).toBeCloseTo(0.26, 2);
    expect(r.ke!).toBeCloseTo(0.494, 2);
    expect(r.B!).toBeCloseTo(0.589, 2);
    expect(r.kF!).toBeCloseTo(9.9e-4, 5);
    expect(r.dampingCase).toBe('sobreamortiguado');
  });

  it('interpola entre las filas correctas de la Tabla 1', () => {
    const t = lookupTable(2.303);
    expect(t.lo?.zeta).toBe(1.2);
    expect(t.hi?.zeta).toBe(1.3);
    expect(lookupTable(2.75).outOfRange).toBe('alto');
    expect(lookupTable(0.5).outOfRange).toBe('bajo');
  });

  it('clasifica con los umbrales de la guía', () => {
    expect(classify(0.7, 1.3)).toBe('subamortiguado');
    expect(classify(1.0, 1.93)).toBe('critico');
    expect(classify(1.3, 2.4)).toBe('sobreamortiguado');
    expect(classify(2.5, 2.71)).toBe('polo-dominante');
  });

  it('recupera el modelo de un ensayo simulado con ruido', () => {
    const truth = { K: 0.34, zeta: 1.3, wn: 3, theta: 0.4 };
    const t = Array.from({ length: 27 / 0.05 + 1 }, (_, i) => i * 0.05);
    // Ensayo R de la guía: 3 s en u0, 12 s en u0 + Δu, 12 s en u0
    const u = t.map((x) => (x >= 3 && x < 15 ? 1940 : 1870));
    let seed = 7;
    const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.6; };
    const y = simulate(truth, t, u, 1870, 21).map((v) => v + noise());
    const a = analyzeStep({ t, y, u })!;
    expect(a).not.toBeNull();
    expect(a.du).toBe(70);
    expect(a.result.K).toBeCloseTo(0.34, 1);
    expect(a.result.wn).toBeGreaterThan(2.2);
    expect(a.result.wn).toBeLessThan(3.8);
    expect(a.result.theta).toBeGreaterThan(0.25);
    expect(a.result.theta).toBeLessThan(0.55);
    // El ajuste fino mejora (o iguala) el Fit del modelo de tres puntos
    const w = { t: t.slice(0, 15 / 0.05), y: y.slice(0, 15 / 0.05), u: u.slice(0, 15 / 0.05), u0: a.u0, y0: a.y0 };
    const first = fitPercent(w.y, simulate(a.result.model, w.t, w.u, w.u0, w.y0));
    const refined = refineSopdt(a.result.model, w);
    expect(refined.fit).toBeGreaterThanOrEqual(first - 0.5);
    expect(refined.fit).toBeGreaterThan(85);
  });
});

describe('reglas de sintonía', () => {
  const so = { K: 0.2, zeta: 1.21, wn: 2.03, theta: 0.26 };
  const fo = { K: 0.2, tau: 1.01, t0: 0.48 };

  it('Ziegler–Nichols y Lambda dan las ganancias de la guía', () => {
    const zn = zieglerNichols(fo);
    expect(zn.Kc).toBeCloseTo(12.6, 1);
    expect(zn.Ti).toBeCloseTo(0.96, 2);
    expect(zn.Td).toBeCloseTo(0.24, 2);
    const lam = lambdaTuning(so, 2 * so.theta);
    expect(lam.Kc).toBeCloseTo(7.63, 1);
    expect(lam.Ti).toBeCloseTo(1.19, 2);
    expect(lam.Td).toBeCloseTo(0.20, 2);
  });

  it('Cohen–Coon da el ejemplo de formato de la guía', () => {
    const cc = cohenCoon(fo);
    expect(cc.Kc).toBeCloseTo(15.2, 0);
    expect(cc.Ti).toBeCloseTo(1.0, 1);
    expect(cc.Td).toBeCloseTo(0.16, 2);
  });

  it('SIMC y AMIGO dan ganancias positivas y razonables', () => {
    for (const g of [simc(so, fo), amigo(fo), simc({ ...so, zeta: 0.7 }, fo)]) {
      expect(g.Kc).toBeGreaterThan(0);
      expect(g.Ti).toBeGreaterThan(0);
      expect(g.Td).toBeGreaterThanOrEqual(0);
    }
  });

  it('ISA ↔ paralela es el mismo controlador', () => {
    const g = { Kc: 7.71, Ti: 1.19, Td: 0.2 };
    const p = isaToParallel(g);
    expect(p.kp).toBeCloseTo(7.71);
    expect(p.ki).toBeCloseTo(7.71 / 1.19);
    expect(p.kd).toBeCloseTo(1.542);
    const back = parallelToIsa(p);
    expect(back.Ti).toBeCloseTo(1.19);
    expect(back.Td).toBeCloseTo(0.2);
  });
});

describe('PID ISA de la sección 4.4', () => {
  const cfg = { ts: 0.05, uMin: 1100, uMax: 1800, N: 10 };

  it('pasa a AUTO sin salto', () => {
    const pid = new IsaPid({ Kc: 8, Ti: 1, Td: 0.2 }, cfg);
    pid.start(1400, 20);
    expect(pid.update(20, 20).u).toBe(1400);
  });

  it('un salto del setpoint no golpea la derivada (derivada sobre la medición)', () => {
    const pid = new IsaPid({ Kc: 8, Ti: 0, Td: 0.5 }, cfg);
    pid.start(1400, 20);
    const out = pid.update(40, 20);
    expect(out.d).toBe(0);
    expect(out.u).toBe(1400 + 8 * 20);
  });

  it('Ti = 0 desactiva la integral', () => {
    const pid = new IsaPid({ Kc: 1, Ti: 0, Td: 0 }, cfg);
    pid.start(1400, 20);
    for (let k = 0; k < 100; k++) pid.update(25, 20);
    expect(pid.update(25, 20).i).toBe(0);
  });

  it('anti-windup: la integral no crece mientras u está saturado', () => {
    const pid = new IsaPid({ Kc: 50, Ti: 0.5, Td: 0 }, cfg);
    pid.start(1400, 20);
    const first = pid.update(60, 20);
    expect(first.saturated).toBe(true);
    for (let k = 0; k < 200; k++) pid.update(60, 20);
    expect(pid.update(60, 20).i).toBe(first.i);
  });
});

describe('gemelo digital', () => {
  // Modelo del ejemplo de la guía con θ en muestras enteras (5 × 50 ms)
  const cfg: TwinConfig = {
    plant: { K: 0.2, zeta: 1.21, wn: 2.03, theta: 0.2577 },
    u0: 1400, y0: 20, ts: 0.05, uMin: 1100, uMax: 1800, N: 10,
    profile: [20, 40, 30, 50], segment: 12,
  };
  const m = (g: { Kc: number; Ti: number; Td: number }) => twinMetrics(runTwin(g, cfg), cfg);

  it('reproduce la tabla de la guía (Mp, ts, IAE y rango de u del tramo 20 → 40)', () => {
    const zn = m({ Kc: 12.54, Ti: 0.96, Td: 0.24 });
    expect(zn.segments[0].mp).toBeCloseTo(22.2, 0);
    expect(zn.segments[0].ts!).toBeCloseTo(3.35, 1);
    expect(zn.segments[0].iae).toBeCloseTo(19.1, 0);
    expect(zn.uLo).toBeCloseTo(1342, -1);
    expect(zn.uHi).toBeCloseTo(1766, -1);

    const lam = m({ Kc: 7.71, Ti: 1.19, Td: 0.20 });
    expect(lam.segments[0].mp).toBeCloseTo(5.1, 0);
    expect(lam.segments[0].ts!).toBeCloseTo(3.75, 0);
    expect(lam.segments[0].iae).toBeCloseTo(19.5, 0);
    expect(lam.uLo).toBeCloseTo(1400, -1);
    expect(lam.uHi).toBeCloseTo(1638, -1);
    expect(lam.saturated).toBe(false);

    const cc = m({ Kc: 15.19, Ti: 1.0, Td: 0.16 });
    expect(cc.segments[0].mp).toBeGreaterThan(39);
    expect(cc.segments[0].mp).toBeLessThan(43);
    expect(cc.uHi).toBe(1800);
    expect(cc.saturated).toBe(true);
  });

  it('error estacionario nulo con acción integral', () => {
    const lam = m({ Kc: 7.71, Ti: 1.19, Td: 0.20 });
    for (const s of lam.segments) expect(s.ess).toBeLessThan(0.05);
  });
});
