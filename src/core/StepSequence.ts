/**
 * StepSequence — ensayo de escalón automático en el banco real.
 *
 *   despegue ─(altura ≥ liftOffCm)─▶ estabilizando ─(quieto stableWindowS)─▶ escalon ─(motor a 1000 µs)─▶ listo
 *
 * El escalón lo ejecuta la ESP32 (5 s en u₀ → 10 s en u₀+Δu → apaga). Aquí solo se
 * despega con una rampa (vencer la fricción del riel pide más PWM que sostenerlo)
 * y se espera a que el carro quede quieto en u₀. Máquina de estados pura: recibe
 * muestras y devuelve los comandos a enviar.
 */

import type { TelemetrySample } from '../data/types';
import {
  PWM_MIN, STEP_TEST_U0_US, STEP_TEST_DELTA_US, STEP_TEST_PRE_S, STEP_TEST_TOTAL_S,
} from '../physics/constants';

export type StepPhase = 'inactivo' | 'despegue' | 'estabilizando' | 'escalon' | 'listo' | 'abortado';

export type StepCommand =
  | { type: 'cmd'; action: 'set_u0' | 'set_pwm'; value: number }
  | { type: 'cmd'; action: 'start_step' | 'stop' };

export interface StepSequenceConfig {
  /** PWM de flotado [µs] */
  u0: number;
  /** Escalón que aplica el firmware [µs] */
  deltaU: number;
  /** Tramo del firmware en u₀ antes del salto [s] */
  preStepS: number;
  /** Duración total del escalón del firmware [s] */
  stepTotalS: number;
  /** La rampa de despegue arranca en u₀ + rampOffsetUs [µs] */
  rampOffsetUs: number;
  rampStepUs: number;
  rampEveryS: number;
  /** Si no despega con este PWM se aborta [µs] */
  rampMaxUs: number;
  /** Altura que confirma el despegue [cm] */
  liftOffCm: number;
  /** Por debajo de esto durante fallHoldS el carro volvió a la base [cm] */
  fallCm: number;
  fallHoldS: number;
  /** "Quieto": la altura no sale de una banda de stableBandCm durante stableWindowS */
  stableWindowS: number;
  stableBandCm: number;
  stableTimeoutS: number;
  /** Por encima (maxHeightSamples muestras seguidas) se aborta: ahí el sensor falla [cm] */
  maxHeightCm: number;
  maxHeightSamples: number;
}

export const STEP_SEQUENCE_DEFAULTS: StepSequenceConfig = {
  u0: STEP_TEST_U0_US,
  deltaU: STEP_TEST_DELTA_US,
  preStepS: STEP_TEST_PRE_S,
  stepTotalS: STEP_TEST_TOTAL_S,
  rampOffsetUs: 20,
  rampStepUs: 10,
  rampEveryS: 0.4,
  rampMaxUs: 1950,
  liftOffCm: 14,
  fallCm: 13,
  fallHoldS: 1,
  stableWindowS: 5,
  stableBandCm: 2,
  stableTimeoutS: 30,
  maxHeightCm: 60,
  maxHeightSamples: 3,
};

export interface StepUpdate {
  commands: StepCommand[];
  /** true si en esta llamada cambió la fase */
  phaseChanged: boolean;
}

/** Tiempo para que un set_pwm llegue a la placa antes de juzgar el PWM que reporta [s] */
const CMD_LATENCY_S = 0.6;

