/**
 * physics.test.ts — tests de la planta, el sensor, el PID y la simulación.
 */

import { describe, it, expect } from 'vitest';
import { MonocopterModel, hoverThrottle, restHeight } from '../src/physics/MonocopterModel';
import { IdentifiedPlant } from '../src/physics/IdentifiedPlant';
import { PIDController } from '../src/physics/PIDController';
import { SensorFilter, median3 } from '../src/physics/SensorFilter';
import { SimulationSource } from '../src/data/SimulationSource';
import {
  H_MAX, SPRING_ENGAGE_HEIGHT_M, PID_DT, DEAD_ZONE_TOP_M, UNSTABLE_ZONE_START_M, REST_HEIGHT_M,
  PLANT_K_CM_PER_US, PLANT_TAU_S, PLANT_DELAY_S, PLANT_U0_US, PLANT_Y0_M, FAILSAFE_M,
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

/** Planta determinista (sin ruido de proceso ni turbulencia) */
const quietPlant = () => new IdentifiedPlant({ processNoise: 0, turbulence: 0 });

describe('IdentifiedPlant (FOPDT Fit 3)', () => {
  it('arranca y se queda apoyada en la base con el motor apagado', () => {
    const p = quietPlant();
    expect(p.state.height).toBeCloseTo(REST_HEIGHT_M, 6);
    p.step(1000, 5);
    expect(p.state.height).toBeCloseTo(REST_HEIGHT_M, 6);
  });

  it('reproduce el punto de operación y la ganancia identificada', () => {
    const p = quietPlant();
    p.step(PLANT_U0_US, 20);
    expect(p.state.height).toBeCloseTo(PLANT_Y0_M, 3);
    p.step(PLANT_U0_US + 50, 20);
    // Δy = K·Δu = 0.4302 · 50 = 21.51 cm
    expect((p.state.height - PLANT_Y0_M) * 100).toBeCloseTo(PLANT_K_CM_PER_US * 50, 1);
  });

  it('respeta el retardo y la constante de tiempo (63.2 % en t0 + τ)', () => {
    const p = quietPlant();
    p.step(PLANT_U0_US, 20);
    const y0 = p.state.height;
    const dy = (PLANT_K_CM_PER_US / 100) * 50;
    p.step(PLANT_U0_US + 50, PLANT_DELAY_S - 0.02);
    expect(p.state.height - y0).toBeLessThan(0.002 * dy); // aún no responde
    p.step(PLANT_U0_US + 50, PLANT_TAU_S + 0.02);
    expect((p.state.height - y0) / dy).toBeCloseTo(0.632, 1);
  });

  it('a 1000 µs vuelve a la base (no se queda enganchada)', () => {
    const p = quietPlant();
    p.step(1850, 15);
    expect(p.state.height).toBeGreaterThan(0.4);
    p.step(1000, 15);
    expect(p.state.height).toBeCloseTo(REST_HEIGHT_M, 3);
  });

  it('no supera el tope superior', () => {
    const p = quietPlant();
    p.step(2000, 30);
    expect(p.state.height).toBeLessThanOrEqual(H_MAX);
    expect(p.state.height).toBeCloseTo(H_MAX, 3);
  });

  it('despega por encima del PWM calculado', () => {
    const p = quietPlant();
    const lift = p.liftOffPwm();
    expect(lift).toBeGreaterThan(1700);
    expect(lift).toBeLessThan(PLANT_U0_US);
    p.step(lift - 5, 10);
    expect(p.state.height).toBeCloseTo(REST_HEIGHT_M, 4);
  });
});

describe('SensorFilter (igual al firmware)', () => {
  it('mediana de 3', () => {
    expect(median3(1, 5, 3)).toBe(3);
    expect(median3(9, 2, 2)).toBe(2);
  });

  it('ignora ecos sueltos del travesaño', () => {
    const f = new SensorFilter();
    for (let i = 0; i < 5; i++) f.push(0.30);
    expect(f.push(0.92)).toBeCloseTo(0.30, 6);
    expect(f.push(0.30)).toBeCloseTo(0.30, 6);
    // dos ecos seguidos tampoco pasan
    f.push(0.91);
    expect(f.push(0.93)).toBeCloseTo(0.30, 6);
    expect(f.push(0.30)).toBeCloseTo(0.30, 6);
  });

  it('acepta un salto real si 3 lecturas lo confirman', () => {
    const f = new SensorFilter();
    for (let i = 0; i < 5; i++) f.push(0.30);
    f.push(0.60);
    f.push(0.61);
    expect(f.push(0.60)).toBeCloseTo(0.60, 6);
  });

  it('sigue movimientos reales (< 12 cm por muestra) sin rechazarlos', () => {
    const f = new SensorFilter();
    f.push(0.15);
    let h = 0.15;
    for (let i = 0; i < 40; i++) {
      h += 0.01; // 20 cm/s
      f.push(h);
    }
    expect(f.value).toBeGreaterThan(h - 0.02);
  });

  it('sin eco y con el motor apagado: el carro está en la base', () => {
    const f = new SensorFilter();
    for (let i = 0; i < 5; i++) f.push(0.40);
    for (let i = 0; i < 9; i++) f.push(null, true);
    expect(f.value).toBeCloseTo(0.40, 6); // todavía no
    f.push(null, true);
    expect(f.value).toBeCloseTo(REST_HEIGHT_M, 6);
    expect(f.ok).toBe(false);
  });

  it('sin eco con el motor encendido mantiene el último valor', () => {
    const f = new SensorFilter();
    for (let i = 0; i < 5; i++) f.push(0.40);
    for (let i = 0; i < 20; i++) f.push(null, false);
    expect(f.value).toBeCloseTo(0.40, 6);
  });
});

describe('PIDController (µs/cm, igual al firmware)', () => {
  const limits = { uMin: 1550, uMax: 1950, iMax: 250, dFilter: 1 };

  it('calcula P, I y D en µs', () => {
    const pid = new PIDController(4, 2.5, 0.3, 0.05, 1762, limits);
    const a = pid.update(30, 20); // error 10 cm
    expect(a.p).toBeCloseTo(40);
    expect(a.i).toBeCloseTo(2.5 * 10 * 0.05);
    expect(a.d).toBeCloseTo(0); // primera muestra: sin historia
    expect(a.output).toBeCloseTo(1762 + 40 + 1.25);
    const b = pid.update(30, 21); // sube 1 cm en 50 ms → 20 cm/s
    expect(b.d).toBeCloseTo(-0.3 * 20);
  });

  it('cambiar el setpoint no produce "derivative kick"', () => {
    const pid = new PIDController(4, 0, 1, 0.05, 1762, limits);
    pid.update(30, 30);
    const out = pid.update(60, 30); // salto de setpoint, medida quieta
    expect(out.d).toBeCloseTo(0);
  });

  it('satura la salida entre u_min y u_max', () => {
    const pid = new PIDController(100, 0, 0, 0.05, 1762, limits);
    expect(pid.update(80, 10).output).toBe(1950);
    expect(pid.update(10, 80).output).toBe(1550);
  });

  it('anti-windup: no integra mientras está saturado', () => {
    const pid = new PIDController(100, 5, 0, 0.05, 1762, limits);
    for (let i = 0; i < 1000; i++) pid.update(80, 10);
    expect(pid.integralState).toBeCloseTo(0);
    const pid2 = new PIDController(0, 5, 0, 0.05, 1762, limits);
    for (let i = 0; i < 10_000; i++) pid2.update(31, 30);
    expect(pid2.integralState).toBeLessThanOrEqual(188 + 1e-9); // se frena al saturar (1762 + 188 = 1950)
  });

  it('reset limpia el estado interno', () => {
    const pid = new PIDController(1, 1, 1, 0.05, 1762, limits);
    pid.update(30, 20);
    pid.update(30, 22);
    pid.reset();
    const out = pid.update(30, 25);
    expect(pid.integralState).toBeCloseTo(5 * 0.05);
    expect(out.d).toBeCloseTo(0);
  });
});

describe('SimulationSource (planta identificada + filtro + PID)', () => {
  const run = (sim: SimulationSource, seconds: number) => {
    const out = [];
    for (let i = 0; i < seconds / PID_DT; i++) out.push(sim.stepOnce());
    return out;
  };

  it('con las ganancias por defecto llega al setpoint con poco sobrepico', () => {
    const sim = new SimulationSource(seeded(42));
    sim.setpoint = 0.4;
    const samples = run(sim, 20);
    const tail = samples.slice(-40); // últimos 2 s
    const meanH = tail.reduce((s, x) => s + x.heightTrue!, 0) / tail.length;
    expect(Math.abs(meanH - 0.4)).toBeLessThan(0.01);
    const peak = Math.max(...samples.map((x) => x.heightTrue!));
    expect(peak).toBeLessThan(0.4 + 0.1 * (0.4 - REST_HEIGHT_M)); // sobrepico < 10 %
  });

  it('los ecos del travesaño no disparan el failsafe a 30 cm', () => {
    const sim = new SimulationSource(seeded(7));
    sim.setpoint = 0.3;
    const samples = run(sim, 120);
    expect(samples.some((x) => x.failsafe)).toBe(false);
    expect(samples.some((x) => x.raw !== undefined && x.raw > 0.85)).toBe(true); // sí hubo ecos falsos
    expect(Math.max(...samples.slice(200).map((x) => x.height))).toBeLessThan(0.36);
  });

  it('en manual a 1000 µs el carro baja y se queda en la base', () => {
    const sim = new SimulationSource(seeded(1));
    sim.setControlMode('manual');
    sim.manualPwm = 1850;
    run(sim, 15);
    expect(sim.model.state.height).toBeGreaterThan(0.4);
    sim.manualPwm = 1000;
    const samples = run(sim, 15);
    expect(sim.model.state.height).toBeCloseTo(REST_HEIGHT_M, 3);
    expect(samples[samples.length - 1].height).toBeLessThan(REST_HEIGHT_M + 0.02);
  });

  it('failsafe: en manual por encima de 85 cm corta el motor', () => {
    const sim = new SimulationSource(seeded(3));
    sim.setControlMode('manual');
    sim.manualPwm = 2000;
    const samples = run(sim, 30);
    const trip = samples.findIndex((x) => x.failsafe);
    expect(trip).toBeGreaterThan(0);
    expect(samples[trip - 1].height).toBeGreaterThanOrEqual(FAILSAFE_M);
    expect(samples[samples.length - 1].pwm).toBe(1000);
    expect(sim.model.state.height).toBeLessThan(0.5); // ya va bajando
  });

  it('zona muerta: un setpoint bajo deja el carro apoyado o justo encima', () => {
    const sim = new SimulationSource(seeded(3));
    sim.setpoint = DEAD_ZONE_TOP_M;
    const samples = run(sim, 20).slice(-40);
    const mean = samples.reduce((a, s) => a + s.heightTrue!, 0) / samples.length;
    expect(Math.abs(mean - DEAD_ZONE_TOP_M)).toBeLessThan(0.01);
  });

  it('span útil: estable a mitad de recorrido', () => {
    const sp = 0.5 * (DEAD_ZONE_TOP_M + UNSTABLE_ZONE_START_M);
    const sim = new SimulationSource(seeded(4));
    sim.setpoint = sp;
    const hs = run(sim, 30).slice(-200).map((s) => s.heightTrue!);
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
    const sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / hs.length);
    expect(Math.abs(mean - sp)).toBeLessThan(0.01);
    expect(sd).toBeLessThan(0.01);
  });
});

