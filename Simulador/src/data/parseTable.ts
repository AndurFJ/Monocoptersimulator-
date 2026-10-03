/**
 * parseTable — convierte una tabla (filas de celdas) en TelemetrySamples.
 *
 * Se usa para los archivos Excel/CSV exportados por "Monitor Monocóptero".
 * Como el formato exacto puede variar, las columnas se detectan por el
 * nombre de la cabecera y las unidades por sufijos o por la magnitud:
 *
 *   tiempo:   t, tiempo, time, timestamp, millis, hora…  (s, ms o hh:mm:ss)
 *   altura:   altura, height, distancia, distance, h…    (m, cm o mm)
 *   pwm:      pwm, throttle, motor, u…
 *   setpoint: setpoint, sp, referencia, ref, objetivo…
 */

import type { TelemetrySample } from './types';
import { PID_DT } from '../physics/constants';

export type LengthUnit = 'm' | 'cm' | 'mm';
export type TimeUnit = 's' | 'ms' | 'clock';

export interface ColumnMapping {
  time: number | null;
  height: number;
  pwm: number | null;
  setpoint: number | null;
  timeUnit: TimeUnit;
  heightUnit: LengthUnit;
  /** Nombres de las cabeceras detectadas (o null si no había cabecera) */
  headers: string[] | null;
}

export interface ParsedTable {
  samples: TelemetrySample[];
  mapping: ColumnMapping;
  /** Filas descartadas por no tener datos numéricos válidos */
  skipped: number;
}

// También los nombres del Excel para PID Tuner que exporta el simulador: t_s, y_cm, u_pwm
const TIME_RE = /^(t|tiempo|time|timestamp|millis|ms|seg|segundos|hora|hour|clock)\b|^t_|tiempo|time/i;
const HEIGHT_RE = /altura|height|distancia|distance|dist|^h\b|^y\b|^y_|posici/i;
const PWM_RE = /pwm|throttle|motor|esc|^u\b|acci[oó]n|control|se[nñ]al/i;
const SETPOINT_RE = /setpoint|^sp\b|referencia|^ref|objetivo|deseada|target/i;

const LENGTH_FACTORS: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001 };

/** Convierte una celda a número (acepta coma decimal y hh:mm:ss[.sss]) */
export function toNumber(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (cell instanceof Date) return cell.getTime() / 1000;
  if (typeof cell !== 'string') return null;
  const s = cell.trim();
  if (s === '') return null;
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?$/.exec(s);
  if (clock) {
    const [, hh, mm, ss] = clock;
    return Number(hh) * 3600 + Number(mm) * 60 + (ss ? Number(ss.replace(',', '.')) : 0);
  }
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Unidad de longitud indicada en la cabecera, p.ej. "Altura (cm)" */
export function unitFromHeader(header: string): LengthUnit | null {
  const h = header.toLowerCase();
  if (/(\b|_)mm\b|mil[ií]metro/.test(h)) return 'mm';
  if (/(\b|_)cm\b|cent[ií]metro/.test(h)) return 'cm';
  if (/\(m\)|\[m\]|_m\b|\bmetros?\b/.test(h)) return 'm';
  return null;
}

/** Deduce la unidad de altura a partir de la magnitud de los datos */
export function guessLengthUnit(values: number[]): LengthUnit {
  const max = Math.max(...values.map(Math.abs));
  if (max > 150) return 'mm'; // el recorrido es < 1 m → > 150 solo puede ser mm
  if (max > 2) return 'cm';
  return 'm';
}

function isHeaderRow(row: unknown[]): boolean {
  const nonEmpty = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
  return nonEmpty.length > 0 && nonEmpty.some((c) => toNumber(c) === null);
}

function findColumn(headers: string[], re: RegExp, taken: Set<number>): number | null {
  for (let i = 0; i < headers.length; i++) {
    if (!taken.has(i) && re.test(headers[i].trim())) return i;
  }
  return null;
}

/** Detecta qué columna es cada magnitud */
export function detectMapping(rows: unknown[][]): { mapping: Omit<ColumnMapping, 'timeUnit' | 'heightUnit'>; dataStart: number } {
  // La cabecera es la primera fila no vacía con algún texto
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] ?? [];
    if (row.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;
    if (isHeaderRow(row)) headerIdx = i;
    break;
  }

  if (headerIdx === -1) {
    // Sin cabecera: 1 col → altura; 2 → altura,pwm; 3+ → t,altura,pwm
    const width = Math.max(...rows.slice(0, 20).map((r) => r?.length ?? 0));
    if (width >= 3) return { mapping: { time: 0, height: 1, pwm: 2, setpoint: null, headers: null }, dataStart: 0 };
    if (width === 2) return { mapping: { time: null, height: 0, pwm: 1, setpoint: null, headers: null }, dataStart: 0 };
    return { mapping: { time: null, height: 0, pwm: null, setpoint: null, headers: null }, dataStart: 0 };
  }

  const headers = (rows[headerIdx] ?? []).map((c) => String(c ?? ''));
  const taken = new Set<number>();
  const take = (re: RegExp) => {
    const idx = findColumn(headers, re, taken);
    if (idx !== null) taken.add(idx);
    return idx;
  };
  // Orden: setpoint antes que altura ("altura deseada" es setpoint)
  const setpoint = take(SETPOINT_RE);
  const height = take(HEIGHT_RE);
  const time = take(TIME_RE);
  const pwm = take(PWM_RE);

  if (height === null) {
    throw new Error(`No se encontró una columna de altura. Cabeceras: ${headers.filter(Boolean).join(', ')}`);
  }
  return { mapping: { time, height, pwm, setpoint, headers }, dataStart: headerIdx + 1 };
}

