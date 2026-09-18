/**
 * AppState — estado centralizado de la aplicación.
 *
 * Usa el EventBus para notificar cambios a los consumidores
 * (3D, HUD, gráficas) sin acoplamiento directo.
 */

import { EventBus } from './EventBus';
import type { TelemetrySample, DataMode } from '../data/types';
import { DEFAULT_KP, DEFAULT_KI, DEFAULT_KD, H_MAX } from '../physics/constants';

/** Mapa de eventos del sistema */
export interface AppEvents {
  /** Nueva muestra de telemetría disponible */
  'telemetry': TelemetrySample;
  /** Cambio de modo de operación */
  'mode-change': DataMode;
  /** Cambio en el estado running/paused */
  'running-change': boolean;
  /** Cambio en las ganancias PID */
  'pid-change': { kp: number; ki: number; kd: number };
  /** Cambio en la altura objetivo */
  'setpoint-change': number;
}

export class AppState {
  readonly bus = new EventBus<AppEvents>();

  private _mode: DataMode = 'simulacion';
  private _running = false;
  private _setpoint = 0.3; // metros — un valor intermedio razonable
  private _kp = DEFAULT_KP;
  private _ki = DEFAULT_KI;
  private _kd = DEFAULT_KD;

  // ── Getters ──

  get mode(): DataMode { return this._mode; }
  get running(): boolean { return this._running; }
  get setpoint(): number { return this._setpoint; }
  get kp(): number { return this._kp; }
  get ki(): number { return this._ki; }
  get kd(): number { return this._kd; }

  // ── Setters con notificación ──

  setMode(mode: DataMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.bus.emit('mode-change', mode);
  }

  setRunning(running: boolean): void {
    if (running === this._running) return;
    this._running = running;
    this.bus.emit('running-change', running);
  }

  setSetpoint(h: number): void {
    this._setpoint = Math.max(0, Math.min(h, H_MAX));
    this.bus.emit('setpoint-change', this._setpoint);
  }

  setPIDGains(kp: number, ki: number, kd: number): void {
    this._kp = Math.max(0, kp);
    this._ki = Math.max(0, ki);
    this._kd = Math.max(0, kd);
    this.bus.emit('pid-change', { kp: this._kp, ki: this._ki, kd: this._kd });
  }

  /** Enviar una muestra de telemetría a todos los consumidores */
  pushSample(sample: TelemetrySample): void {
    this.bus.emit('telemetry', sample);
  }
}

/** Instancia singleton del estado de la app */
export const appState = new AppState();
