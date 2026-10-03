/**
 * phone.ts — mando remoto del banco en el teléfono (control.html).
 *
 * El teléfono no guarda estado propio: dibuja la instantánea que publica la
 * página del PC y le manda intenciones. Para que el dedo no «pelee» con la red,
 * mientras se arrastra un control (y hasta que el PC confirma el valor) se
 * muestra el valor local; después manda siempre lo que dice el PC.
 */

import '../styles/phone.css';
import { H_MAX, FAILSAFE_M } from '../physics/constants';
import { REMOTE_PATH, STALE_MS, parseMessage } from './protocol';
import type { PhoneToBridge, RemoteCommand, RemoteField, RemoteState } from './protocol';

/** Altura de la torre [cm] */
const TOWER_CM = H_MAX * 100;
/** Alarma de altura de la guía (R7) [cm] */
const ALARM_CM = 80;
const FAILSAFE_CM = FAILSAFE_M * 100;
/** Ventana de la tendencia [s] */
const TREND_S = 30;
/** Envío de órdenes mientras se arrastra [ms] */
const DRAG_SEND_MS = 80;
/** Tras soltar, el valor local se mantiene hasta que el PC lo confirma o pasa este tiempo [ms] */
const HOLD_MS = 1500;
/** Distancia máxima a la marca para agarrarla [px] (un toque suelto no salta el setpoint) */
const GRAB_PX = 30;

const MODE_LABELS: Record<RemoteState['mode'], string> = {
  simulacion: 'SIM',
  serial: 'USB',
  wifi: 'WiFi',
  reproduccion: 'REPRO',
};

type Edit<T> = { value: T; dragging: boolean; until: number };
type LinkState = 'connecting' | 'pairing' | 'online' | 'reconnecting';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round05 = (v: number) => Math.round(v * 2) / 2;
const vibrate = (pattern: number | number[]) => { try { navigator.vibrate?.(pattern); } catch { /* iOS */ } };

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android' : 'Tablet Android';
  return 'Navegador';
}

function storage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

