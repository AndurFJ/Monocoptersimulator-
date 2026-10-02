/**
 * stepSequence.test.ts — ensayo de escalón automático en el banco.
 */

import { describe, it, expect } from 'vitest';
import { StepSequence, trimStepTest } from '../src/core/StepSequence';
import type { StepCommand, StepUpdate } from '../src/core/StepSequence';
import type { TelemetrySample } from '../src/data/types';

const TS = 0.05;

/** Banco de mentira: la placa aplica el último set_pwm/stop y el escalón como el firmware */
class FakeBench {
  pwm = 1000;
  u0 = 1762;
  /** Simula una placa que no recibe el set_u0 */
  ignoreU0 = false;
  private stepAt: number | null = null;

  apply(cmds: StepCommand[], t: number): void {
    for (const c of cmds) {
      if (c.action === 'set_pwm') { this.pwm = c.value; this.stepAt = null; }
      if (c.action === 'set_u0' && !this.ignoreU0) this.u0 = c.value;
      if (c.action === 'stop') { this.pwm = 1000; this.stepAt = null; }
      if (c.action === 'start_step') this.stepAt = t;
    }
  }

  tick(t: number): number {
    if (this.stepAt !== null) {
      const e = t - this.stepAt;
      this.pwm = e < 5 ? this.u0 : e < 15 ? this.u0 + 50 : 1000;
      if (e >= 15) this.stepAt = null;
    }
    return this.pwm;
  }
}

interface RunResult { log: StepUpdate[]; t: number; bench: FakeBench }

/** Corre la secuencia con una altura dada en función de (t, pwm) */
function run(
  seq: StepSequence,
  height: (t: number, pwm: number) => number,
  seconds: number,
  bench = new FakeBench(),
  t0 = 0,
): RunResult {
  const log: StepUpdate[] = [];
  const first = seq.start(t0, height(t0, bench.pwm));
  bench.apply(first.commands, t0);
  log.push(first);
  let t = t0;
  for (let i = 1; i <= Math.round(seconds / TS) && seq.active; i++) {
    t = t0 + i * TS;
    const pwm = bench.tick(t);
    const u = seq.push(t, height(t, pwm), pwm);
    bench.apply(u.commands, t);
    log.push(u);
  }
  return { log, t, bench };
}

const sentPwm = (log: StepUpdate[]) =>
  log.flatMap((u) => u.commands).filter((c) => c.action === 'set_pwm').map((c) => (c as { value: number }).value);

/** Planta simple: despega con ≥ 1890 µs; en el aire, 20 cm en u₀ = 1840 y +0.43 cm/µs */
function plant() {
  let airborne = false;
  return (_t: number, pwm: number) => {
    if (pwm <= 1000) airborne = false;
    if (pwm >= 1890) airborne = true;
    return airborne ? 20 + 0.43 * (pwm - 1840) : 11;
  };
}

