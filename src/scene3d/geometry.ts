/**
 * geometry.ts — relación entre la altura física y las posiciones en la escena.
 *
 * Compartido por RigBuilder (regla, marcador) y SceneManager (carro, resortes)
 * para que todo lo que se dibuja a "X cm" esté exactamente a la misma altura.
 */

import { WOOD_THICKNESS_M, SPRING_NATURAL_LENGTH_M, SPRING_ENGAGE_HEIGHT_M } from '../physics/constants';

/** Y de la cara superior del travesaño inferior (donde apoyan los resortes) */
export const SPRING_BASE_Y = 0.02 + WOOD_THICKNESS_M;

/** Distancia del origen del carro a la parte inferior de los bujes */
export const CARRIAGE_BOTTOM_OFFSET = 0.0075;

/**
 * Y del origen del carro (centro de la plataforma) para una altura física.
 * height = SPRING_ENGAGE_HEIGHT_M ⇔ los bujes tocan justo los resortes sin comprimir.
 */
export function carriageYForHeight(height: number): number {
  return SPRING_BASE_Y + SPRING_NATURAL_LENGTH_M + CARRIAGE_BOTTOM_OFFSET + (height - SPRING_ENGAGE_HEIGHT_M);
}
