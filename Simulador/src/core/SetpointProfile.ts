/**
 * SetpointProfile — secuencia de setpoints por tramos (prueba P2 de la guía de la Etapa 2).
 *
 * Avanza con el tiempo de la telemetría (no con el reloj del PC): si la simulación
 * se pausa, la secuencia se pausa con ella, y en el banco sigue el tiempo de la placa.
 */

import type { ProfileView } from '../remote/protocol';

/** Perfil de la prueba P2 [cm] */
export const P2_STEPS_CM = [20, 40, 30, 50];

/** Duración de cada tramo de P2 [s] */
export const P2_SEGMENT_S = 12;

export class SetpointProfile {
  readonly steps: number[];
  readonly segment: number;
  private t0: number | null = null;
  private index = -1;
  private elapsed = 0;
  private _active = false;

  constructor(steps: number[] = P2_STEPS_CM, segment = P2_SEGMENT_S) {
    this.steps = steps;
    this.segment = segment;
  }

  get active(): boolean {
    return this._active;
  }

  /** Setpoint del tramo actual [cm] (null sin secuencia) */
  get current(): number | null {
    return this._active ? this.steps[this.index] : null;
  }

  /** Arranca la secuencia; devuelve el primer setpoint [cm]. El tiempo empieza con la próxima muestra. */
  start(): number {
    this._active = true;
    this.t0 = null;
    this.index = 0;
    this.elapsed = 0;
    return this.steps[0];
  }

  cancel(): void {
    this._active = false;
    this.index = -1;
  }

  /**
   * Registrar una muestra en el instante t [s]. Devuelve el setpoint nuevo [cm]
   * cuando cambia de tramo, 'done' al terminar el último, o null si no cambia nada.
   */
  push(t: number): number | 'done' | null {
    if (!this._active) return null;
    if (this.t0 === null || t < this.t0) this.t0 = t; // primera muestra o reinicio del tiempo
    const e = t - this.t0;
    const index = Math.floor(e / this.segment);
    this.elapsed = e - index * this.segment;
    if (index >= this.steps.length) {
      this.cancel();
      return 'done';
    }
    if (index === this.index) return null;
    this.index = index;
    return this.steps[index];
  }

  view(): ProfileView | null {
    if (!this._active) return null;
    return { steps: this.steps, index: this.index, elapsed: this.elapsed, segment: this.segment };
  }
}
