/**
 * MonocopterModel — modelo de primeros principios del sistema 1-GDL (referencia).
 *
 * La simulación usa IdentifiedPlant (la planta identificada en el banco); este
 * modelo se conserva como referencia física y por sus funciones auxiliares de PWM.
 *
 * spec.md §6:
 *   m · ḧ = F_empuje(pwm) − m·g − b·ḣ − F_resorte(h) − F_fricción·sign(ḣ)
 *   h ∈ [0, h_max]   (saturado)
 *
 * La entrada es el throttle comandado u ∈ [0, 1]. El motor lo sigue con un
 * retardo de primer orden (τ_m · u̇_m = u − u_m) y F_empuje = k_t · u_m².
 * Los resortes solo empujan cuando el carro baja de SPRING_ENGAGE_HEIGHT_M
 * (zona muerta). En la zona inestable, cerca del travesaño superior, el
 * efecto techo aumenta el empuje con la altura y aparece turbulencia.
 */

import {
  CARRIAGE_MASS_KG, GRAVITY, THRUST_COEFFICIENT, DAMPING_COEFFICIENT,
  RAIL_FRICTION_N, SPRING_STIFFNESS, SPRING_ENGAGE_HEIGHT_M, MOTOR_TIME_CONSTANT_S,
  H_MIN, H_MAX, PWM_MIN, PWM_MAX,
  UNSTABLE_ZONE_START_M, CEILING_THRUST_GAIN, CEILING_TURBULENCE_N, TURBULENCE_TIME_CONSTANT_S,
} from './constants';
import { gaussian } from './sensor';

export interface MonocopterParams {
  mass: number;
  gravity: number;
  thrustCoefficient: number;
  damping: number;
  friction: number;
  springStiffness: number;
  springEngageHeight: number;
  /** Constante de tiempo del motor [s]; 0 = empuje instantáneo */
  motorTimeConstant: number;
  /** Altura donde empieza la zona inestable [m] */
  unstableStart: number;
  /** Ganancia extra de empuje en el tope por efecto techo; 0 = sin efecto */
  ceilingGain: number;
  /** Turbulencia en el tope [N] (desviación típica); 0 = sin turbulencia */
  ceilingTurbulence: number;
  hMin: number;
  hMax: number;
}

export const DEFAULT_PARAMS: MonocopterParams = {
  mass: CARRIAGE_MASS_KG,
  gravity: GRAVITY,
  thrustCoefficient: THRUST_COEFFICIENT,
  damping: DAMPING_COEFFICIENT,
  friction: RAIL_FRICTION_N,
  springStiffness: SPRING_STIFFNESS,
  springEngageHeight: SPRING_ENGAGE_HEIGHT_M,
  motorTimeConstant: MOTOR_TIME_CONSTANT_S,
  unstableStart: UNSTABLE_ZONE_START_M,
  ceilingGain: CEILING_THRUST_GAIN,
  ceilingTurbulence: CEILING_TURBULENCE_N,
  hMin: H_MIN,
  hMax: H_MAX,
};

/** Paso máximo de integración interna [s] — los resortes son rígidos */
const MAX_SUBSTEP = 0.002;

/** Velocidad por debajo de la cual se considera el carro detenido [m/s] */
const STICTION_VELOCITY = 1e-4;

/** Convierte throttle normalizado [0,1] a PWM en µs */
export function throttleToPwm(u: number): number {
  return PWM_MIN + clamp(u, 0, 1) * (PWM_MAX - PWM_MIN);
}

/** Convierte PWM en µs a throttle normalizado [0,1] */
export function pwmToThrottle(pwm: number): number {
  return clamp((pwm - PWM_MIN) / (PWM_MAX - PWM_MIN), 0, 1);
}

/** Throttle necesario para que el empuje iguale al peso: u₀ = √(m·g / k_t) */
export function hoverThrottle(params: MonocopterParams = DEFAULT_PARAMS): number {
  return Math.sqrt((params.mass * params.gravity) / params.thrustCoefficient);
}

/** Altura de reposo sobre los resortes con el motor apagado */
export function restHeight(params: MonocopterParams = DEFAULT_PARAMS): number {
  const compression = (params.mass * params.gravity) / params.springStiffness;
  return Math.max(params.hMin, params.springEngageHeight - compression);
}

