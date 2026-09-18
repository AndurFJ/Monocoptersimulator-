/**
 * SerialSource — fuente de datos del modo "Serial en vivo".
 *
 * Usa la Web Serial API nativa del navegador para conectarse
 * al mismo puerto COM que la página de adquisición.
 * Solo funciona en navegadores basados en Chromium (Chrome/Edge).
 *
 * Formatos de línea aceptados (uno por línea, terminada en \n):
 *  - Con etiquetas:  "h:12.3,pwm:1500"  o  "altura=12.3 pwm=1500 t=1234"
 *  - Solo números:   "12.3,1500"  — el orden lo define `columns`
 */

import type { DataSource, SourceStatus, TelemetrySample } from './types';
import type { LengthUnit } from './parseTable';
import { toNumber } from './parseTable';

// ── Tipos mínimos de Web Serial (no están en lib.dom de TypeScript) ──

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

/** Columnas que se pueden usar en el formato numérico */
export type SerialColumn = 't' | 'ms' | 'altura' | 'pwm' | 'setpoint' | '_';

export const SERIAL_COLUMN_ALIASES: Record<string, SerialColumn> = {
  t: 't', tiempo: 't', time: 't', s: 't',
  ms: 'ms', millis: 'ms',
  h: 'altura', altura: 'altura', height: 'altura', dist: 'altura', distancia: 'altura', d: 'altura',
  pwm: 'pwm', u: 'pwm', throttle: 'pwm', motor: 'pwm',
  sp: 'setpoint', setpoint: 'setpoint', ref: 'setpoint', referencia: 'setpoint',
  _: '_',
};

/** Convierte "t, altura, pwm" en la lista de columnas. Lanza si hay nombres desconocidos. */
export function parseColumnSpec(spec: string): SerialColumn[] {
  const cols = spec.split(/[,;\s]+/).filter(Boolean).map((name) => {
    const col = SERIAL_COLUMN_ALIASES[name.toLowerCase()];
    if (!col) throw new Error(`Columna desconocida: "${name}"`);
    return col;
  });
  if (!cols.includes('altura')) throw new Error('El formato debe incluir la columna "altura".');
  return cols;
}

export interface ParsedLine {
  /** Segundos si venía en la trama, null si no */
  t: number | null;
  height: number;
  pwm: number;
  setpoint?: number;
}

const LENGTH_FACTORS: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001 };

/** Parsear una línea recibida por serial. Devuelve null si no es una trama de datos. */
export function parseSerialLine(line: string, columns: SerialColumn[], unit: LengthUnit): ParsedLine | null {
  const text = line.trim();
  if (!text) return null;

  const values: Partial<Record<SerialColumn, number>> = {};

  // Formato con etiquetas: clave:valor o clave=valor
  const labeled = [...text.matchAll(/([A-Za-z_áéíóúñ]+)\s*[:=]\s*(-?[\d.]+)/g)];
  if (labeled.length > 0) {
    for (const [, key, raw] of labeled) {
      const col = SERIAL_COLUMN_ALIASES[key.toLowerCase()];
      const v = toNumber(raw);
      if (col && col !== '_' && v !== null) values[col] = v;
    }
  } else {
    const tokens = text.split(/[,;\t ]+/).filter(Boolean);
    if (tokens.length < columns.length) return null;
    for (let i = 0; i < columns.length; i++) {
      const v = toNumber(tokens[i]);
      if (v === null) return null; // línea de log/texto, no de datos
      if (columns[i] !== '_') values[columns[i]] = v;
    }
  }

  if (values.altura === undefined) return null;
  const k = LENGTH_FACTORS[unit];
  const t = values.t ?? (values.ms !== undefined ? values.ms / 1000 : null);
  return {
    t,
    height: values.altura * k,
    pwm: values.pwm ?? 0,
    setpoint: values.setpoint !== undefined ? values.setpoint * k : undefined,
  };
}

