/**
 * metrics.test.ts — métricas de respuesta al escalón.
 */

import { describe, it, expect } from 'vitest';
import { StepMetrics } from '../src/core/StepMetrics';
import type { StepResult } from '../src/core/StepMetrics';

/** Respuesta de 2º orden subamortiguada de 0 a `sp` */
function secondOrder(t: number, sp: number, zeta = 0.4, wn = 4): number {
  const wd = wn * Math.sqrt(1 - zeta * zeta);
  const phi = Math.acos(zeta);
  return sp * (1 - (Math.exp(-zeta * wn * t) / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t + phi));
}

function run(m: StepMetrics, sp: number, seconds: number, t0 = 0, f = secondOrder): StepResult {
  let r: StepResult | null = null;
  for (let t = 0; t <= seconds; t += 0.02) {
    r = m.push({ t: t0 + t, height: f(t, sp), pwm: 1500, setpoint: sp });
  }
  return r!;
}

describe('StepMetrics', () => {
  it('mide sobrepico, subida y establecimiento de una respuesta conocida', () => {
    const r = run(new StepMetrics(), 0.3, 6);
    const zeta = 0.4;
    const expectedOvershoot = 100 * Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
    expect(r.overshoot).toBeCloseTo(expectedOvershoot, 0);
    expect(r.riseTime).toBeGreaterThan(0.2);
    expect(r.riseTime).toBeLessThan(0.6);
    expect(r.settled).toBe(true);
    expect(r.settlingTime).toBeGreaterThan(1);
    expect(r.settlingTime).toBeLessThan(3.5);
    expect(Math.abs(r.steadyError!)).toBeLessThan(0.002);
  });

  it('no se declara estable mientras oscila', () => {
    const r = run(new StepMetrics(), 0.3, 0.8);
    expect(r.settled).toBe(false);
    expect(r.settlingTime).toBeNull();
  });

  it('un cambio de setpoint empieza un escalón nuevo', () => {
    const m = new StepMetrics();
    run(m, 0.3, 6);
    const r = m.push({ t: 6.1, height: 0.3, pwm: 1500, setpoint: 0.5 });
    expect(r!.setpoint).toBe(0.5);
    expect(r!.step).toBeCloseTo(0.2);
    expect(r!.overshoot).toBe(0);
    expect(r!.settled).toBe(false);
  });

  it('sin setpoint (modo manual) no hay métricas', () => {
    expect(new StepMetrics().push({ t: 0, height: 0.1, pwm: 1500 })).toBeNull();
  });
});
