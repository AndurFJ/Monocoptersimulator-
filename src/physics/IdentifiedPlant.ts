/**
 * IdentifiedPlant — la planta tal como se identificó en el banco real.
 *
 * Modelo FOPDT de la Etapa 1 (Fit 3) con las no linealidades que se ven en
 * el banco:
 *
 *   tau · ẏ = y_ss(u(t − t0)) − y
 *   y_ss(u) = clamp(Y0 + K·(u − U0), REST, H_MAX)
 *
 * - Por debajo del PWM de despegue el carro queda apoyado en los resortes
 *   (el sensor lee REST_HEIGHT_M ≈ 11 cm): a 1000 µs baja y se queda en la base.
 * - Arriba lo detiene el travesaño (H_MAX).
 * - En la zona inestable (> 85 cm) aparece turbulencia por el efecto techo.
 *
 * Así la simulación responde como el prototipo: misma ganancia, misma
 * constante de tiempo y mismo retardo que se midieron.
 */

import {
  PLANT_K_CM_PER_US, PLANT_TAU_S, PLANT_DELAY_S, PLANT_U0_US, PLANT_Y0_M,
  REST_HEIGHT_M, H_MAX, PWM_MIN, PWM_MAX, UNSTABLE_ZONE_START_M, TURBULENCE_TIME_CONSTANT_S,
} from './constants';
import { gaussian } from './sensor';

export interface PlantParams {
  /** Ganancia estática [m/µs] */
  k: number;
  /** Constante de tiempo [s] */
  tau: number;
  /** Tiempo muerto [s] */
  delay: number;
  /** PWM del punto de operación [µs] */
  u0: number;
  /** Altura del punto de operación [m] */
  y0: number;
  /** Altura con el carro apoyado [m] */
  rest: number;
  /** Tope superior [m] */
  hMax: number;
  /** Inicio de la zona inestable [m] */
  unstableStart: number;
  /** Turbulencia en el tope [m] (desviación típica de la perturbación); 0 = sin turbulencia */
  turbulence: number;
  /** Ruido de proceso en el span útil [m]; 0 = determinista */
  processNoise: number;
}

export const DEFAULT_PLANT: PlantParams = {
  k: PLANT_K_CM_PER_US / 100,
  tau: PLANT_TAU_S,
  delay: PLANT_DELAY_S,
  u0: PLANT_U0_US,
  y0: PLANT_Y0_M,
  rest: REST_HEIGHT_M,
  hMax: H_MAX,
  unstableStart: UNSTABLE_ZONE_START_M,
  turbulence: 0.02,
  processNoise: 0.0015,
};

/** Paso interno de integración [s] */
const SUBSTEP = 0.005;

export class IdentifiedPlant {
  readonly params: PlantParams;
  private height: number;
  private velocity = 0;
  private disturbance = 0;
  /** Historia de la entrada para el retardo puro [µs] */
  private readonly delayLine: number[];
  private readonly random: () => number;

  constructor(params: Partial<PlantParams> = {}, random: () => number = Math.random) {
    this.params = { ...DEFAULT_PLANT, ...params };
    this.random = random;
    this.height = this.params.rest;
    this.delayLine = new Array(Math.max(1, Math.round(this.params.delay / SUBSTEP))).fill(PWM_MIN);
  }

  get state(): { height: number; velocity: number } {
    return { height: this.height, velocity: this.velocity };
  }

  /** Altura de equilibrio para un PWM constante [m] */
  steadyHeight(pwm: number): number {
    const { k, u0, y0, rest, hMax } = this.params;
    return clamp(y0 + k * (pwm - u0), rest, hMax);
  }

  /** PWM a partir del cual el carro se despega de la base [µs] */
  liftOffPwm(): number {
    const { k, u0, y0, rest } = this.params;
    return u0 + (rest - y0) / k;
  }

  /** Avanzar `dt` segundos con el PWM `pwm` [µs] */
  step(pwm: number, dt: number): { height: number; velocity: number } {
    const u = clamp(pwm, PWM_MIN, PWM_MAX);
    const n = Math.max(1, Math.round(dt / SUBSTEP));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(u, h);
    return this.state;
  }

  private substep(u: number, dt: number): void {
    const p = this.params;
    this.delayLine.push(u);
    const uDelayed = this.delayLine.shift()!;

    // Perturbación: ruido filtrado, mayor bajo el travesaño y solo con la hélice girando
    const flying = this.height > p.rest + 0.002 || uDelayed > this.liftOffPwm();
    const depth = p.hMax > p.unstableStart
      ? clamp((this.height - p.unstableStart) / (p.hMax - p.unstableStart), 0, 1)
      : 0;
    const sigma = flying ? p.processNoise + p.turbulence * depth : 0;
    const a = Math.min(1, dt / TURBULENCE_TIME_CONSTANT_S);
    this.disturbance += (sigma * gaussian(this.random) - this.disturbance) * a;

    const target = this.steadyHeight(uDelayed) + this.disturbance;
    const prev = this.height;
    this.height += (target - this.height) * (1 - Math.exp(-dt / p.tau));
    this.height = clamp(this.height, p.rest, p.hMax);
    this.velocity = (this.height - prev) / dt;
  }

  /** Carro en reposo sobre los resortes, motor apagado */
  reset(): void {
    this.height = this.params.rest;
    this.velocity = 0;
    this.disturbance = 0;
    this.delayLine.fill(PWM_MIN);
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
