/**
 * AppState — estado centralizado de la aplicación.
 *
 * Usa el EventBus para notificar cambios a los consumidores
 * (3D, HUD, gráficas) sin acoplamiento directo.
 */

import { EventBus } from './EventBus';
import type { TelemetrySample, DataMode, SourceStatus } from '../data/types';
import type { ControlMode } from '../data/SimulationSource';
import {
  DEFAULT_KP, DEFAULT_KI, DEFAULT_KD, DEFAULT_U0_US, PWM_MIN, PWM_MAX, SETPOINT_MIN_M, SETPOINT_MAX_M,
} from '../physics/constants';

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
  /** Cambio en el feedforward u₀ del PID [µs] */
  'feedforward-change': number;
  /** El usuario pidió llevar el carro al setpoint con el PID (botón "Ir" o "Iniciar PID") */
  'pid-go': void;
  /** Cambio en la altura objetivo */
  'setpoint-change': number;
  /** Cambio entre control PID y PWM manual (modo Simulación) */
  'control-mode-change': ControlMode;
  /** Cambio del PWM manual [µs] */
  'manual-pwm-change': number;
  /** Se pidió volver al instante inicial */
  'reset': void;
  /** Mensaje de estado de la fuente activa */
  'status': SourceStatus;
}

export class AppState {
  readonly bus = new EventBus<AppEvents>();

  private _mode: DataMode = 'simulacion';
  private _running = false;
  private _setpoint = 0.3; // metros — dentro del span útil
  private _kp = DEFAULT_KP;
  private _ki = DEFAULT_KI;
  private _kd = DEFAULT_KD;
  private _feedforward = DEFAULT_U0_US;
  private _controlMode: ControlMode = 'pid';
  private _manualPwm = PWM_MIN;

  // ── Getters ──

  get mode(): DataMode { return this._mode; }
  get running(): boolean { return this._running; }
  get setpoint(): number { return this._setpoint; }
  get kp(): number { return this._kp; }
  get ki(): number { return this._ki; }
  get kd(): number { return this._kd; }
  get feedforward(): number { return this._feedforward; }
  get controlMode(): ControlMode { return this._controlMode; }
  get manualPwm(): number { return this._manualPwm; }

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
    // Mismo rango que el firmware: por debajo está apoyado, por encima salta el failsafe
    this._setpoint = Math.max(SETPOINT_MIN_M, Math.min(h, SETPOINT_MAX_M));
    this.bus.emit('setpoint-change', this._setpoint);
  }

  setPIDGains(kp: number, ki: number, kd: number): void {
    this._kp = Math.max(0, kp);
    this._ki = Math.max(0, ki);
    this._kd = Math.max(0, kd);
    this.bus.emit('pid-change', { kp: this._kp, ki: this._ki, kd: this._kd });
  }

  /** PWM de equilibrio [µs] (mismo rango que acepta el firmware) */
  setFeedforward(u0: number): void {
    this._feedforward = Math.round(Math.max(1500, Math.min(1900, u0)));
    this.bus.emit('feedforward-change', this._feedforward);
  }

  setControlMode(mode: ControlMode): void {
    if (mode === this._controlMode) return;
    this._controlMode = mode;
    this.bus.emit('control-mode-change', mode);
  }

  setManualPwm(pwm: number): void {
    this._manualPwm = Math.max(PWM_MIN, Math.min(PWM_MAX, pwm));
    this.bus.emit('manual-pwm-change', this._manualPwm);
  }

  /** Pedir que el PID lleve el carro al setpoint actual */
  requestPidGo(): void {
    this.bus.emit('pid-go', undefined);
  }

  requestReset(): void {
    this.bus.emit('reset', undefined);
  }

  reportStatus(status: SourceStatus): void {
    this.bus.emit('status', status);
  }

  /** Enviar una muestra de telemetría a todos los consumidores */
  pushSample(sample: TelemetrySample): void {
    this.bus.emit('telemetry', sample);
  }
}

/** Instancia singleton del estado de la app */
export const appState = new AppState();
