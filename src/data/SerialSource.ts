/**
 * SerialSource — fuente de datos del modo "Serial en vivo".
 * TODO: implementar en Fase 6 (opcional)
 *
 * Usa la Web Serial API nativa del navegador para conectarse
 * al mismo puerto COM que la página de adquisición.
 * Solo funciona en navegadores basados en Chromium (Chrome/Edge).
 */

import type { DataSource, TelemetrySample } from './types';

export class SerialSource implements DataSource {
  readonly mode = 'serial' as const;

  /** Verifica si el navegador soporta Web Serial API */
  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  start(): void {
    // TODO: Fase 6 — abrir puerto serial, parsear trama, emitir muestras
  }

  stop(): void {
    // TODO: Fase 6
  }

  onSample(_cb: (s: TelemetrySample) => void): void {
    // TODO: Fase 6
  }
}