const none = (): StepUpdate => ({ commands: [], phaseChanged: false });
const setPwm = (value: number): StepCommand => ({ type: 'cmd', action: 'set_pwm', value });
const fmt1 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export class StepSequence {
  readonly cfg: StepSequenceConfig;
  private _phase: StepPhase = 'inactivo';
  private _reason = '';
  private _stepStartT = 0;
  private tPhase = 0;
  private tStart = 0;
  private rampPwm = 0;
  private tRamp = 0;
  private tBelow: number | null = null;
  private highCount = 0;
  private window: { t: number; h: number }[] = [];
  private lastT = 0;
  private lastH = 0;

  constructor(cfg: Partial<StepSequenceConfig> = {}) {
    this.cfg = { ...STEP_SEQUENCE_DEFAULTS, ...cfg };
  }

  get phase(): StepPhase { return this._phase; }
  get reason(): string { return this._reason; }
  /** Instante (tiempo de la telemetría) en que se pidió el escalón a la ESP32 [s] */
  get stepStartT(): number { return this._stepStartT; }
  get active(): boolean {
    return this._phase === 'despegue' || this._phase === 'estabilizando' || this._phase === 'escalon';
  }

  /** Arranca con la última muestra recibida (altura en cm) */
  start(t: number, hCm: number): StepUpdate {
    this.lastT = t;
    this.lastH = hCm;
    this.tStart = t;
    const c = this.cfg;
    const commands: StepCommand[] = [{ type: 'cmd', action: 'set_u0', value: c.u0 }];
    if (hCm >= c.liftOffCm) {
      this.enter('estabilizando', t);
      commands.push(setPwm(c.u0));
    } else {
      this.enter('despegue', t);
      this.rampPwm = Math.min(c.u0 + c.rampOffsetUs, c.rampMaxUs);
      this.tRamp = t;
      commands.push(setPwm(this.rampPwm));
    }
    return { commands, phaseChanged: true };
  }

  /** Procesar una muestra de telemetría (altura en cm, PWM que aplica la placa en µs) */
  push(t: number, hCm: number, pwm: number): StepUpdate {
    if (!this.active) return none();
    this.lastT = t;
    this.lastH = hCm;
    const c = this.cfg;

    this.highCount = hCm >= c.maxHeightCm ? this.highCount + 1 : 0;
    if (this.highCount >= c.maxHeightSamples) {
      return this.abort(`el carro pasó de ${c.maxHeightCm} cm.`);
    }
    // Pasado el primer comando la secuencia nunca manda 1000 µs: si la placa lo reporta,
    // alguien (otro cliente, la parada o el failsafe) apagó el motor y no hay que reencenderlo
    const motorOff = pwm <= PWM_MIN;
    if (motorOff && this._phase !== 'escalon' && t - this.tStart > CMD_LATENCY_S) {
      return this.abort('el motor se detuvo (parada o failsafe).');
    }

    switch (this._phase) {
      case 'despegue': {
        if (hCm >= c.liftOffCm) {
          this.enter('estabilizando', t);
          return { commands: [setPwm(c.u0)], phaseChanged: true };
        }
        if (t - this.tRamp < c.rampEveryS) return none();
        const next = this.rampPwm + c.rampStepUs;
        if (next > c.rampMaxUs) return this.abort(`no despegó ni con ${this.rampPwm} µs.`);
        this.rampPwm = next;
        this.tRamp = t;
        return { commands: [setPwm(next)], phaseChanged: false };
      }

      case 'estabilizando': {
        if (hCm < c.fallCm) {
          this.tBelow ??= t;
          if (t - this.tBelow >= c.fallHoldS) {
            return this.abort(`con u₀ = ${c.u0} µs el carro volvió a la base: súbelo 10–20 µs y repite.`);
          }
        } else {
          this.tBelow = null;
        }
        this.window.push({ t, h: hCm });
        while (this.window[0].t < t - c.stableWindowS) this.window.shift();
        const hs = this.window.map((e) => e.h);
        if (t - this.tPhase >= c.stableWindowS && Math.max(...hs) - Math.min(...hs) <= c.stableBandCm) {
          this.enter('escalon', t);
          this._stepStartT = t;
          // u₀ otra vez por si la placa se reinició: el escalón usa el u₀ que ella tenga
          return {
            commands: [{ type: 'cmd', action: 'set_u0', value: c.u0 }, { type: 'cmd', action: 'start_step' }],
            phaseChanged: true,
          };
        }
        if (t - this.tPhase >= c.stableTimeoutS) return this.abort(this.driftHint());
        return none();
      }

      case 'escalon': {
        const elapsed = t - this._stepStartT;
        if (motorOff) {
          if (elapsed >= c.stepTotalS - 1) {
            this.enter('listo', t);
            return { commands: [], phaseChanged: true };
          }
          return this.abort('la ESP32 apagó el motor antes de terminar el escalón (¿parada o failsafe?).');
        }
        const p = Math.round(pwm);
        const atU0 = Math.abs(p - c.u0) <= 1;
        if (!atU0 && Math.abs(p - (c.u0 + c.deltaU)) > 1) {
          return this.abort(`la ESP32 aplica ${p} µs en vez de ${c.u0} → ${c.u0 + c.deltaU} µs (no tomó u₀).`);
        }
        if (atU0 && elapsed > c.preStepS + 1.5) return this.abort('la ESP32 no ejecutó el escalón.');
        if (elapsed > c.stepTotalS + 3) return this.abort('el escalón no terminó a tiempo.');
        return none();
      }

      default:
        return none();
    }
  }

  /** Cancelar: devuelve la orden de apagar el motor (vacía si ya no estaba activa) */
  abort(reason: string): StepUpdate {
    if (!this.active) return none();
    this._reason = reason;
    this.enter('abortado', this.lastT);
    return { commands: [{ type: 'cmd', action: 'stop' }], phaseChanged: true };
  }

  /** Texto corto del progreso para la UI */
  describe(): string {
    const c = this.cfg;
    switch (this._phase) {
      case 'despegue':
        return `Despegando… ${this.rampPwm} µs · ${fmt1(this.lastH)} cm`;
      case 'estabilizando':
        return `Flotando en ${c.u0} µs · ${fmt1(this.lastH)} cm · esperando ${c.stableWindowS} s quieto (${Math.floor(this.lastT - this.tPhase)} s)`;
      case 'escalon': {
        const elapsed = Math.min(this.lastT - this._stepStartT, c.stepTotalS);
        const u = elapsed < c.preStepS ? c.u0 : c.u0 + c.deltaU;
        return `Escalón ${Math.floor(elapsed)} / ${c.stepTotalS} s · ${u} µs · ${fmt1(this.lastH)} cm`;
      }
      case 'listo':
        return 'Ensayo completo ✓';
      case 'abortado':
        return `Cancelado: ${this._reason}`;
      default:
        return '';
    }
  }

  private enter(phase: StepPhase, t: number): void {
    this._phase = phase;
    this.tPhase = t;
    this.window = [];
    this.tBelow = null;
  }

  private driftHint(): string {
    const c = this.cfg;
    const w = this.window;
    const mean = (from: number, to: number) => {
      const hs = w.filter((e) => e.t >= from && e.t <= to).map((e) => e.h);
      return hs.reduce((a, b) => a + b, 0) / hs.length;
    };
    const first = w[0].t;
    const last = w[w.length - 1].t;
    const drift = mean(last - 1, last) - mean(first, first + 1);
    const base = `no se quedó quieto en ${c.stableTimeoutS} s con u₀ = ${c.u0} µs`;
    if (drift > c.stableBandCm / 2) return `${base}: sigue subiendo, baja u₀ unos 10 µs.`;
    if (drift < -c.stableBandCm / 2) return `${base}: va bajando, sube u₀ unos 10 µs.`;
    return `${base}: oscila más de ${c.stableBandCm} cm.`;
  }
}

/**
 * Datos del ensayo para identificar: desde que se pidió el escalón hasta antes de
 * que el motor se apague. Sin la rampa de despegue ni el apagado, el primer salto
 * del PWM es el escalón (así lo detecta IdentificacionFIT3.m).
 */
export function trimStepTest(samples: readonly TelemetrySample[], fromT: number): TelemetrySample[] {
  const out: TelemetrySample[] = [];
  for (const s of samples) {
    if (s.t < fromT) continue;
    if (s.pwm <= PWM_MIN) break;
    out.push(s);
  }
  return out;
}
