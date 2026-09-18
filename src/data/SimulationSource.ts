/**
 * SimulationSource — fuente de datos del modo "Simulación PID".
 * TODO: implementar en Fase 3
 *
 * Corre el motor de física (MonocopterModel) + PIDController
 * en el navegador, generando TelemetrySamples a 50 Hz.
 */

import type { DataSource, TelemetrySample } from './types';

export class SimulationSource implements DataSource {
  readonly mode = 'simulacion' as const;

  start(): void {
    // TODO: Fase 3 — arrancar el loop de simulación
  }

  stop(): void {
    // TODO: Fase 3
  }

  onSample(_cb: (s: TelemetrySample) => void): void {
    // TODO: Fase 3
  }
}
