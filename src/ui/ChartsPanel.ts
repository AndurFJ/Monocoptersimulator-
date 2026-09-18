/**
 * ChartsPanel — gráficas en tiempo real con uPlot.
 * TODO: implementar en Fase 4
 *
 * Tres series:
 * 1. Altura vs. tiempo (+ setpoint como línea punteada)
 * 2. PWM vs. tiempo
 * 3. Error / términos PID
 */

export class ChartsPanel {
  constructor(_container: HTMLElement) {
    // TODO: Fase 4 — inicializar charts uPlot
  }

  /** Agregar un punto a las gráficas */
  pushSample(_t: number, _height: number, _pwm: number, _setpoint?: number): void {
    // TODO: Fase 4
  }

  /** Limpiar todas las gráficas */
  clear(): void {
    // TODO: Fase 4
  }
}
