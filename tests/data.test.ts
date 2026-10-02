/**
 * data.test.ts — tests del parser de tablas (Excel/CSV) y de tramas serial.
 */

import { describe, it, expect } from 'vitest';
import { parseTable, toNumber, guessLengthUnit } from '../src/data/parseTable';
import { parseSerialLine, parseColumnSpec } from '../src/data/SerialSource';

describe('toNumber', () => {
  it('acepta números, coma decimal y hh:mm:ss', () => {
    expect(toNumber(3.5)).toBe(3.5);
    expect(toNumber('3,5')).toBe(3.5);
    expect(toNumber(' 12 ')).toBe(12);
    expect(toNumber('00:01:02.5')).toBeCloseTo(62.5);
    expect(toNumber('abc')).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

describe('parseTable', () => {
  it('detecta columnas por cabecera y unidades explícitas', () => {
    const rows = [
      ['Tiempo (ms)', 'Distancia (cm)', 'PWM'],
      [1000, 10, 1100],
      [1020, 12, 1200],
      [1040, 15, 1300],
    ];
    const { samples, mapping } = parseTable(rows);
    expect(mapping.time).toBe(0);
    expect(mapping.height).toBe(1);
    expect(mapping.pwm).toBe(2);
    expect(mapping.timeUnit).toBe('ms');
    expect(mapping.heightUnit).toBe('cm');
    expect(samples[0]).toMatchObject({ t: 0, height: 0.1, pwm: 1100 });
    expect(samples[2].t).toBeCloseTo(0.04);
    expect(samples[2].height).toBeCloseTo(0.15);
  });

  it('deduce ms por el paso y cm por la magnitud', () => {
    const rows = [
      ['t', 'altura', 'pwm'],
      [0, 5, 1000],
      [20, 30, 1500],
      [40, 45, 1600],
    ];
    const { samples, mapping } = parseTable(rows);
    expect(mapping.timeUnit).toBe('ms');
    expect(mapping.heightUnit).toBe('cm');
    expect(samples[1].t).toBeCloseTo(0.02);
    expect(samples[1].height).toBeCloseTo(0.3);
  });

  it('acepta setpoint y calcula el error', () => {
    const rows = [
      ['time', 'altura deseada', 'altura (m)', 'u'],
      [0, 0.3, 0.1, 1500],
      [0.02, 0.3, 0.2, 1500],
    ];
    const { samples, mapping } = parseTable(rows);
    expect(mapping.setpoint).toBe(1);
    expect(mapping.height).toBe(2);
    expect(samples[1].error).toBeCloseTo(0.1);
  });

  it('sin cabecera asume t, altura, pwm y salta filas de texto', () => {
    const rows = [
      [0, 0.1, 1000],
      ['--', 'reinicio', ''],
      [0.02, 0.12, 1100],
    ];
    const { samples, skipped } = parseTable(rows);
    expect(samples).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it('sin columna de tiempo usa el periodo de muestreo del banco (Ts = 50 ms)', () => {
    const rows = [['altura', 'pwm'], [10, 1000], [11, 1000], [12, 1000]];
    const { samples } = parseTable(rows);
    expect(samples[2].t).toBeCloseTo(0.1);
  });

  it('permite forzar la unidad de altura', () => {
    const rows = [['altura', 'pwm'], [100, 1000], [120, 1000]];
    expect(parseTable(rows).mapping.heightUnit).toBe('cm');
    expect(parseTable(rows, { heightUnit: 'mm' }).samples[0].height).toBeCloseTo(0.1);
  });

  it('falla con un mensaje claro si no hay columna de altura', () => {
    expect(() => parseTable([['foo', 'bar'], [1, 2]])).toThrow(/altura/);
  });

  it('guessLengthUnit', () => {
    expect(guessLengthUnit([0.1, 0.5])).toBe('m');
    expect(guessLengthUnit([5, 60])).toBe('cm');
    expect(guessLengthUnit([50, 600])).toBe('mm');
  });
});

describe('parseSerialLine', () => {
  const cols = parseColumnSpec('altura, pwm');

  it('formato numérico según columnas', () => {
    expect(parseSerialLine('12.5,1500\r', cols, 'cm')).toEqual({ t: null, height: 0.125, raw: undefined, pwm: 1500, setpoint: undefined });
    expect(parseSerialLine('12.5 1500', cols, 'cm')?.pwm).toBe(1500);
  });

  it('formato con etiquetas en cualquier orden', () => {
    const p = parseSerialLine('pwm:1400, h:20, ms=2500', cols, 'cm');
    expect(p).toEqual({ t: 2.5, height: 0.2, raw: undefined, pwm: 1400, setpoint: undefined });
  });

  it('ignora líneas de log', () => {
    expect(parseSerialLine('Iniciando ESC...', cols, 'cm')).toBeNull();
    expect(parseSerialLine('', cols, 'cm')).toBeNull();
    expect(parseSerialLine('12', cols, 'cm')).toBeNull();
  });

  it('trama de los firmwares: tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm', () => {
    const fw = parseColumnSpec('ms, pwm, altura, crudo, setpoint');
    expect(parseSerialLine('12000,1780,30.25,31.10,30.0', fw, 'cm')).toEqual({
      t: 12, height: 0.3025, raw: 0.311, pwm: 1780, setpoint: 0.3,
    });
    // -1 = sin eco / fuera de PID
    const idle = parseSerialLine('500,1000,11.00,-1.00,-1.0', fw, 'cm');
    expect(idle?.raw).toBeUndefined();
    expect(idle?.setpoint).toBeUndefined();
    // Firmware viejo de 3 columnas con la misma configuración
    expect(parseSerialLine('5002,1812,16.5', fw, 'cm')?.height).toBeCloseTo(0.165);
    // Avisos del firmware
    expect(parseSerialLine('# failsafe: altura >= 85 cm', fw, 'cm')).toBeNull();
  });

  it('parseColumnSpec valida los nombres', () => {
    expect(parseColumnSpec('t;h;_;pwm')).toEqual(['t', 'altura', '_', 'pwm']);
    expect(() => parseColumnSpec('t,pwm')).toThrow(/altura/);
    expect(() => parseColumnSpec('altura,xyz')).toThrow(/xyz/);
  });
});