export class MonocopterModel {
  readonly params: MonocopterParams;
  private height: number;
  private velocity = 0;
  /** Throttle efectivo del motor (va detrás del comandado) */
  private motor = 0;
  /** Fuerza de turbulencia actual [N] (ruido filtrado de primer orden) */
  private turbulence = 0;
  private readonly random: () => number;

  constructor(params: Partial<MonocopterParams> = {}, random: () => number = Math.random) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.height = restHeight(this.params);
    this.random = random;
  }

  /** Profundidad en la zona inestable ∈ [0,1] (0 = fuera, 1 = en el tope) */
  ceilingDepth(h: number): number {
    const { unstableStart, hMax } = this.params;
    if (hMax <= unstableStart) return 0;
    return Math.max(0, Math.min(1, (h - unstableStart) / (hMax - unstableStart)));
  }

  /** Multiplicador del empuje por efecto techo (≥ 1) */
  ceilingFactor(h: number): number {
    const s = this.ceilingDepth(h);
    return 1 + this.params.ceilingGain * s * s;
  }

  get state(): { height: number; velocity: number } {
    return { height: this.height, velocity: this.velocity };
  }

  /** Throttle efectivo del motor ∈ [0,1] (proporcional a la velocidad del rotor) */
  get motorThrottle(): number {
    return this.motor;
  }

  /** Fuerza de los resortes (solo cuando el carro los comprime) */
  springForce(h: number): number {
    const { springEngageHeight, springStiffness } = this.params;
    return h < springEngageHeight ? springStiffness * (springEngageHeight - h) : 0;
  }

  /**
   * Avanzar un paso de simulación. `throttle` ∈ [0,1].
   * Devuelve la nueva altura y velocidad.
   */
  step(throttle: number, dt: number): { height: number; velocity: number } {
    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(clamp(throttle, 0, 1), h);
    return this.state;
  }

  private substep(u: number, dt: number): void {
    const p = this.params;
    // Dinámica del motor (Euler exacto del primer orden)
    this.motor = p.motorTimeConstant > 0
      ? this.motor + (u - this.motor) * (1 - Math.exp(-dt / p.motorTimeConstant))
      : u;
    const thrust = p.thrustCoefficient * this.motor * this.motor * this.ceilingFactor(this.height);

    // Turbulencia bajo el travesaño: ruido blanco filtrado, escala con la profundidad
    // en la zona inestable y con el empuje (sin hélice girando no hay turbulencia)
    const depth = this.ceilingDepth(this.height);
    if (p.ceilingTurbulence > 0 && depth > 0) {
      const k = dt / TURBULENCE_TIME_CONSTANT_S;
      const sigma = p.ceilingTurbulence * depth * this.motor * Math.sqrt(2 / k);
      this.turbulence += (sigma * gaussian(this.random) - this.turbulence) * Math.min(1, k);
    } else {
      this.turbulence = 0;
    }

    // Fuerzas sin la fricción de Coulomb
    const force = thrust + this.turbulence - p.mass * p.gravity - p.damping * this.velocity
      + this.springForce(this.height);

    let netForce: number;
    if (Math.abs(this.velocity) < STICTION_VELOCITY) {
      // Carro detenido: la fricción estática retiene mientras pueda
      if (Math.abs(force) <= p.friction) {
        this.velocity = 0;
        return;
      }
      netForce = force - p.friction * Math.sign(force);
    } else {
      netForce = force - p.friction * Math.sign(this.velocity);
    }

    // Euler semi-implícito
    this.velocity += (netForce / p.mass) * dt;
    this.height += this.velocity * dt;

    // Topes duros del recorrido (choque inelástico)
    if (this.height <= p.hMin) {
      this.height = p.hMin;
      if (this.velocity < 0) this.velocity = 0;
    } else if (this.height >= p.hMax) {
      this.height = p.hMax;
      if (this.velocity > 0) this.velocity = 0;
    }
  }

  /** Resetear el estado del modelo (carro en reposo sobre los resortes) */
  reset(): void {
    this.height = restHeight(this.params);
    this.velocity = 0;
    this.motor = 0;
    this.turbulence = 0;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Fracción de potencia [0,1] para un PWM de cualquier convención.
 * Los datos reales pueden venir en µs (1000–2000) o en 0–255 (analogWrite):
 * valores por debajo de PWM_MIN solo tienen sentido en la escala de 8 bits.
 */
export function normalizePwm(pwm: number): number {
  if (pwm < PWM_MIN && PWM_MIN > 255) return clamp(pwm / 255, 0, 1);
  return pwmToThrottle(pwm);
}
