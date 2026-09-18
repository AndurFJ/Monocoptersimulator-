/**
 * zones.ts — zonas de operación del banco (dato medido en el banco real).
 *
 *   0 – 10 % del recorrido   zona muerta  (apoyado en resortes, no controla)
 *  10 – 85 %                 span útil
 *  85 – 100 %                zona inestable (efecto techo, no se mantiene)
 */

import { DEAD_ZONE_TOP_M, UNSTABLE_ZONE_START_M } from './constants';

export type Zone = 'muerta' | 'util' | 'inestable';

export const ZONE_LABELS: Record<Zone, string> = {
  muerta: 'Zona muerta',
  util: 'Span útil',
  inestable: 'Zona inestable',
};

export function zoneOf(height: number): Zone {
  if (height < DEAD_ZONE_TOP_M) return 'muerta';
  if (height > UNSTABLE_ZONE_START_M) return 'inestable';
  return 'util';
}

/**
 * Tramo continuo más largo con todas las alturas dentro del span útil.
 * Devuelve índices [start, end] inclusivos, o null si no hay ninguno.
 */
export function longestSpanSegment(heights: readonly number[]): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  let start = -1;
  for (let i = 0; i <= heights.length; i++) {
    const inSpan = i < heights.length && zoneOf(heights[i]) === 'util';
    if (inSpan && start === -1) start = i;
    if (!inSpan && start !== -1) {
      if (!best || i - 1 - start > best.end - best.start) best = { start, end: i - 1 };
      start = -1;
    }
  }
  return best;
}
