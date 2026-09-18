/**
 * ReplaySource — fuente de datos del modo "Reproducción Excel/CSV".
 * TODO: implementar en Fase 5
 *
 * Usa SheetJS (xlsx) para parsear archivos .xlsx/.csv exportados
 * desde la página de adquisición "Monitor Monocóptero".
 */

import type { DataSource, TelemetrySample } from './types';

export class ReplaySource implements DataSource {
  readonly mode = 'reproduccion' as const;

  start(): void {
    // TODO: Fase 5 — iniciar reproducción de serie cargada
  }

  stop(): void {
    // TODO: Fase 5
  }

  onSample(_cb: (s: TelemetrySample) => void): void {
    // TODO: Fase 5
  }

  /** Cargar archivo Excel/CSV */
  loadFile(_file: File): Promise<void> {
    // TODO: Fase 5 — parsear con SheetJS
    return Promise.resolve();
  }
}
