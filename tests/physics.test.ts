/**
 * physics.test.ts — tests del modelo físico y el PID.
 */

import { describe, it, expect } from 'vitest';
import { MonocopterModel, hoverThrottle, restHeight } from '../src/physics/MonocopterModel';
import { PIDController } from '../src/physics/PIDController';
import { SimulationSource } from '../src/data/SimulationSource';
import {
  H_MAX, SPRING_ENGAGE_HEIGHT_M, PID_DT, DEAD_ZONE_TOP_M, UNSTABLE_ZONE_START_M,
} from '../src/physics/constants';

/** Generador pseudoaleatorio determinista (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('MonocopterModel', () => {
  it('arranca en reposo sobre los resortes', () => {
    const m = new MonocopterModel();
    expect(m.state.height).toBeCloseTo(restHeight(), 6);
    m.step(0, 1);
    expect(m.state.height).toBeCloseTo(restHeight(), 3);
    expect(Math.abs(m.state.velocity)).toBeLessThan(1e-3);
  });

  it('el carro no puede salir de [0, h_max]', () => {
    const m = new MonocopterModel();
    for (let i = 0; i < 500; i++) m.step(1, PID_DT);
    expect(m.state.height).toBeLessThanOrEqual(H_MAX);
    expect(m.state.height).toBeCloseTo(H_MAX, 6);

    // Sin resortes el carro caería hasta el tope inferior
    const noSprings = new MonocopterModel({ springStiffness: 0 });
    for (let i = 0; i < 500; i++) noSprings.step(0, PID_DT);
    expect(noSprings.state.height).toBeGreaterThanOrEqual(0);
    expect(noSprings.state.height).toBeCloseTo(0, 6);
  });

  it('con PWM=0 el carro cae por gravedad', () => {
    const m = new MonocopterModel();
    for (let i = 0; i < 100; i++) m.step(1, PID_DT); // subir
    const hTop = m.state.height;
    m.step(0, 0.1);
    expect(m.state.velocity).toBeLessThan(0);
    for (let i = 0; i < 300; i++) m.step(0, PID_DT);
    expect(m.state.height).toBeLessThan(hTop);
    expect(m.state.height).toBeLessThan(SPRING_ENGAGE_HEIGHT_M);
  });

  it('los resortes actúan solo cerca del fondo', () => {
    const m = new MonocopterModel();
    expect(m.springForce(SPRING_ENGAGE_HEIGHT_M + 0.01)).toBe(0);
    expect(m.springForce(0.5)).toBe(0);
    expect(m.springForce(SPRING_ENGAGE_HEIGHT_M - 0.01)).toBeGreaterThan(0);
  });

  it('con el throttle de hover el carro no acelera', () => {
    const m = new MonocopterModel({ friction: 0 });
    // Llevarlo a media altura sin velocidad
    for (let i = 0; i < 40; i++) m.step(1, PID_DT);
    const h0 = m.state.height;
    const v0 = m.state.velocity;
    m.step(hoverThrottle(m.params), 0.001);
    // Solo actúa el amortiguamiento: la velocidad cambia muy poco
    expect(Math.abs(m.state.velocity - v0)).toBeLessThan(0.01);
    expect(m.state.height).toBeGreaterThan(h0 - 0.01);
  });
});

describe('PIDController', () => {
  it('calcula P, I y D según la spec', () => {
    const pid = new PIDController(2, 0.5, 0.8, 0.02, 1);
    const a = pid.update(0.1);
    expect(a.p).toBeCloseTo(0.2);
    expect(a.i).toBeCloseTo(0.5 * 0.1 * 0.02);
    expect(a.d).toBe(0); // primera muestra: sin derivative kick
    const b = pid.update(0.05);
    expect(b.d).toBeCloseTo(0.8 * (0.05 - 0.1) / 0.02);
  });

  it('satura la salida a [0, 1]', () => {
    const pid = new PIDController(10, 0, 0, 0.02, 1);
    expect(pid.update(1).output).toBe(1);
    expect(pid.update(-1).output).toBe(0);
  });

  it('el anti-windup del integral funciona', () => {
    const pid = new PIDController(0, 1, 0, 0.02, 0.5);
    for (let i = 0; i < 10_000; i++) pid.update(1);
    expect(pid.integralState).toBeCloseTo(0.5);
    // Al invertirse el error, el integral se descarga desde el límite, no desde 200
    for (let i = 0; i < 25; i++) pid.update(-1);
    expect(pid.integralState).toBeCloseTo(0);
  });

  it('reset limpia el estado interno', () => {
    const pid = new PIDController(1, 1, 1, 0.02, 1);
    pid.update(0.3);
    pid.update(0.2);
    pid.reset();
    const out = pid.update(0.1);
    expect(pid.integralState).toBeCloseTo(0.1 * 0.02);
    expect(out.d).toBe(0);
  });
});

describe('SimulationSource (PID en lazo cerrado)', () => {
  it('con PID y setpoint razonable, el sistema converge', () => {
    const sim = new SimulationSource(seeded(42));
    sim.setpoint = 0.4;
    const samples = [];
    for (let i = 0; i < 20 / PID_DT; i++) samples.push(sim.stepOnce()); // 20 s
    const tail = samples.slice(-100); // últimos 2 s
    const meanH = tail.reduce((s, x) => s + x.height, 0) / tail.length;
    expect(meanH).toBeGreaterThan(0.37);
    expect(meanH).toBeLessThan(0.43);
    expect(Math.abs(sim.model.state.height - 0.4)).toBeLessThan(0.03);
  });

  it('en modo manual el PWM mínimo deja el carro en reposo', () => {
    const sim = new SimulationSource(seeded(1));
    sim.setControlMode('manual');
    for (let i = 0; i < 100; i++) sim.stepOnce();
    expect(sim.model.state.height).toBeCloseTo(restHeight(), 3);
  });
});

describe('Dinámica del motor', () => {
  it('el empuje sigue al comando con retardo', () => {
    const m = new MonocopterModel();
    m.step(1, m.params.motorTimeConstant);
    // Tras una constante de tiempo el motor va por ~63 %
    expect(m.motorThrottle).toBeGreaterThan(0.6);
    expect(m.motorThrottle).toBeLessThan(0.66);
    m.step(1, 1);
    expect(m.motorThrottle).toBeCloseTo(1, 3);
  });

  it('con τ = 0 el motor es instantáneo', () => {
    const m = new MonocopterModel({ motorTimeConstant: 0 });
    m.step(0.7, 0.002);
    expect(m.motorThrottle).toBeCloseTo(0.7);
  });
});

describe('Zonas de operación', () => {
  const settle = (sp: number, seed: number) => {
    const sim = new SimulationSource(seeded(seed));
    sim.setpoint = sp;
    const hs: number[] = [];
    for (let i = 0; i < 30 / PID_DT; i++) {
      sim.stepOnce();
      if (i > 15 / PID_DT) hs.push(sim.model.state.height);
    }
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
    const sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / hs.length);
    return { mean, sd, max: Math.max(...hs) };
  };

  it('zona muerta: un setpoint por debajo del 10 % no se alcanza', () => {
    const { mean } = settle(DEAD_ZONE_TOP_M / 3, 3);
    expect(mean).toBeGreaterThan(restHeight() - 0.005);
    expect(mean).toBeGreaterThan(DEAD_ZONE_TOP_M / 3 + 0.03);
  });

  it('span: estable dentro del 10–85 %', () => {
    const { mean, sd } = settle(0.5 * (DEAD_ZONE_TOP_M + UNSTABLE_ZONE_START_M), 4);
    expect(Math.abs(mean - 0.5 * (DEAD_ZONE_TOP_M + UNSTABLE_ZONE_START_M))).toBeLessThan(0.005);
    expect(sd).toBeLessThan(0.005);
  });

  it('zona inestable: por encima del 85 % no se mantiene', () => {
    const sp = UNSTABLE_ZONE_START_M + 0.6 * (H_MAX - UNSTABLE_ZONE_START_M);
    const { sd, max } = settle(sp, 5);
    const stable = settle(0.4, 5);
    // O se pega al techo o oscila mucho más que en el span
    expect(max >= H_MAX - 1e-6 || sd > 5 * stable.sd).toBe(true);
  });

  it('el efecto techo solo actúa en la zona inestable', () => {
    const m = new MonocopterModel();
    expect(m.ceilingFactor(UNSTABLE_ZONE_START_M - 0.01)).toBe(1);
    expect(m.ceilingFactor(H_MAX)).toBeGreaterThan(1);
    expect(m.ceilingFactor(H_MAX)).toBeGreaterThan(m.ceilingFactor(UNSTABLE_ZONE_START_M + 0.02));
  });
});
