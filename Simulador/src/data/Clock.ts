/**
 * Clock — reloj de pared para las fuentes que avanzan en tiempo real.
 *
 * Llama a `onTick(dtReal)` periódicamente con los segundos reales
 * transcurridos desde el tick anterior. Usa setInterval (no rAF) para
 * que la simulación no dependa de la tasa de refresco del monitor.
 */

/** Máximo dt aceptado por tick: evita saltos enormes al volver de una pestaña oculta */
const MAX_TICK_DT = 0.1;

export class Clock {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private readonly onTick: (dt: number) => void;
  private readonly intervalMs: number;

  constructor(onTick: (dt: number) => void, intervalMs = 10) {
    this.onTick = onTick;
    this.intervalMs = intervalMs;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - this.last) / 1000, MAX_TICK_DT);
      this.last = now;
      this.onTick(dt);
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