/** Deduce la unidad del tiempo a partir de la cabecera y el paso típico */
function guessTimeUnit(header: string | undefined, rawCells: unknown[], values: number[]): TimeUnit {
  if (rawCells.some((c) => typeof c === 'string' && c.includes(':'))) return 'clock';
  const h = (header ?? '').toLowerCase();
  if (/\bms\b|millis|milisegundo/.test(h)) return 'ms';
  if (/\(s\)|\[s\]|\bseg|\bsegundos?\b/.test(h)) return 's';
  // Paso mediano: a ~50 Hz, en ms sería ~20; en s sería ~0.02
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) diffs.push(values[i] - values[i - 1]);
  diffs.sort((a, b) => a - b);
  const median = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;
  return median >= 2 ? 'ms' : 's';
}

/**
 * Parsear una tabla. `overrides` permite forzar unidades cuando la
 * detección automática se equivoca.
 */
export function parseTable(
  rows: unknown[][],
  overrides: { heightUnit?: LengthUnit; timeUnit?: TimeUnit } = {},
): ParsedTable {
  const { mapping: cols, dataStart } = detectMapping(rows);
  const dataRows = rows.slice(dataStart);

  type Raw = { t: number | null; h: number; pwm: number; sp: number | null; tCell: unknown };
  const raw: Raw[] = [];
  let skipped = 0;
  for (const row of dataRows) {
    if (!row) continue;
    const h = toNumber(row[cols.height]);
    if (h === null) {
      skipped++;
      continue;
    }
    const t = cols.time !== null ? toNumber(row[cols.time]) : null;
    if (cols.time !== null && t === null) {
      skipped++;
      continue;
    }
    raw.push({
      t,
      h,
      pwm: cols.pwm !== null ? toNumber(row[cols.pwm]) ?? 0 : 0,
      sp: cols.setpoint !== null ? toNumber(row[cols.setpoint]) : null,
      tCell: cols.time !== null ? row[cols.time] : null,
    });
  }
  if (raw.length === 0) throw new Error('El archivo no contiene filas con datos numéricos.');

  const header = (i: number | null) => (i !== null && cols.headers ? cols.headers[i] : undefined);
  const heightUnit = overrides.heightUnit
    ?? unitFromHeader(header(cols.height) ?? '')
    ?? guessLengthUnit(raw.map((r) => r.h));
  const setpointUnit = unitFromHeader(header(cols.setpoint) ?? '') ?? heightUnit;
  const timeUnit = cols.time === null
    ? 's'
    : overrides.timeUnit ?? guessTimeUnit(header(cols.time), raw.map((r) => r.tCell), raw.map((r) => r.t!));

  const hk = LENGTH_FACTORS[heightUnit];
  const sk = LENGTH_FACTORS[setpointUnit];
  const tk = timeUnit === 'ms' ? 0.001 : 1;
  const t0 = raw[0].t ?? 0;

  const samples: TelemetrySample[] = raw.map((r, i) => {
    const t = r.t === null ? i * PID_DT : (r.t - t0) * tk;
    const height = r.h * hk;
    const s: TelemetrySample = { t, height, pwm: r.pwm };
    if (r.sp !== null) {
      s.setpoint = r.sp * sk;
      s.error = s.setpoint - height;
    }
    return s;
  });

  // Descartar muestras con tiempo que retrocede (p.ej. reinicio del micro)
  const monotonic: TelemetrySample[] = [];
  for (const s of samples) {
    if (monotonic.length === 0 || s.t >= monotonic[monotonic.length - 1].t) monotonic.push(s);
  }
  skipped += samples.length - monotonic.length;

  return { samples: monotonic, mapping: { ...cols, timeUnit, heightUnit }, skipped };
}
