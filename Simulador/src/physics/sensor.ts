/**
 * sensor.ts — modelo del sensor ultrasónico HC-SR04 simulado.
 *
 * Añade ruido gaussiano a la altura real y satura al rango del sensor.
 */

import {
  SENSOR_NOISE_SIGMA_M, SENSOR_RANGE_MIN_M, SENSOR_RANGE_MAX_M,
  SENSOR_CROSSBAR_ECHO_PROB, SENSOR_CROSSBAR_M, SENSOR_ECHO_LOSS_PROB,
} from './constants';

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

/**
 * Lectura cruda simulada del HC-SR04 tal como llega al firmware [m]:
 * ruido gaussiano, ecos esporádicos del travesaño superior y pérdidas de eco
 * (null). Es lo que el filtro del firmware (SensorFilter) tiene que limpiar.
 */
export function rawReading(
  trueHeight: number,
  random: () => number = Math.random,
  crossbarProb = SENSOR_CROSSBAR_ECHO_PROB,
  lossProb = SENSOR_ECHO_LOSS_PROB,
): number | null {
  const r = random();
  if (r < lossProb) return null;
  if (r < lossProb + crossbarProb) return SENSOR_CROSSBAR_M + 0.03 * (random() - 0.5);
  return measureHeight(trueHeight, SENSOR_NOISE_SIGMA_M, random);
}
