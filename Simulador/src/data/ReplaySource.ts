/**
 * ReplaySource — fuente de datos del modo "Reproducción Excel/CSV".
 *
 * Usa SheetJS (xlsx) para parsear archivos .xlsx/.csv exportados
 * desde la página de adquisición "Monitor Monocóptero", y reproduce
 * las muestras respetando su tiempo original (con factor de velocidad).
 */

import type { DataSource, SourceStatus, TelemetrySample } from './types';
import { Clock } from './Clock';
import { parseTable } from './parseTable';
import type { ColumnMapping, LengthUnit } from './parseTable';

export interface LoadedFile {
  name: string;
  samples: number;
  duration: number;
  mapping: ColumnMapping;
  skipped: number;
}

export class ReplaySource implements DataSource {
  readonly mode = 'reproduccion' as const;

  /** Factor de velocidad de reproducción (1 = tiempo real) */
  speed = 1;

  private samples: TelemetrySample[] = [];
  private rows: unknown[][] = [];
  private fileName = '';
  private cursor = 0;
  private playTime = 0;
  private sampleCb: ((s: TelemetrySample) => void) | null = null;
  private statusCb: ((s: SourceStatus) => void) | null = null;
  private readonly clock = new Clock((dt) => this.advance(dt));

  get loaded(): boolean {
    return this.samples.length > 0;
  }

  get duration(): number {
    return this.samples.length ? this.samples[this.samples.length - 1].t : 0;
  }

  /** Progreso de reproducción ∈ [0, 1] */
  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.playTime / this.duration) : 0;
  }

  start(): void {
    if (!this.loaded) {
      this.status({ level: 'warning', message: 'Carga primero un archivo Excel o CSV.', stopped: true });
      return;
    }
    if (this.cursor >= this.samples.length) this.reset();
    this.clock.start();
  }

  stop(): void {
    this.clock.stop();
  }

  reset(): void {
    this.cursor = 0;
    this.playTime = 0;
    if (this.loaded) this.emit(this.samples[0]);
  }

  onSample(cb: (s: TelemetrySample) => void): void {
    this.sampleCb = cb;
  }

  onStatus(cb: (s: SourceStatus) => void): void {
    this.statusCb = cb;
  }

  /** Cargar archivo Excel/CSV */
  async loadFile(file: File, heightUnit?: LengthUnit): Promise<LoadedFile> {
    this.stop();
    // SheetJS pesa ~1 MB: se carga solo cuando se usa
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('El archivo no tiene hojas.');
    this.rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false });
    this.fileName = file.name;
    return this.applyParse(heightUnit);
  }

  /** Re-interpretar el archivo cargado con otra unidad de altura */
  setHeightUnit(unit: LengthUnit | undefined): LoadedFile {
    this.stop();
    return this.applyParse(unit);
  }

  private applyParse(heightUnit?: LengthUnit): LoadedFile {
    const parsed = parseTable(this.rows, { heightUnit });
    this.samples = parsed.samples;
    this.reset();
    return {
      name: this.fileName,
      samples: parsed.samples.length,
      duration: this.duration,
      mapping: parsed.mapping,
      skipped: parsed.skipped,
    };
  }

  /** Saltar a una fracción del ensayo ∈ [0, 1] */
  seek(fraction: number): void {
    if (!this.loaded) return;
    this.playTime = Math.max(0, Math.min(1, fraction)) * this.duration;
    this.cursor = this.samples.findIndex((s) => s.t > this.playTime);
    if (this.cursor === -1) this.cursor = this.samples.length;
    this.emit(this.samples[Math.max(0, this.cursor - 1)]);
  }

  /** Muestras hasta el instante actual (para redibujar gráficas tras un seek) */
  samplesUntilNow(): TelemetrySample[] {
    return this.samples.slice(0, this.cursor);
  }

  private advance(realDt: number): void {
    this.playTime += realDt * this.speed;
    while (this.cursor < this.samples.length && this.samples[this.cursor].t <= this.playTime) {
      this.emit(this.samples[this.cursor]);
      this.cursor++;
    }
    if (this.cursor >= this.samples.length) {
      this.clock.stop();
      this.status({ level: 'info', message: 'Reproducción terminada.', stopped: true });
    }
  }

  private emit(s: TelemetrySample): void {
    this.sampleCb?.(s);
  }

  private status(s: SourceStatus): void {
    this.statusCb?.(s);
  }
}
