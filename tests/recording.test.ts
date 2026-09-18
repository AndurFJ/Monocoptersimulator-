/**
 * recording.test.ts — grabación y remuestreo para PID Tuner.
 */

import { describe, it, expect } from 'vitest';
import { Recorder, estimateSampleTime, resampleUniform, pidTunerRows, rawRows } from '../src/data/recording';
import type { TelemetrySample } from '../src/data/types';
import { zoneOf, longestSpanSegment } from '../src/physics/zones';

const s = (t: number, height: number, pwm: number, setpoint?: number): TelemetrySample =>
  ({ t, height, pwm, setpoint });

describe('Recorder', () => {
  it('acumula y empieza de nuevo si el tiempo retrocede', () => {
    const r = new Recorder();
    r.push(s(0, 0.1, 1000));
    r.push(s(0.02, 0.1, 1100));
    r.push(s(0.02, 0.1, 1100)); // duplicado
    expect(r.count).toBe(2);
    expect(r.duration).toBeCloseTo(0.02);
    r.push(s(0, 0.2, 1000)); // nueva conexión
    expect(r.count).toBe(1);
  });
});

describe('estimateSampleTime', () => {
  it('usa la mediana de los intervalos (robusta al jitter)', () => {
    const ts = [0, 0.02, 0.04, 0.061, 0.079, 0.099, 0.119, 0.3]; // jitter + un hueco
    expect(estimateSampleTime(ts.map((t) => s(t, 0, 0)))).toBe(0.02);
  });
});

describe('resampleUniform', () => {
  const data = [s(10, 0.10, 1000), s(10.03, 0.13, 1500), s(10.05, 0.15, 1500), s(10.1, 0.20, 1200)];
  const out = resampleUniform(data, 0.02);

  it('produce tiempo con paso constante empezando en 0', () => {
    expect(out.t).toEqual([0, 0.02, 0.04, 0.06, 0.08, 0.1]);
  });

  it('interpola linealmente la altura', () => {
    expect(out.y[1]).toBeCloseTo(0.12); // entre (0, 0.10) y (0.03, 0.13)
    expect(out.y[2]).toBeCloseTo(0.14);
    expect(out.y[5]).toBeCloseTo(0.20);
  });

  it('retiene el PWM (orden cero), sin inventar valores intermedios', () => {
    expect(out.u).toEqual([1000, 1000, 1500, 1500, 1500, 1200]);
  });
});

describe('hojas de Excel', () => {
  it('PID_Tuner tiene cabecera y columnas en cm y normalizadas', () => {
    const rows = pidTunerRows(resampleUniform([s(0, 0.1, 1000, 0.3), s(0.02, 0.12, 2000, 0.3)], 0.02));
    expect(rows[0]).toEqual(['t_s', 'u_pwm', 'y_cm', 'u_norm', 'y_m', 'en_span', 'setpoint_cm']);
    expect(rows[2]).toEqual([0.02, 2000, 12, 1, 0.12, 1, 30]);
  });

  it('Datos_crudos omite setpoint si la fuente no lo da', () => {
    const rows = rawRows([s(5, 0.1, 1000), s(5.02, 0.11, 1010)]);
    expect(rows[0]).toEqual(['t_s', 'altura_cm', 'pwm', 'zona']);
    expect(rows[2]).toEqual([0.02, 11, 1010, 'util']);
  });
});

describe('zonas', () => {
  it('clasifica por fracción del recorrido', () => {
    expect(zoneOf(0.02)).toBe('muerta');
    expect(zoneOf(0.4)).toBe('util');
    expect(zoneOf(0.7)).toBe('inestable');
  });

  it('encuentra el tramo continuo más largo dentro del span', () => {
    expect(longestSpanSegment([0.02, 0.2, 0.3, 0.7, 0.2, 0.3, 0.4, 0.5, 0.02])).toEqual({ start: 4, end: 7 });
    expect(longestSpanSegment([0.02, 0.7])).toBeNull();
  });
});
