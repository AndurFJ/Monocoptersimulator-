/**
 * SimulationSource — fuente de datos del modo "Simulación".
 *
 * Reproduce el banco en el navegador con las mismas piezas que el prototipo:
 *   planta identificada (FOPDT Fit 3) → HC-SR04 simulado (ruido, ecos del
 *   travesaño, pérdidas) → filtro del firmware → PID del firmware → PWM.
 * Corre a Ts = 50 ms (PID_DT), igual que el Arduino/ESP32, y aplica el mismo
 * failsafe (altura filtrada ≥ 85 cm durante 3 muestras → motor a 1000 µs).
 *
 * Dos modos de control:
 *  - 'pid':    el PID calcula el PWM a partir de la altura filtrada
 *  - 'manual': el usuario fija el PWM directamente
 */

import type { DataSource, SourceStatus, TelemetrySample } from './types';
import { Clock } from './Clock';
import { IdentifiedPlant } from '../physics/IdentifiedPlant';
import { PIDController } from '../physics/PIDController';
import { SensorFilter } from '../physics/SensorFilter';
import { rawReading } from '../physics/sensor';
import {
  PID_DT, I_MAX, DEFAULT_KP, DEFAULT_KI, DEFAULT_KD, DEFAULT_U0_US, PWM_MIN,
  PID_U_MIN, PID_U_MAX, D_FILTER, FAILSAFE_M, FAILSAFE_SAMPLES,
} from '../physics/constants';

export type ControlMode = 'pid' | 'manual';

/** Máximo de pasos de control por tick (evita espirales si el navegador se atrasa) */
const MAX_STEPS_PER_TICK = 10;

/** Tiempo con el motor apagado tras el cual "sin eco" significa "en la base" [s] */
const MOTOR_OFF_SETTLE_S = 1;

export class SimulationSource implements DataSource {
  readonly mode = 'simulacion' as const;

  readonly model: IdentifiedPlant;
  readonly filter = new SensorFilter();
  readonly pid = new PIDController(DEFAULT_KP, DEFAULT_KI, DEFAULT_KD, PID_DT, DEFAULT_U0_US, {
    uMin: PID_U_MIN, uMax: PID_U_MAX, iMax: I_MAX, dFilter: D_FILTER,
  });

  controlMode: ControlMode = 'pid';
  setpoint = 0.3;
  /** PWM manual [µs] */
  manualPwm = PWM_MIN;

  private t = 0;
  private accumulator = 0;
  private pwm = PWM_MIN;
  private motorOffSince = 0;
  private overLimit = 0;
  private failsafe = false;
  private sampleCb: ((s: TelemetrySample) => void) | null = null;
  private statusCb: ((s: SourceStatus) => void) | null = null;
  private readonly clock = new Clock((dt) => this.advance(dt));
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.model = new IdentifiedPlant({}, random);
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
    this.filter.reset();
    this.t = 0;
    this.accumulator = 0;
    this.pwm = PWM_MIN;
    this.motorOffSince = 0;
    this.overLimit = 0;
    this.failsafe = false;
    const h = this.model.state.height;
    const sample = this.makeSample(h, PWM_MIN);
    sample.heightTrue = h;
    this.emit(sample);
  }

  onSample(cb: (s: TelemetrySample) => void): void {
    this.sampleCb = cb;
  }

  onStatus(cb: (s: SourceStatus) => void): void {
    this.statusCb = cb;
  }

  setGains(kp: number, ki: number, kd: number): void {
    this.pid.kp = kp;
    this.pid.ki = ki;
    this.pid.kd = kd;
  }

  /** PWM de equilibrio [µs] */
  setFeedforward(u0: number): void {
    this.pid.feedforward = u0;
  }

  setControlMode(mode: ControlMode): void {
    if (mode === this.controlMode) return;
    this.controlMode = mode;
    // Al volver a PID, arrancar sin integral acumulada ni historia
    this.pid.reset();
  }

  /** Rearmar tras un failsafe (el motor sigue apagado hasta el próximo comando) */
  clearFailsafe(): void {
    this.failsafe = false;
    this.overLimit = 0;
    this.pid.reset();
  }

  /** Avanzar un periodo de control (PID_DT). Público para tests. */
  stepOnce(): TelemetrySample {
    const trueH = this.model.state.height;
    const raw = rawReading(trueH, this.random);
    const motorOff = this.pwm <= PWM_MIN && this.t - this.motorOffSince >= MOTOR_OFF_SETTLE_S;
    const measured = this.filter.push(raw, motorOff);

    // Failsafe del firmware: altura FILTRADA ≥ 85 cm durante 3 muestras
    let tripped = false;
    if (!this.failsafe && this.pwm > PWM_MIN) {
      this.overLimit = measured >= FAILSAFE_M ? this.overLimit + 1 : 0;
      if (this.overLimit >= FAILSAFE_SAMPLES) {
        this.failsafe = true;
        tripped = true;
        this.pid.reset();
        this.statusCb?.({ level: 'warning', message: '⚠ FAILSAFE: altura ≥ 85 cm — motor a 1000 µs. Reinicia (R) para continuar.' });
      }
    }

    let pwm: number;
    let sample: TelemetrySample;
    if (this.failsafe) {
      pwm = PWM_MIN;
      sample = this.makeSample(measured, pwm);
    } else if (this.controlMode === 'pid') {
      const out = this.pid.update(this.setpoint * 100, measured * 100);
      pwm = out.output;
      sample = this.makeSample(measured, pwm);
      sample.error = this.setpoint - measured;
      sample.pidTerms = { p: out.p, i: out.i, d: out.d };
    } else {
      pwm = this.manualPwm;
      sample = this.makeSample(measured, pwm);
    }

    if (pwm <= PWM_MIN && this.pwm > PWM_MIN) this.motorOffSince = this.t;
    this.pwm = pwm;
    if (raw !== null) sample.raw = raw;
    sample.sensorOk = this.filter.ok;
    sample.heightTrue = trueH;
    if (tripped) sample.failsafe = true;
    this.model.step(pwm, PID_DT);
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
      setpoint: this.controlMode === 'pid' && !this.failsafe ? this.setpoint : undefined,
    };
  }

  private emit(s: TelemetrySample): void {
    this.sampleCb?.(s);
  }
}
