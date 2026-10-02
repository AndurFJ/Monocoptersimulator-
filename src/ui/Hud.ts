/**
 * Hud — instrumento flotante superpuesto sobre el canvas 3D.
 *
 * Muestra el estado (en marcha / pausado / estable) con el tiempo, la altura
 * que mide el sensor en grande (filtrada como en el firmware) con su lectura
 * cruda debajo, una barra que marca el objetivo, el error y el PWM.
 */

import type { DataMode, TelemetrySample } from '../data/types';
import { normalizePwm } from '../physics/MonocopterModel';
import { H_MAX, DEAD_ZONE_FRACTION, UNSTABLE_ZONE_FRACTION } from '../physics/constants';
import { zoneOf, ZONE_LABELS } from '../physics/zones';
import { flash } from './animations';

/** Refresco del texto del HUD [ms]: 20 Hz, una vez por muestra del sensor */
const UPDATE_INTERVAL_MS = 50;

export const MODE_LABELS: Record<DataMode, string> = {
  simulacion: 'Simulación',
  reproduccion: 'Reproducción',
  serial: 'Serial en vivo',
  wifi: 'WiFi/ESP32 en vivo',
};

export type HudStatus = 'paused' | 'running' | 'settled' | 'live' | 'connecting' | 'failsafe';

const STATUS_LABELS: Record<HudStatus, string> = {
  paused: 'Pausado',
  running: 'En marcha',
  settled: 'HOVERING',
  live: 'CONECTADO',
  connecting: 'CONECTANDO…',
  failsafe: 'FAILSAFE',
};

const pct = (v: number) => `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private lastUpdate = 0;
  private pending: TelemetrySample | null = null;
  private status: HudStatus = 'paused';

  constructor(container: HTMLElement) {
    container.innerHTML = `
      <div class="hud-top">
        <span class="status-pill" data-hud="status"><span class="status-dot"></span><span data-hud="status-text">Pausado</span></span>
        <span class="hud-time" data-hud="time">0.0 s</span>
      </div>
      <div class="hud-mode" data-hud="mode">—</div>

      <div class="hud-label hud-label-row">Altura · sensor <span class="zone-tag" data-hud="zone" hidden></span></div>
      <div class="hud-big"><span data-hud="height">—</span><small>cm</small></div>
      <div class="hud-raw"><span>crudo</span> <b data-hud="raw">—</b> <span class="sensor-tag" data-hud="sensor" hidden>⚠ sin eco</span></div>
      <div class="gauge gauge-zones" aria-hidden="true"
        style="--dz: ${DEAD_ZONE_FRACTION * 100}%; --uz: ${UNSTABLE_ZONE_FRACTION * 100}%">
        <div class="gauge-fill" data-hud="height-bar"></div>
        <div class="gauge-target" data-hud="target-mark" hidden></div>
      </div>
      <div class="hud-pair" data-hud="setpoint-row" hidden>
        <div><span class="hud-label">Objetivo</span><b data-hud="setpoint">—</b></div>
        <div><span class="hud-label">Error</span><b data-hud="error">—</b></div>
      </div>

      <div class="hud-label hud-label-gap">Potencia</div>
      <div class="hud-row"><span><b data-hud="pwm">—</b> µs</span><span><b data-hud="pwm-pct">—</b></span></div>
      <div class="gauge gauge-thin" aria-hidden="true"><div class="gauge-fill gauge-fill-pwm" data-hud="pwm-bar"></div></div>
    `;
    container.querySelectorAll<HTMLElement>('[data-hud]').forEach((node) => {
      this.el[node.dataset.hud!] = node;
    });
  }

  /** Registrar una muestra; el texto se refresca a ~10 Hz */
  update(sample: TelemetrySample): void {
    this.pending = sample;
    const now = performance.now();
    if (now - this.lastUpdate < UPDATE_INTERVAL_MS) return;
    this.lastUpdate = now;
    this.render();
  }

  /** Forzar el refresco inmediato (p.ej. tras un reset) */
  flush(): void {
    this.render();
  }

  setMode(mode: DataMode): void {
    this.el.mode.textContent = MODE_LABELS[mode];
    flash(this.el.mode);
  }

  setStatus(status: HudStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.el.status.dataset.state = status;
    this.el['status-text'].textContent = STATUS_LABELS[status];
  }

  clear(): void {
    this.pending = null;
    this.el.height.textContent = '—';
    this.el.raw.textContent = '—';
    this.el.sensor.hidden = true;
    this.el.pwm.textContent = '—';
    this.el['pwm-pct'].textContent = '—';
    this.el.time.textContent = '0.0 s';
    this.el['height-bar'].style.width = '0%';
    this.el['pwm-bar'].style.width = '0%';
    this.el['setpoint-row'].hidden = true;
    this.el['target-mark'].hidden = true;
    this.el.zone.hidden = true;
  }

  private render(): void {
    const s = this.pending;
    if (!s) return;
    const e = this.el;
    e.height.textContent = (s.height * 100).toFixed(1);
    e.raw.textContent = s.raw === undefined ? '—' : `${(s.raw * 100).toFixed(1)} cm`;
    e.sensor.hidden = s.sensorOk !== false;
    const zone = zoneOf(s.height);
    e.zone.hidden = zone === 'util';
    e.zone.dataset.zone = zone;
    e.zone.textContent = zone === 'inestable' ? `⚠ ${ZONE_LABELS[zone]}` : ZONE_LABELS[zone];
    e['height-bar'].style.width = pct(s.height / H_MAX);

    const power = normalizePwm(s.pwm);
    e.pwm.textContent = String(Math.round(s.pwm));
    e['pwm-pct'].textContent = `${Math.round(power * 100)} %`;
    e['pwm-bar'].style.width = pct(power);
    e.time.textContent = `${s.t.toFixed(1)} s`;

    const hasSp = s.setpoint !== undefined;
    e['setpoint-row'].hidden = !hasSp;
    e['target-mark'].hidden = !hasSp;
    if (hasSp) {
      const sp = s.setpoint!;
      e.setpoint.textContent = `${(sp * 100).toFixed(1)} cm`;
      const err = s.error ?? sp - s.height;
      e.error.textContent = `${err >= 0 ? '+' : '−'}${Math.abs(err * 100).toFixed(1)} cm`;
      e['target-mark'].style.left = pct(sp / H_MAX);
    }
  }
}