class PhoneApp {
  private readonly root: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};

  // Enlace
  private ws: WebSocket | null = null;
  private link: LinkState = 'connecting';
  private pin = '';
  private retryMs = 500;
  private hostOnline = false;
  private controller = false;
  private seq = 1;
  private readonly pending = new Map<number, number>();
  private rtt: number | null = null;

  // Estado
  private state: RemoteState | null = null;
  private lastStateAt = 0;
  private sp: Edit<number> | null = null;
  private pwm: Edit<number> | null = null;
  private control: Edit<'pid' | 'manual'> | null = null;
  private readonly trend: { t: number; y: number; sp: number }[] = [];

  // Arrastre
  private pendingDrag: RemoteCommand | null = null;
  private dragSendTimer: ReturnType<typeof setTimeout> | null = null;
  private dragLastSent = 0;
  private lastTick5 = NaN;

  constructor(root: HTMLElement) {
    this.root = root;
    this.renderShell();
    this.bind();

    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('pin');
    if (fromUrl) {
      storage()?.setItem('mando-pin', fromUrl);
      // El PIN no se queda a la vista en la barra de direcciones
      history.replaceState(null, '', location.pathname);
    }
    this.pin = fromUrl ?? storage()?.getItem('mando-pin') ?? '';
    if (this.pin) this.connect();
    else this.showPairing('');

    setInterval(() => this.render(), 250);
  }

  // ── Construcción ───────────────────────────────────────────────

  private renderShell(): void {
    const ticks: string[] = [];
    for (let cm = 0; cm <= TOWER_CM; cm += 10) {
      const major = cm % 20 === 0;
      ticks.push(`<span class="tw-tick${major ? ' major' : ''}" style="--at:${cm / TOWER_CM}">${major ? `<b>${cm}</b>` : ''}</span>`);
    }
    this.root.innerHTML = `
      <div class="phone" data-link="connecting">
        <header class="ph-top">
          <div class="ph-brand">
            <span class="brand-mark" aria-hidden="true">◈</span>
            <div><b>Mando remoto</b><small data-out="device">Monocóptero 1-GDL</small></div>
          </div>
          <span class="ph-link" data-out="link"><i></i><span data-out="link-text">Conectando…</span></span>
        </header>

        <div class="ph-chips">
          <span class="ph-chip" data-out="mode">—</span>
          <span class="ph-chip ph-state" data-out="state">—</span>
          <span class="ph-flex"></span>
          <button type="button" class="ph-run" data-action="run" aria-label="Iniciar o pausar la simulación" hidden>▶</button>
        </div>

        <div class="ph-notice" data-out="notice" hidden></div>
        <div class="ph-viewer" data-out="viewer" hidden>
          <span>👁 Solo ver: otro teléfono tiene el mando</span>
          <button type="button" data-action="take">Tomar el mando</button>
        </div>

        <main class="ph-main">
          <section class="ph-tower" data-out="tower" aria-label="Torre del banco. Arrastra la marca ámbar para cambiar el setpoint.">
            <div class="tw-scale">${ticks.join('')}</div>
            <div class="tw-rail" data-out="rail" style="--alarm:${ALARM_CM / TOWER_CM}; --fs:${FAILSAFE_CM / TOWER_CM}">
              <div class="tw-alarm"></div>
              <div class="tw-dead" data-out="dead"></div>
              <div class="tw-fs"></div>
              <div class="tw-carriage" data-out="carriage"><span class="tw-prop"></span></div>
              <div class="tw-sp" data-out="sp-marker">
                <span class="tw-sp-handle"><b data-out="sp-handle">—</b></span>
              </div>
            </div>
          </section>

          <section class="ph-side">
            <div class="ph-tiles">
              <div class="ph-tile tile-y"><span>Altura</span><b data-out="y">—</b><small>cm</small></div>
              <div class="ph-tile tile-sp"><span>Objetivo <em class="ph-pc" data-pc="setpoint" hidden>🖥 PC</em></span><b data-out="sp">—</b><small>cm</small></div>
              <div class="ph-tile tile-u"><span>PWM</span><b data-out="u">—</b><small>µs</small></div>
            </div>
            <canvas class="ph-trend" data-out="trend" aria-hidden="true"></canvas>

            <div class="segmented ph-seg" data-out="seg">
              <button type="button" data-control="pid">AUTO · PID</button>
              <button type="button" data-control="manual">MANUAL</button>
              <em class="ph-pc" data-pc="control" hidden>🖥 PC</em>
            </div>

            <div class="ph-panel" data-only="pid">
              <div class="ph-row4">
                <button type="button" class="ph-key" data-nudge="-5">−5</button>
                <button type="button" class="ph-key" data-nudge="-1">−1</button>
                <button type="button" class="ph-key" data-nudge="1">+1</button>
                <button type="button" class="ph-key" data-nudge="5">+5</button>
              </div>
              <div class="ph-row4">
                ${[20, 30, 40, 50].map((cm) => `<button type="button" class="chip" data-preset="${cm}">${cm}</button>`).join('')}
              </div>
              <button type="button" class="ph-go" data-action="go">▲ Iniciar PID</button>
              <div class="ph-engaged" data-out="engaged" hidden><i></i> PID cerrando el lazo</div>
              <div class="ph-profile">
                <button type="button" class="ph-profile-btn" data-action="profile">▶ Secuencia P2 · 20→40→30→50</button>
                <div class="ph-profile-track" data-out="profile-track" hidden>
                  ${[0, 1, 2, 3].map((i) => `<span data-seg="${i}"><i></i><b></b></span>`).join('')}
                </div>
              </div>
              <p class="ph-gains mono" data-out="gains"></p>
            </div>

            <div class="ph-panel" data-only="manual">
              <div class="ph-pwm"><b data-out="pwm">—</b><small>µs</small><em class="ph-pc" data-pc="pwm" hidden>🖥 PC</em></div>
              <div class="ph-slider" data-out="slider">
                <div class="sl-track"><i></i></div>
                <span class="sl-u0" data-out="u0-mark">u₀</span>
                <div class="sl-thumb"></div>
              </div>
              <div class="ph-row4">
                <button type="button" class="ph-key" data-jog="-25">−25</button>
                <button type="button" class="ph-key" data-jog="-5">−5</button>
                <button type="button" class="ph-key" data-jog="5">+5</button>
                <button type="button" class="ph-key" data-jog="25">+25</button>
              </div>
              <p class="ph-hint">Arrastra el círculo para mover el PWM. 1000 µs = motor apagado.</p>
            </div>
          </section>
        </main>

        <footer class="ph-bottom">
          <button type="button" class="ph-rearm" data-action="rearm" hidden>Rearmar tras el failsafe</button>
          <button type="button" class="ph-stop" data-action="stop"><span aria-hidden="true">⏻</span> PARADA</button>
        </footer>

        <div class="ph-overlay" data-out="overlay" hidden>
          <div class="ph-overlay-card">
            <div class="ph-spinner" aria-hidden="true"></div>
            <b data-out="overlay-title">Conectando…</b>
            <p data-out="overlay-text"></p>
          </div>
        </div>

        <form class="ph-pair" data-out="pair" hidden>
          <div class="ph-pair-card">
            <span class="brand-mark" aria-hidden="true">◈</span>
            <b>Emparejar con el simulador</b>
            <p>Escribe el PIN de 4 cifras que aparece en la tarjeta <em>Control remoto</em> del PC.</p>
            <input data-out="pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code"
              aria-label="PIN" placeholder="····" />
            <p class="ph-pair-error" data-out="pair-error"></p>
            <button type="submit" class="ph-go">Entrar</button>
          </div>
        </form>

        <div class="ph-toasts" data-out="toasts" aria-live="polite"></div>
      </div>
    `;
    this.root.querySelectorAll<HTMLElement>('[data-out]').forEach((n) => { this.el[n.dataset.out!] = n; });
    this.el.device.textContent = `${deviceName()} · Monocóptero 1-GDL`;
    new ResizeObserver(() => this.drawTrend()).observe(this.el.trend);
  }

  private get phone(): HTMLElement {
    return this.root.firstElementChild as HTMLElement;
  }

  // ── Eventos ────────────────────────────────────────────────────

  private bind(): void {
    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!t || t.disabled) return;
      const s = this.state;
      if (t.dataset.action === 'take') return this.sendRaw({ t: 'take' });
      if (t.dataset.action === 'stop') {
        vibrate([40, 30, 40]);
        return this.command({ k: 'stop' });
      }
      if (!s) return;
      vibrate(8);
      if (t.dataset.nudge) {
        this.setSp(this.shownSp + Number(t.dataset.nudge), false);
      } else if (t.dataset.preset) {
        const cm = clamp(Number(t.dataset.preset), s.spMin, s.spMax);
        this.sp = { value: cm, dragging: false, until: performance.now() + HOLD_MS };
        this.command({ k: 'go', cm });
      } else if (t.dataset.jog) {
        this.setPwm(this.shownPwm + Number(t.dataset.jog), false);
      } else if (t.dataset.control) {
        const mode = t.dataset.control as 'pid' | 'manual';
        this.control = { value: mode, dragging: false, until: performance.now() + HOLD_MS };
        this.command({ k: 'control', mode });
      } else if (t.dataset.action === 'go') {
        this.command({ k: 'go', cm: this.shownSp });
      } else if (t.dataset.action === 'rearm') {
        this.command({ k: 'rearm' });
      } else if (t.dataset.action === 'run') {
        this.command({ k: 'run', on: !s.running });
      } else if (t.dataset.action === 'profile') {
        this.command({ k: 'profile', on: s.profile === null });
      }
      this.render();
    });

    this.bindTowerDrag();
    this.bindSliderDrag();

    const pair = this.el.pair as HTMLFormElement;
    const input = this.el['pin-input'] as HTMLInputElement;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      if (input.value.length === 4) pair.requestSubmit();
    });
    pair.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.length !== 4) return;
      this.pin = input.value;
      storage()?.setItem('mando-pin', this.pin);
      pair.hidden = true;
      if (this.ws?.readyState === WebSocket.OPEN) this.hello();
      else this.connect();
    });
  }

  /** Arrastrar la marca del setpoint sobre la torre */
  private bindTowerDrag(): void {
    const tower = this.el.tower;
    const rail = this.el.rail;
    let dragging = false;
    const cmAt = (clientY: number) => {
      const r = rail.getBoundingClientRect();
      return ((r.bottom - clientY) / r.height) * TOWER_CM;
    };
    tower.addEventListener('pointerdown', (e) => {
      const s = this.state;
      if (!s || !this.canControl) return;
      const r = rail.getBoundingClientRect();
      const markerY = r.bottom - (this.shownSp / TOWER_CM) * r.height;
      if (Math.abs(e.clientY - markerY) > GRAB_PX) {
        this.toast('Arrastra la marca ámbar para mover el setpoint.');
        return;
      }
      dragging = true;
      tower.setPointerCapture(e.pointerId);
      this.phone.classList.add('dragging-sp');
      this.sendRaw({ t: 'touch', field: 'setpoint', on: true });
      this.setSp(cmAt(e.clientY), true);
      e.preventDefault();
    });
    tower.addEventListener('pointermove', (e) => {
      if (dragging) this.setSp(cmAt(e.clientY), true);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.phone.classList.remove('dragging-sp');
      this.endDrag('setpoint');
    };
    tower.addEventListener('pointerup', end);
    tower.addEventListener('pointercancel', end);
  }

  /** Deslizador del PWM: solo se mueve agarrando el círculo (un toque en la pista no salta a 2000 µs) */
  private bindSliderDrag(): void {
    const slider = this.el.slider;
    let dragging = false;
    let grabOffset = 0;
    const usAt = (clientX: number) => {
      const s = this.state!;
      const r = slider.getBoundingClientRect();
      const f = clamp((clientX - grabOffset - r.left) / r.width, 0, 1);
      return s.pwmMin + f * (s.pwmMax - s.pwmMin);
    };
    slider.addEventListener('pointerdown', (e) => {
      const s = this.state;
      if (!s || !this.canControl) return;
      const r = slider.getBoundingClientRect();
      const thumbX = r.left + ((this.shownPwm - s.pwmMin) / (s.pwmMax - s.pwmMin)) * r.width;
      if (Math.abs(e.clientX - thumbX) > GRAB_PX) {
        this.toast('Arrastra el círculo naranja para mover el PWM.');
        return;
      }
      dragging = true;
      grabOffset = e.clientX - thumbX;
      slider.setPointerCapture(e.pointerId);
      this.phone.classList.add('dragging-pwm');
      this.sendRaw({ t: 'touch', field: 'pwm', on: true });
      e.preventDefault();
    });
    slider.addEventListener('pointermove', (e) => {
      if (dragging) this.setPwm(usAt(e.clientX), true);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.phone.classList.remove('dragging-pwm');
      this.endDrag('pwm');
    };
    slider.addEventListener('pointerup', end);
    slider.addEventListener('pointercancel', end);
  }

  // ── Valores mostrados (locales mientras se editan) ─────────────

  private active<T>(edit: Edit<T> | null): edit is Edit<T> {
    return edit !== null && (edit.dragging || performance.now() < edit.until);
  }

  private get shownSp(): number {
    return this.active(this.sp) ? this.sp.value : this.state?.sp ?? 0;
  }

  private get shownPwm(): number {
    return this.active(this.pwm) ? this.pwm.value : this.state?.pwm ?? 1000;
  }

  private get shownControl(): 'pid' | 'manual' {
    return this.active(this.control) ? this.control.value : this.state?.control ?? 'pid';
  }

  private get canControl(): boolean {
    return this.link === 'online' && this.hostOnline && this.controller && this.state?.mode !== 'reproduccion';
  }

  private setSp(cm: number, dragging: boolean): void {
    const s = this.state;
    if (!s) return;
    const v = round05(clamp(cm, s.spMin, s.spMax));
    // Pulso háptico cada 5 cm al arrastrar (solo Android)
    const tick5 = Math.floor(v / 5);
    if (dragging && !Number.isNaN(this.lastTick5) && tick5 !== this.lastTick5) vibrate(4);
    this.lastTick5 = tick5;
    this.sp = { value: v, dragging, until: performance.now() + HOLD_MS };
    if (dragging) this.throttledSend({ k: 'setpoint', cm: v });
    else this.command({ k: 'setpoint', cm: v });
    this.render();
  }

  private setPwm(us: number, dragging: boolean): void {
    const s = this.state;
    if (!s) return;
    const v = Math.round(clamp(us, s.pwmMin, s.pwmMax) / 5) * 5;
    this.pwm = { value: v, dragging, until: performance.now() + HOLD_MS };
    if (dragging) this.throttledSend({ k: 'pwm', us: v });
    else this.command({ k: 'pwm', us: v });
    this.render();
  }

  /** Mientras se arrastra: como mucho una orden cada 80 ms, siempre con el último valor */
  private throttledSend(cmd: RemoteCommand): void {
    this.pendingDrag = cmd;
    if (this.dragSendTimer !== null) return;
    const wait = Math.max(0, DRAG_SEND_MS - (performance.now() - this.dragLastSent));
    this.dragSendTimer = setTimeout(() => this.flushDrag(), wait);
  }

  private flushDrag(): void {
    if (this.dragSendTimer !== null) clearTimeout(this.dragSendTimer);
    this.dragSendTimer = null;
    if (!this.pendingDrag) return;
    this.dragLastSent = performance.now();
    this.command(this.pendingDrag);
    this.pendingDrag = null;
  }

  private endDrag(field: RemoteField): void {
    this.flushDrag();
    const edit = field === 'setpoint' ? this.sp : this.pwm;
    if (edit) {
      edit.dragging = false;
      edit.until = performance.now() + HOLD_MS;
    }
    this.lastTick5 = NaN;
    this.sendRaw({ t: 'touch', field, on: false });
    this.render();
  }

  // ── Red ────────────────────────────────────────────────────────

  private connect(): void {
    if (this.ws) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${REMOTE_PATH}?role=phone`);
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 500;
      this.hello();
    };
    ws.onmessage = (e) => this.onMessage(String(e.data));
    ws.onclose = () => {
      this.ws = null;
      this.pending.clear();
      if (this.link === 'pairing') return; // se reconecta al escribir el PIN
      this.link = 'reconnecting';
      this.render();
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    };
  }

  private hello(): void {
    this.link = 'connecting';
    this.sendRaw({ t: 'hello', pin: this.pin, name: deviceName() });
    this.render();
  }

  private sendRaw(msg: PhoneToBridge): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private command(cmd: RemoteCommand): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.toast('Sin conexión con el PC.', 'error');
      return;
    }
    const seq = this.seq++;
    this.pending.set(seq, performance.now());
    this.sendRaw({ t: 'cmd', seq, cmd });
  }

  private onMessage(data: string): void {
    const msg = parseMessage(data);
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        this.link = 'online';
        this.controller = msg.controller === true;
        this.hostOnline = msg.host === true;
        this.el.device.textContent = `${String(msg.name ?? deviceName())} · Monocóptero 1-GDL`;
        break;
      case 'denied':
        storage()?.removeItem('mando-pin');
        this.showPairing(String(msg.reason ?? 'PIN incorrecto.'));
        return;
      case 'role':
        this.controller = msg.controller === true;
        this.toast(this.controller ? '🎮 Tienes el mando.' : '👁 Otro teléfono tomó el mando.');
        vibrate(20);
        break;
      case 'host':
        // Otra pestaña o una recarga del PC empieza de cero (su número de versión también)
        this.hostOnline = msg.online === true;
        this.state = null;
        this.trend.length = 0;
        break;
      case 'state':
        this.applyState(msg.s as RemoteState);
        break;
      case 'ack': {
        const sent = this.pending.get(Number(msg.seq));
        this.pending.delete(Number(msg.seq));
        if (sent !== undefined) {
          const rtt = performance.now() - sent;
          this.rtt = this.rtt === null ? rtt : this.rtt * 0.7 + rtt * 0.3;
        }
        if (msg.ok !== true) {
          this.toast(String(msg.msg ?? 'No se pudo aplicar.'), 'error');
          // Volver a lo que dice el PC
          this.sp = this.pwm = null;
          this.control = null;
        }
        break;
      }
    }
    this.render();
  }

  private applyState(s: RemoteState): void {
    if (this.state && s.rev <= this.state.rev) return; // desordenado o repetido
    this.state = s;
    this.hostOnline = true;
    this.lastStateAt = performance.now();
    // El PC confirmó el valor que se estaba editando: vuelve a mandar el PC
    if (this.sp && !this.sp.dragging && Math.abs(s.sp - this.sp.value) < 0.05) this.sp = null;
    if (this.pwm && !this.pwm.dragging && Math.abs(s.pwm - this.pwm.value) < 0.5) this.pwm = null;
    if (this.control && s.control === this.control.value) this.control = null;

    // Tendencia: nueva muestra si avanzó el tiempo; si retrocede, se reinició
    const last = this.trend[this.trend.length - 1];
    if (s.y !== null) {
      if (last && s.t < last.t) this.trend.length = 0;
      if (!last || s.t > last.t) this.trend.push({ t: s.t, y: s.y, sp: s.sp });
      while (this.trend.length && this.trend[0].t < s.t - TREND_S) this.trend.shift();
    } else if (this.trend.length) {
      this.trend.length = 0;
    }
    this.drawTrend();
  }

  private showPairing(error: string): void {
    this.link = 'pairing';
    const pair = this.el.pair as HTMLFormElement;
    pair.hidden = false;
    this.el['pair-error'].textContent = error;
    const input = this.el['pin-input'] as HTMLInputElement;
    input.value = '';
    setTimeout(() => input.focus(), 50);
    this.render();
  }

  // ── Dibujo ─────────────────────────────────────────────────────

  private render(): void {
    const s = this.state;
    const phone = this.phone;
    const now = performance.now();
    const stale = s !== null && now - this.lastStateAt > STALE_MS;

    // Enlace
    const linkState = this.link !== 'online' ? this.link
      : !this.hostOnline ? 'nohost' : stale ? 'stale' : 'ok';
    phone.dataset.link = linkState;
    phone.dataset.role = this.controller ? 'controller' : 'viewer';
    this.el['link-text'].textContent = {
      connecting: 'Conectando…',
      pairing: 'Sin emparejar',
      reconnecting: 'Reconectando…',
      nohost: 'PC sin simulador',
      stale: 'Sin datos del PC',
      ok: `Enlazado${this.rtt !== null ? ` · ${Math.round(this.rtt)} ms` : ''}`,
    }[linkState];

    const overlay = this.el.overlay;
    const blocking = linkState === 'connecting' || linkState === 'reconnecting' || linkState === 'nohost';
    overlay.hidden = !blocking || this.link === 'pairing';
    if (blocking) {
      this.el['overlay-title'].textContent = linkState === 'nohost' ? 'Esperando al simulador' : 'Conectando con el PC…';
      this.el['overlay-text'].textContent = linkState === 'nohost'
        ? 'Abre el simulador en el navegador del PC. El mando se activa solo.'
        : 'Mantén el teléfono en la misma red WiFi que el PC.';
    }

    this.el.viewer.hidden = !(this.link === 'online' && !this.controller);
    if (!s) return;

    // Chips de modo y estado
    this.el.mode.textContent = MODE_LABELS[s.mode];
    const control = this.shownControl;
    const motorOn = (s.u ?? 1000) > 1010;
    const [stateText, stateKind] = s.failsafe ? ['FAILSAFE', 'danger']
      : !s.live ? [s.mode === 'simulacion' ? 'PAUSADO' : 'SIN PLACA', 'idle']
        : s.engaged ? ['AUTO', 'auto']
          : control === 'manual' && motorOn ? ['MANUAL', 'manual']
            : control === 'pid' ? ['LISTO', 'idle'] : ['DETENIDO', 'idle'];
    this.el.state.textContent = stateText;
    this.el.state.dataset.kind = stateKind;
    const run = this.root.querySelector<HTMLButtonElement>('[data-action="run"]')!;
    run.hidden = s.mode !== 'simulacion';
    run.textContent = s.running ? '⏸' : '▶';

    // Avisos
    const notice = s.mode === 'reproduccion' ? 'El PC está en Reproducción: el mando solo muestra los datos.'
      : s.pcHidden && s.mode === 'simulacion' ? 'La pestaña del simulador está oculta en el PC: el navegador la frena. Déjala a la vista.'
        : !s.live && s.mode !== 'simulacion' ? 'El PC no está conectado a la placa (🔌 Conectar en el simulador).'
          : '';
    this.el.notice.hidden = notice === '';
    this.el.notice.textContent = notice;
    phone.classList.toggle('readonly', s.mode === 'reproduccion');

    // Lecturas
    const sp = this.shownSp;
    this.el.y.textContent = s.y === null ? '—' : s.y.toFixed(1);
    this.el.sp.textContent = sp.toFixed(1);
    this.el.u.textContent = s.u === null ? '—' : String(s.u);
    this.el.y.parentElement!.classList.toggle('alarm', (s.y ?? 0) >= ALARM_CM);
    this.root.querySelectorAll<HTMLElement>('[data-pc]').forEach((b) => { b.hidden = s.pcEdit !== b.dataset.pc; });

    // Torre
    const rail = this.el.rail;
    rail.style.setProperty('--y', String(clamp((s.y ?? 0) / TOWER_CM, 0, 1)));
    rail.style.setProperty('--sp', String(clamp(sp / TOWER_CM, 0, 1)));
    rail.style.setProperty('--dead', String(s.spMin / TOWER_CM));
    this.el.carriage.classList.toggle('motor-on', motorOn);
    this.el.carriage.classList.toggle('no-data', s.y === null);
    this.el['sp-handle'].textContent = sp.toFixed(1);
    this.el['sp-marker'].classList.toggle('unused', control !== 'pid');
    this.el['sp-marker'].classList.toggle('local', this.active(this.sp));

    // Controles
    this.root.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((b) => {
      b.classList.toggle('active', b.dataset.control === control);
    });
    this.root.querySelectorAll<HTMLElement>('[data-only]').forEach((p) => { p.hidden = p.dataset.only !== control; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.preset) === sp);
    });
    const go = this.root.querySelector<HTMLButtonElement>('[data-action="go"]')!;
    go.hidden = s.engaged;
    go.textContent = `▲ Iniciar PID · ${sp.toFixed(1)} cm`;
    this.el.engaged.hidden = !s.engaged;
    this.el.gains.textContent = `Kp ${s.kp.toFixed(2)} · Ki ${s.ki.toFixed(2)} · Kd ${s.kd.toFixed(2)} · u₀ ${s.u0}`;

    // Secuencia P2
    const profBtn = this.root.querySelector<HTMLButtonElement>('[data-action="profile"]')!;
    profBtn.textContent = s.profile ? '✕ Cancelar secuencia P2' : '▶ Secuencia P2 · 20→40→30→50';
    profBtn.classList.toggle('active', s.profile !== null);
    const track = this.el['profile-track'];
    track.hidden = s.profile === null;
    if (s.profile) {
      const p = s.profile;
      track.querySelectorAll<HTMLElement>('[data-seg]').forEach((seg) => {
        const i = Number(seg.dataset.seg);
        const fill = i < p.index ? 1 : i > p.index ? 0 : Math.min(1, p.elapsed / p.segment);
        seg.style.setProperty('--fill', String(fill));
        seg.classList.toggle('current', i === p.index);
        seg.querySelector('b')!.textContent = String(p.steps[i] ?? '');
      });
    }

    // PWM manual
    const pwm = this.shownPwm;
    this.el.pwm.textContent = String(pwm);
    const span = s.pwmMax - s.pwmMin;
    this.el.slider.style.setProperty('--pos', String((pwm - s.pwmMin) / span));
    this.el['u0-mark'].style.setProperty('--at', String((s.u0 - s.pwmMin) / span));

    (this.root.querySelector('[data-action="rearm"]') as HTMLElement).hidden = !s.failsafe;
  }

  /** Tendencia de 30 s: altura (azul) y setpoint (ámbar discontinuo) */
  private drawTrend(): void {
    const canvas = this.el.trend as HTMLCanvasElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pts = this.trend;
    if (pts.length < 2) {
      ctx.fillStyle = '#8a8fa3';
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Tendencia de 30 s', w / 2, h / 2 + 4);
      return;
    }
    const tEnd = pts[pts.length - 1].t;
    const tStart = tEnd - TREND_S;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p.y, p.sp);
      hi = Math.max(hi, p.y, p.sp);
    }
    const pad = Math.max(3, (hi - lo) * 0.15);
    lo = Math.max(0, lo - pad);
    hi = Math.min(TOWER_CM, hi + pad);
    const x = (t: number) => ((t - tStart) / TREND_S) * w;
    const y = (v: number) => h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8);

    // Rejilla cada 10 cm
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let g = Math.ceil(lo / 10) * 10; g <= hi; g += 10) {
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y(g)) + 0.5);
      ctx.lineTo(w, Math.round(y(g)) + 0.5);
      ctx.stroke();
    }

    // Altura con relleno degradado
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(79,140,255,0.28)');
    grad.addColorStop(1, 'rgba(79,140,255,0)');
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.y)) : ctx.moveTo(x(p.t), y(p.y))));
    ctx.lineTo(x(tEnd), h);
    ctx.lineTo(x(pts[0].t), h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.y)) : ctx.moveTo(x(p.t), y(p.y))));
    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Setpoint
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.sp)) : ctx.moveTo(x(p.t), y(p.sp))));
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private toast(text: string, level: 'info' | 'error' = 'info'): void {
    const box = this.el.toasts;
    const t = document.createElement('div');
    t.className = `ph-toast ${level}`;
    t.textContent = text;
    box.append(t);
    while (box.children.length > 2) box.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2600);
  }
}

new PhoneApp(document.getElementById('app')!);