export class SerialSource implements DataSource {
  readonly mode = 'serial' as const;

  baudRate = 115200;
  columns: SerialColumn[] = ['altura', 'pwm'];
  heightUnit: LengthUnit = 'cm';

  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private readLoopDone: Promise<void> | null = null;
  private t0Device: number | null = null;
  private t0Host = 0;
  private sampleCb: ((s: TelemetrySample) => void) | null = null;
  private statusCb: ((s: SourceStatus) => void) | null = null;

  /** Verifica si el navegador soporta Web Serial API */
  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  get connected(): boolean {
    return this.port !== null;
  }

  /** Pide el puerto al usuario (requiere gesto del usuario) y empieza a leer */
  async start(): Promise<void> {
    if (this.port) return;
    if (!SerialSource.isSupported()) {
      this.status({ level: 'error', message: 'Web Serial no está disponible. Usa Chrome o Edge.', stopped: true });
      return;
    }
    const serial = (navigator as Navigator & { serial: SerialLike }).serial;
    let port: SerialPortLike;
    try {
      port = await serial.requestPort();
      await port.open({ baudRate: this.baudRate });
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === 'NotFoundError';
      this.status({
        level: cancelled ? 'info' : 'error',
        message: cancelled ? 'No se seleccionó ningún puerto.' : `No se pudo abrir el puerto: ${errorMessage(err)}`,
        stopped: true,
      });
      return;
    }
    this.port = port;
    this.reset();
    this.status({ level: 'success', message: `Conectado a ${this.baudRate} baudios.` });
    this.readLoopDone = this.readLoop(port);
  }

  /** Cierra el puerto */
  async stop(): Promise<void> {
    const port = this.port;
    if (!port) return;
    this.port = null;
    try {
      await this.reader?.cancel();
    } catch {
      // el lector ya estaba cerrado
    }
    await this.readLoopDone;
    try {
      await port.close();
    } catch {
      // el puerto ya estaba cerrado (p.ej. cable desconectado)
    }
    this.status({ level: 'info', message: 'Puerto serial cerrado.', stopped: true });
  }

  reset(): void {
    this.t0Device = null;
    this.t0Host = performance.now();
  }

  onSample(cb: (s: TelemetrySample) => void): void {
    this.sampleCb = cb;
  }

  onStatus(cb: (s: SourceStatus) => void): void {
    this.statusCb = cb;
  }

  private async readLoop(port: SerialPortLike): Promise<void> {
    if (!port.readable) return;
    const decoder = new TextDecoderStream();
    const pipeDone = port.readable.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {});
    this.reader = decoder.readable.getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) this.handleLine(line);
      }
    } catch (err) {
      if (this.port) {
        this.status({ level: 'error', message: `Error de lectura: ${errorMessage(err)}` });
      }
    } finally {
      this.reader.releaseLock();
      this.reader = null;
      await pipeDone;
    }
    // Si el puerto sigue "abierto" es que se desconectó el dispositivo
    if (this.port) {
      this.port = null;
      this.status({ level: 'warning', message: 'Se perdió la conexión serial.', stopped: true });
    }
  }

  private handleLine(line: string): void {
    const parsed = parseSerialLine(line, this.columns, this.heightUnit);
    if (!parsed) return;

    let t: number;
    if (parsed.t !== null) {
      if (this.t0Device === null) this.t0Device = parsed.t;
      t = parsed.t - this.t0Device;
    } else {
      t = (performance.now() - this.t0Host) / 1000;
    }

    const sample: TelemetrySample = { t, height: parsed.height, pwm: parsed.pwm };
    if (parsed.setpoint !== undefined) {
      sample.setpoint = parsed.setpoint;
      sample.error = parsed.setpoint - parsed.height;
    }
    this.sampleCb?.(sample);
  }

  private status(s: SourceStatus): void {
    this.statusCb?.(s);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
