/**
 * MonocopterModel — ecuaciones de movimiento del sistema 1-GDL.
 * TODO: implementar en Fase 3
 *
 * spec.md §6:
 *   m · ḧ = F_empuje(pwm) − m·g − b·ḣ − F_resorte(h) − F_fricción·sign(ḣ)
 *   h ∈ [0, h_max]   (saturado)
 */

export class MonocopterModel {
  /** Avanzar un paso de simulación. Devuelve la nueva altura y velocidad. */
  step(_pwm: number, _dt: number): { height: number; velocity: number } {
    // TODO: Fase 3 — integrar ecuaciones de movimiento
    return { height: 0, velocity: 0 };
  }

  /** Resetear el estado del modelo (h=0, v=0) */
  reset(): void {
    // TODO: Fase 3
  }
}