// El modelo físico de primeros principios se conserva como referencia
// (la simulación usa la planta identificada, IdentifiedPlant).
describe('MonocopterModel (referencia física)', () => {
  it('arranca en reposo sobre los resortes', () => {
    const m = new MonocopterModel();
    expect(m.state.height).toBeCloseTo(restHeight(), 6);
    m.step(0, 1);
    expect(m.state.height).toBeCloseTo(restHeight(), 3);
  });

  it('el carro no puede salir de [0, h_max]', () => {
    const m = new MonocopterModel();
    for (let i = 0; i < 500; i++) m.step(1, PID_DT);
    expect(m.state.height).toBeCloseTo(H_MAX, 6);
  });

  it('los resortes actúan solo cerca del fondo', () => {
    const m = new MonocopterModel();
    expect(m.springForce(SPRING_ENGAGE_HEIGHT_M + 0.01)).toBe(0);
    expect(m.springForce(SPRING_ENGAGE_HEIGHT_M - 0.01)).toBeGreaterThan(0);
  });

  it('con el throttle de hover el carro no acelera', () => {
    const m = new MonocopterModel({ friction: 0 });
    for (let i = 0; i < 20; i++) m.step(1, PID_DT);
    const v0 = m.state.velocity;
    m.step(hoverThrottle(m.params), 0.001);
    expect(Math.abs(m.state.velocity - v0)).toBeLessThan(0.01);
  });
});
