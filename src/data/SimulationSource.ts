/**
 * SimulationSource — fuente de datos del modo "Simulación PID".
 *
 * Corre el motor de física (MonocopterModel) + PIDController
 * en el navegador, generando TelemetrySamples a 50 Hz (PID_DT).
 *
 * Dos modos de control:
 *  - 'pid':    el PID calcula el throttle a partir de la altura medida
 *  - 'manual': el usuario fija el PWM directamente
 */

import type { DataSource, SourceStatus, TelemetrySample } from './types';
import { Clock } from './Clock';
import { MonocopterModel, throttleToPwm, pwmToThrottle, hoverThrottle } from '../physics/MonocopterModel';
import { PIDController } from '../physics/PIDController';
import { measureHeight } from '../physics/sensor';
import {
  PID_DT, I_MAX, DEFAULT_KP, DEFAULT_KI, DEFAULT_KD, PWM_MIN,
} from '../physics/constants';

export type ControlMode = 'pid' | 'manual';

/** Máximo de pasos de física por tick (evita espirales si el navegador se atrasa) */
const MAX_STEPS_PER_TICK = 10;

export class SimulationSource implements DataSource {
  readonly mode = 'simulacion' as const;

  readonly model: MonocopterModel;
  readonly pid = new PIDController(DEFAULT_KP, DEFAULT_KI, DEFAULT_KD, PID_DT, I_MAX, hoverThrottle());

  controlMode: ControlMode = 'pid';
  setpoint = 0.3;
  /** PWM manual [µs] */
  manualPwm = PWM_MIN;

  private t = 0;
  private accumulator = 0;
  private sampleCb: ((s: TelemetrySample) => void) | null = null;
  private readonly clock = new Clock((dt) => this.advance(dt));
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.model = new MonocopterModel({}, random);
  }

  start(): void {
    this.clock.start();
  }

  stop(): void {
    this.clock.stop();
  }

  reset(): void {
    this.model.reset();
    this.pid.reset();
    this.t = 0;
    this.accumulator = 0;
    const sample = this.makeSample(this.model.state.height, PWM_MIN);
    sample.heightTrue = sample.height;
    this.emit(sample);
  }

  onSample(cb: (s: TelemetrySample) => void): void {
    this.sampleCb = cb;
  }

  onStatus(_cb: (s: SourceStatus) => void): void {
    // La simulación no reporta estados
  }

  setGains(kp: number, ki: number, kd: number): void {
    this.pid.kp = kp;
    this.pid.ki = ki;
    this.pid.kd = kd;
  }

  setFeedforward(u0: number): void {
    this.pid.feedforward = u0;
  }

  setControlMode(mode: ControlMode): void {
    if (mode === this.controlMode) return;
    this.controlMode = mode;
    // Al volver a PID, arrancar sin integral acumulada ni error previo
    this.pid.reset();
  }

  /** Avanzar un periodo de control (PID_DT). Público para tests. */
  stepOnce(): TelemetrySample {
    const measured = measureHeight(this.model.state.height, undefined, this.random);

    let throttle: number;
    let sample: TelemetrySample;
    if (this.controlMode === 'pid') {
      const error = this.setpoint - measured;
      const out = this.pid.update(error);
      throttle = out.output;
      sample = this.makeSample(measured, throttleToPwm(throttle));
      sample.error = error;
      sample.pidTerms = { p: out.p, i: out.i, d: out.d };
    } else {
      throttle = pwmToThrottle(this.manualPwm);
      sample = this.makeSample(measured, this.manualPwm);
    }

    sample.heightTrue = this.model.state.height;
    this.model.step(throttle, PID_DT);
    this.t += PID_DT;
    return sample;
  }

  private advance(realDt: number): void {
    this.accumulator += realDt;
    let steps = 0;
    while (this.accumulator >= PID_DT && steps < MAX_STEPS_PER_TICK) {
      this.accumulator -= PID_DT;
      this.emit(this.stepOnce());
      steps++;
    }
    if (steps === MAX_STEPS_PER_TICK) this.accumulator = 0;
  }

  private makeSample(height: number, pwm: number): TelemetrySample {
    return {
      t: this.t,
      height,
      pwm,
      setpoint: this.controlMode === 'pid' ? this.setpoint : undefined,
    };
  }

  private emit(s: TelemetrySample): void {
    this.sampleCb?.(s);
  }
}
