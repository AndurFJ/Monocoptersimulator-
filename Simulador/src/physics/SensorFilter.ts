/**
 * SensorFilter — el mismo filtro del HC-SR04 que corre en el firmware
 * (Arduino Uno y ESP32), para que la simulación vea lo mismo que el banco.
 *
 * 1) Rechaza saltos imposibles (> FILTER_MAX_JUMP_M en una muestra): suelen ser
 *    ecos del travesaño superior. Si FILTER_CONFIRM_SAMPLES lecturas seguidas
 *    coinciden entre sí, el salto es real y se acepta.
 * 2) Mediana de las 3 últimas lecturas aceptadas.
 * 3) Sin eco con el motor apagado: el carro está en la base (no se queda "pegado").
 */

import {
  FILTER_MAX_JUMP_M, FILTER_CONFIRM_SAMPLES, FILTER_CONFIRM_SPREAD_M, REST_HEIGHT_M,
} from './constants';

/** Muestras sin eco para declarar el sensor perdido (0.5 s a 20 Hz) */
const NO_ECHO_SAMPLES = 10;

export class SensorFilter {
  private window = [REST_HEIGHT_M, REST_HEIGHT_M, REST_HEIGHT_M];
  private jumps: number[] = [];
  private noEcho = 0;
  private started = false;
  private _value = REST_HEIGHT_M;

  /** Altura filtrada [m] */
  get value(): number {
    return this._value;
  }

  /** false tras NO_ECHO_SAMPLES muestras seguidas sin eco */
  get ok(): boolean {
    return this.started && this.noEcho < NO_ECHO_SAMPLES;
  }

  /**
   * Procesar una lectura cruda [m] (null = sin eco).
   * `motorOff`: el motor lleva apagado más de 1 s.
   */
  push(raw: number | null, motorOff = false): number {
    if (raw === null) {
      this.noEcho++;
      if (motorOff && this.noEcho >= NO_ECHO_SAMPLES) this.restart(REST_HEIGHT_M);
      return this._value;
    }
    this.noEcho = 0;
    if (!this.started) {
      this.started = true;
      this.restart(raw);
      return this._value;
    }
    if (Math.abs(raw - this._value) <= FILTER_MAX_JUMP_M) {
      this.jumps = [];
      this.window = [this.window[1], this.window[2], raw];
      this._value = median3(this.window[0], this.window[1], this.window[2]);
      return this._value;
    }
    this.jumps.push(raw);
    if (this.jumps.length >= FILTER_CONFIRM_SAMPLES) {
      const spread = Math.max(...this.jumps) - Math.min(...this.jumps);
      if (spread <= FILTER_CONFIRM_SPREAD_M) this.restart(raw);
      else this.jumps = [];
    }
    return this._value;
  }

  reset(): void {
    this.started = false;
    this.noEcho = 0;
    this.restart(REST_HEIGHT_M);
  }

  private restart(h: number): void {
    this.window = [h, h, h];
    this._value = h;
    this.jumps = [];
  }
}

export function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}