describe('StepSequence', () => {
  it('despega con rampa, espera quieto en u₀ y termina el escalón', () => {
    const seq = new StepSequence({ u0: 1840 });
    const { log } = run(seq, plant(), 60);

    expect(log[0].commands).toEqual([
      { type: 'cmd', action: 'set_u0', value: 1840 },
      { type: 'cmd', action: 'set_pwm', value: 1860 },
    ]);
    // Rampa 1860 → 1890 (despega) y vuelta a u₀
    expect(sentPwm(log)).toEqual([1860, 1870, 1880, 1890, 1840]);
    const all = log.flatMap((u) => u.commands.map((c) => c.action));
    expect(all.filter((a) => a === 'start_step')).toHaveLength(1);
    expect(all).not.toContain('stop');
    expect(seq.phase).toBe('listo');
  });

  it('si el carro ya flota, salta el despegue', () => {
    const seq = new StepSequence({ u0: 1840 });
    const u = seq.start(0, 20);
    expect(seq.phase).toBe('estabilizando');
    expect(u.commands[1]).toEqual({ type: 'cmd', action: 'set_pwm', value: 1840 });
  });

  it('espera los 5 s quieto antes de pedir el escalón', () => {
    const seq = new StepSequence({ u0: 1840 });
    seq.start(0, 20);
    let stepT: number | null = null;
    for (let i = 1; i <= 200 && stepT === null; i++) {
      const t = i * TS;
      const u = seq.push(t, 20 + (i % 2) * 0.5, 1840);
      if (u.commands.some((c) => c.action === 'start_step')) stepT = t;
    }
    expect(stepT).toBeCloseTo(5, 1);
    expect(seq.stepStartT).toBeCloseTo(5, 1);
  });

  it('aborta si no despega ni con el tope de la rampa', () => {
    const seq = new StepSequence({ u0: 1840 });
    const { log } = run(seq, () => 11, 60);
    expect(seq.phase).toBe('abortado');
    expect(seq.reason).toContain('no despegó');
    expect(Math.max(...sentPwm(log))).toBe(1950);
    expect(log[log.length - 1].commands).toEqual([{ type: 'cmd', action: 'stop' }]);
  });

  it('aborta si en u₀ el carro vuelve a la base', () => {
    const seq = new StepSequence({ u0: 1840 });
    // Despega con 1890 pero 1840 no lo sostiene
    run(seq, (_t, pwm) => (pwm >= 1890 ? 16 : 11), 30);
    expect(seq.phase).toBe('abortado');
    expect(seq.reason).toContain('volvió a la base');
  });

  it('aborta y sugiere bajar u₀ si sigue subiendo', () => {
    const seq = new StepSequence({ u0: 1840 });
    seq.start(0, 20);
    let u: StepUpdate | null = null;
    for (let i = 1; i <= 700 && seq.active; i++) u = seq.push(i * TS, 20 + i * TS * 0.5, 1840);
    expect(seq.phase).toBe('abortado');
    expect(seq.reason).toContain('baja u₀');
    expect(u!.commands).toEqual([{ type: 'cmd', action: 'stop' }]);
  });

  it('aborta si pasa de la altura máxima (3 muestras seguidas)', () => {
    const seq = new StepSequence({ u0: 1840 });
    seq.start(0, 20);
    expect(seq.push(0.05, 65, 1840).commands).toEqual([]);
    expect(seq.push(0.10, 65, 1840).commands).toEqual([]);
    expect(seq.push(0.15, 65, 1840).commands).toEqual([{ type: 'cmd', action: 'stop' }]);
    expect(seq.phase).toBe('abortado');
  });

  it('aborta si la ESP32 no tomó u₀ (escalón con el u₀ viejo)', () => {
    const seq = new StepSequence({ u0: 1840 });
    const bench = new FakeBench();
    bench.ignoreU0 = true; // hace el escalón con el u₀ viejo: 1762 → 1812
    run(seq, plant(), 60, bench);
    expect(seq.phase).toBe('abortado');
    expect(seq.reason).toContain('no tomó u₀');
    expect(bench.pwm).toBe(1000);
  });

  it('no vuelve a encender el motor si alguien lo apagó durante el despegue', () => {
    const seq = new StepSequence({ u0: 1840 });
    seq.start(0, 11);
    expect(seq.push(0.3, 11, 1000).commands).toEqual([]); // aún puede no haber llegado el comando
    const u = seq.push(0.7, 11, 1000);
    expect(seq.phase).toBe('abortado');
    expect(seq.reason).toContain('se detuvo');
    expect(u.commands).toEqual([{ type: 'cmd', action: 'stop' }]);
  });

  it('detecta el apagado aunque la rampa siga mandando comandos', () => {
    const seq = new StepSequence({ u0: 1840 });
    seq.start(0, 11);
    let t = 0;
    for (let i = 1; i <= 30; i++) seq.push((t = i * TS), 11, 1860 + 10 * Math.floor(i / 8)); // rampa en marcha
    expect(seq.phase).toBe('despegue');
    const u = seq.push(t + TS, 11, 1000); // otro dispositivo pulsó parada
    expect(seq.phase).toBe('abortado');
    expect(u.commands).toEqual([{ type: 'cmd', action: 'stop' }]);
  });

  it('tras abortar no manda nada más', () => {
    const seq = new StepSequence({ u0: 1840 });
    seq.start(0, 11);
    expect(seq.abort('prueba').commands).toEqual([{ type: 'cmd', action: 'stop' }]);
    expect(seq.push(1, 11, 1000)).toEqual({ commands: [], phaseChanged: false });
    expect(seq.abort('otra vez').commands).toEqual([]);
  });
});

describe('trimStepTest', () => {
  it('deja solo desde el escalón hasta antes del apagado', () => {
    const s = (t: number, pwm: number): TelemetrySample => ({ t, height: 0.2, pwm });
    const samples = [s(0, 1890), s(1, 1840), s(2, 1840), s(3, 1890), s(4, 1890), s(5, 1000), s(6, 1000)];
    expect(trimStepTest(samples, 2).map((x) => [x.t, x.pwm])).toEqual([[2, 1840], [3, 1890], [4, 1890]]);
  });

  it('el archivo del ensayo completo empieza en u₀ y tiene un solo salto', () => {
    const seq = new StepSequence({ u0: 1840 });
    const p = plant();
    const samples: TelemetrySample[] = [];
    const bench = new FakeBench();
    bench.apply(seq.start(0, 11).commands, 0);
    for (let i = 1; i <= 1200; i++) {
      const t = i * TS;
      const pwm = bench.tick(t);
      const h = p(t, pwm);
      samples.push({ t, height: h / 100, pwm });
      bench.apply(seq.push(t, h, pwm).commands, t);
    }
    expect(seq.phase).toBe('listo');
    const data = trimStepTest(samples, seq.stepStartT);
    expect(data[0].pwm).toBe(1840);
    expect(data[data.length - 1].pwm).toBe(1890);
    const jumps = data.slice(1).filter((x, i) => x.pwm !== data[i].pwm);
    expect(jumps).toHaveLength(1);
    expect(data[data.length - 1].t - data[0].t).toBeGreaterThan(14);
  });
});
