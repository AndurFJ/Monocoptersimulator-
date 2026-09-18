/**
 * recording.ts — grabación de ensayos y preparación para PID Tuner (MATLAB).
 *
 * PID Tuner ("Identify New Plant") exige datos con tiempo de muestreo
 * constante. Las tramas serial llegan con jitter, así que además de los
 * datos crudos se genera una serie remuestreada a Ts fijo:
 *   - u (PWM): retención de orden cero, como la aplica el ESC
 *   - y (altura): interpolación lineal entre lecturas del sensor
 */

import type { TelemetrySample } from './types';
import { normalizePwm } from '../physics/MonocopterModel';
import { zoneOf, longestSpanSegment, ZONE_LABELS } from '../physics/zones';
import type { Zone } from '../physics/zones';
import {
  DEAD_ZONE_TOP_M, UNSTABLE_ZONE_START_M, H_MAX, DEAD_ZONE_FRACTION, UNSTABLE_ZONE_FRACTION,
} from '../physics/constants';

/** Límite de muestras (≈ 2,7 h a 50 Hz) para no agotar la memoria */
const MAX_SAMPLES = 500_000;

export class Recorder {
  private data: TelemetrySample[] = [];
  private truncated = false;

  get samples(): readonly TelemetrySample[] {
    return this.data;
  }

  get count(): number {
    return this.data.length;
  }

  get duration(): number {
    return this.data.length > 1 ? this.data[this.data.length - 1].t - this.data[0].t : 0;
  }

  /** true si se alcanzó el límite y se dejaron de guardar muestras */
  get full(): boolean {
    return this.truncated;
  }

  /**
   * Añadir una muestra. Si el tiempo retrocede (nueva conexión serial,
   * reset) empieza una grabación nueva.
   */
  push(s: TelemetrySample): void {
    const last = this.data[this.data.length - 1];
    if (last && s.t < last.t) this.clear();
    if (last && s.t === last.t) return; // duplicado (p.ej. reset seguido de start)
    if (this.data.length >= MAX_SAMPLES) {
      this.truncated = true;
      return;
    }
    this.data.push(s);
  }

  clear(): void {
    this.data = [];
    this.truncated = false;
  }
}

