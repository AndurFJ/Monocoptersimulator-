/**
 * sensor.ts — modelo del sensor ultrasónico HC-SR04 simulado.
 *
 * Añade ruido gaussiano a la altura real y satura al rango del sensor.
 */

import { SENSOR_NOISE_SIGMA_M, SENSOR_RANGE_MIN_M, SENSOR_RANGE_MAX_M } from './constants';

/** Muestra de una normal estándar (Box-Muller) */
export function gaussian(random: () => number = Math.random): number {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Lectura simulada del sensor para una altura real [m] */
export function measureHeight(
  trueHeight: number,
  sigma = SENSOR_NOISE_SIGMA_M,
  random: () => number = Math.random,
): number {
  const reading = trueHeight + sigma * gaussian(random);
  return Math.max(SENSOR_RANGE_MIN_M, Math.min(SENSOR_RANGE_MAX_M, reading));
}