/** Tiempo de muestreo estimado: mediana de los intervalos, redondeada a 1 ms */
export function estimateSampleTime(samples: readonly TelemetrySample[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].t - samples[i - 1].t;
    if (d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return 0.02;
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  return Math.max(0.001, Math.round(median * 1000) / 1000);
}

export interface UniformSeries {
  ts: number;
  t: number[];
  /** PWM (retención de orden cero) */
  u: number[];
  /** Altura [m] (interpolación lineal) */
  y: number[];
  /** Setpoint [m] si la fuente lo daba (retención de orden cero) */
  sp: (number | null)[];
}

/** Remuestrear a paso constante `ts`, con t = 0 en la primera muestra */
export function resampleUniform(samples: readonly TelemetrySample[], ts = estimateSampleTime(samples)): UniformSeries {
  const out: UniformSeries = { ts, t: [], u: [], y: [], sp: [] };
  if (samples.length === 0) return out;

  const t0 = samples[0].t;
  const tEnd = samples[samples.length - 1].t - t0;
  const n = Math.floor(tEnd / ts + 1e-9) + 1;
  let j = 0; // índice de la muestra con t <= tk

  for (let k = 0; k < n; k++) {
    const tk = k * ts;
    while (j + 1 < samples.length && samples[j + 1].t - t0 <= tk) j++;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    const ta = a.t - t0;
    const tb = b.t - t0;
    const alpha = tb > ta ? (tk - ta) / (tb - ta) : 0;

    out.t.push(Number(tk.toFixed(6)));
    out.u.push(a.pwm);
    out.y.push(a.height + (b.height - a.height) * alpha);
    out.sp.push(a.setpoint ?? null);
  }
  return out;
}

export type Cell = string | number | null;

/** Filas de la hoja "PID_Tuner": una columna por señal, lista para readtable */
export function pidTunerRows(series: UniformSeries): Cell[][] {
  const hasSp = series.sp.some((v) => v !== null);
  const header: Cell[] = ['t_s', 'u_pwm', 'y_cm', 'u_norm', 'y_m', 'en_span'];
  if (hasSp) header.push('setpoint_cm');
  const rows: Cell[][] = [header];
  for (let k = 0; k < series.t.length; k++) {
    const row: Cell[] = [
      series.t[k],
      series.u[k],
      round(series.y[k] * 100, 3),
      round(normalizePwm(series.u[k]), 4),
      round(series.y[k], 5),
      zoneOf(series.y[k]) === 'util' ? 1 : 0,
    ];
    if (hasSp) row.push(series.sp[k] === null ? null : round(series.sp[k]! * 100, 3));
    rows.push(row);
  }
  return rows;
}

/** Filas de la hoja "Datos_crudos": tal cual llegaron */
export function rawRows(samples: readonly TelemetrySample[]): Cell[][] {
  const hasSp = samples.some((s) => s.setpoint !== undefined);
  const header: Cell[] = ['t_s', 'altura_cm', 'pwm'];
  if (hasSp) header.push('setpoint_cm', 'error_cm');
  header.push('zona');
  const t0 = samples.length ? samples[0].t : 0;
  return [header, ...samples.map((s) => {
    const row: Cell[] = [round(s.t - t0, 4), round(s.height * 100, 3), s.pwm];
    if (hasSp) {
      row.push(
        s.setpoint === undefined ? null : round(s.setpoint * 100, 3),
        s.setpoint === undefined ? null : round((s.setpoint - s.height) * 100, 3),
      );
    }
    row.push(zoneOf(s.height));
    return row;
  })];
}

/** Hoja "Info": parámetros del ensayo y cómo cargarlo en MATLAB */
export function infoRows(
  samples: readonly TelemetrySample[],
  series: UniformSeries,
  meta: { source: string; date: Date; fileName: string },
): Cell[][] {
  const jitter = maxJitter(samples, series.ts);

  // Tiempo en cada zona y tramo continuo más largo dentro del span
  const count: Record<Zone, number> = { muerta: 0, util: 0, inestable: 0 };
  for (const y of series.y) count[zoneOf(y)]++;
  const n = Math.max(1, series.y.length);
  const seg = longestSpanSegment(series.y);
  const segRows: Cell[][] = seg
    ? [
      ['Tramo continuo más largo en el span [s]', `${series.t[seg.start]} – ${series.t[seg.end]}`],
      ['Duración de ese tramo [s]', round(series.t[seg.end] - series.t[seg.start], 3)],
    ]
    : [['Tramo en el span', 'Ninguna muestra dentro del span útil']];
  const cropRows: Cell[][] = seg
    ? [
      ['% Recortar al tramo dentro del span (recomendado para identificar):'],
      [`idx = T.t_s >= ${series.t[seg.start]} & T.t_s <= ${series.t[seg.end]};`],
      ['T = T(idx, :);'],
    ]
    : [];

  return [
    ['Ensayo del monocóptero 1-GDL'],
    [],
    ['Fuente', meta.source],
    ['Fecha', meta.date.toLocaleString()],
    ['Muestras crudas', samples.length],
    ['Muestras remuestreadas', series.t.length],
    ['Duración [s]', round(series.t[series.t.length - 1] ?? 0, 3)],
    ['Tiempo de muestreo Ts [s]', series.ts],
    ['Jitter máx. de las tramas [s]', round(jitter, 4)],
    [],
    ['Zonas de operación (fracción del recorrido de ' + round(H_MAX * 100, 1) + ' cm)'],
    [ZONE_LABELS.muerta, `0 – ${round(DEAD_ZONE_TOP_M * 100, 2)} cm (0 – ${round(DEAD_ZONE_FRACTION * 100, 1)} %)`, `${round((count.muerta / n) * 100, 1)} % del ensayo`],
    [ZONE_LABELS.util, `${round(DEAD_ZONE_TOP_M * 100, 2)} – ${round(UNSTABLE_ZONE_START_M * 100, 2)} cm (${round(DEAD_ZONE_FRACTION * 100, 1)} – ${round(UNSTABLE_ZONE_FRACTION * 100, 1)} %)`, `${round((count.util / n) * 100, 1)} % del ensayo`],
    [ZONE_LABELS.inestable, `${round(UNSTABLE_ZONE_START_M * 100, 2)} – ${round(H_MAX * 100, 1)} cm (${round(UNSTABLE_ZONE_FRACTION * 100, 1)} – 100 %)`, `${round((count.inestable / n) * 100, 1)} % del ensayo`],
    ...segRows,
    ['Fuera del span la planta no es la misma (resortes / efecto techo):'],
    ['identifica solo con datos del span; la columna en_span = 1 los marca.'],
    [],
    ['Columnas de la hoja PID_Tuner'],
    ['t_s', 'Tiempo [s], paso constante Ts'],
    ['u_pwm', 'Entrada: PWM tal como lo envía el Arduino (retención de orden cero)'],
    ['y_cm', 'Salida: altura medida [cm] (interpolación lineal)'],
    ['u_norm', 'Entrada normalizada 0–1 (la que usa el simulador)'],
    ['y_m', 'Salida en metros (la que usa el simulador)'],
    [],
    ['Las ganancias que calcule PID Tuner quedan en las unidades de u e y que elijas:'],
    ['u_pwm + y_cm → para el firmware; u_norm + y_m → para el simulador.'],
    [],
    ['MATLAB'],
    [`T = readtable('${meta.fileName}', 'Sheet', 'PID_Tuner');`],
    ['Ts = T.t_s(2) - T.t_s(1);'],
    ...cropRows,
    ['datos = iddata(T.y_cm, T.u_pwm, Ts, ...'],
    ["    'InputName', 'PWM', 'OutputName', 'Altura', 'InputUnit', 'us', 'OutputUnit', 'cm');"],
    ['pidTuner   % Plant > Identify New Plant > Import > datos'],
  ];
}

function maxJitter(samples: readonly TelemetrySample[], ts: number): number {
  let max = 0;
  for (let i = 1; i < samples.length; i++) {
    max = Math.max(max, Math.abs(samples[i].t - samples[i - 1].t - ts));
  }
  return max;
}

function round(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
