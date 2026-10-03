/**
 * RemoteHost — lado de la página del PC del control remoto.
 *
 * Recibe las intenciones del teléfono y las aplica con los MISMOS setters de
 * AppState que usa el panel lateral (mismos límites, mismo envío a la placa y
 * misma lógica anti-eco de main.ts). Publica una instantánea del estado a 10 Hz
 * como máximo, y un latido cada 500 ms aunque nada cambie.
 */

import type { AppState } from '../core/AppState';
import type { TelemetrySample } from '../data/types';
import {
  PWM_MIN, PWM_MAX, SETPOINT_MIN_M, SETPOINT_MAX_M,
} from '../physics/constants';
import {
  REMOTE_PATH, STATE_INTERVAL_MS, HEARTBEAT_MS, parseCommand, parseMessage, isField,
} from './protocol';
import type {
  HostToBridge, PhoneInfo, ProfileView, RemoteCommand, RemoteField, RemoteState,
} from './protocol';

/** Lo que solo main.ts sabe (conexión con la placa, failsafe, secuencia) */
export interface RemoteHostInfo {
  live: boolean;
  engaged: boolean;
  failsafe: boolean;
  profile: ProfileView | null;
}

/** Acciones que no son un simple setter de AppState */
export interface RemoteHostActions {
  stop(who: string): void;
  rearm(): void;
  /** Iniciar/cancelar la secuencia P2; devuelve un mensaje si no se puede */
  profile(on: boolean): string | null;
}

/** Estado del puente para la tarjeta del panel */
export interface BridgeView {
  /** 'off' = no hay puente (p.ej. la página la sirve la ESP32) */
  status: 'connecting' | 'online' | 'off' | 'replaced';
  pin: string;
  urls: string[];
  exposed: boolean;
  phones: PhoneInfo[];
}

/** Qué está tocando el teléfono (para resaltarlo en la página) */
export interface RemoteActivity {
  field: RemoteField;
  /** Nombre del teléfono */
  who: string;
  /** Texto corto para el HUD: «ajustando el setpoint → 35.0 cm» */
  text: string;
  /** true mientras el dedo sigue apoyado */
  holding: boolean;
}

/** Tras levantar el dedo, el resaltado se apaga a los… [ms] */
const RELEASE_MS = 1500;
/** Un cambio hecho en el PC se avisa en el teléfono durante… [ms] */
const PC_EDIT_MS = 1500;

const cm = (m: number) => Math.round(m * 1000) / 10;

export class RemoteHost {
  private readonly state: AppState;
  private readonly info: () => RemoteHostInfo;
  private readonly actions: RemoteHostActions;

  private ws: WebSocket | null = null;
  private retryMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Intentos fallidos sin haber conectado nunca (p.ej. página servida por la ESP32) */
  private failedAttempts = 0;
  private everOpened = false;
  private view: BridgeView = { status: 'connecting', pin: '', urls: [], exposed: false, phones: [] };
  private viewCb: ((v: BridgeView) => void) | null = null;
  private activityCb: ((a: RemoteActivity | null) => void) | null = null;

  private rev = 0;
  private lastSample: TelemetrySample | null = null;
  private lastFlush = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** true mientras se aplica una orden del teléfono (para no confundirla con el PC) */
  private applying = false;
  private pcEdit: { field: RemoteField; at: number } | null = null;
  private last = { sp: NaN, control: '', pwm: NaN };

  private activity: RemoteActivity | null = null;
  private holding = new Set<RemoteField>();
  private activityTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(state: AppState, info: () => RemoteHostInfo, actions: RemoteHostActions) {
    this.state = state;
    this.info = info;
    this.actions = actions;
    this.last = { sp: state.setpoint, control: state.controlMode, pwm: state.manualPwm };

    const changed = (field: RemoteField) => () => {
      this.trackPcEdit(field);
      this.schedule();
    };
    const bus = state.bus;
    bus.on('setpoint-change', changed('setpoint'));
    bus.on('control-mode-change', changed('control'));
    bus.on('manual-pwm-change', changed('pwm'));
    for (const ev of ['pid-change', 'feedforward-change', 'mode-change', 'running-change'] as const) {
      bus.on(ev, () => this.schedule());
    }
    bus.on('telemetry', (s) => {
      this.lastSample = s;
      this.schedule();
    });
    document.addEventListener('visibilitychange', () => this.schedule());
    setInterval(() => this.schedule(), HEARTBEAT_MS);
  }

  onBridge(cb: (v: BridgeView) => void): void {
    this.viewCb = cb;
    cb(this.view);
  }

  onActivity(cb: (a: RemoteActivity | null) => void): void {
    this.activityCb = cb;
  }

  /** Avisar de un cambio que no pasa por AppState (failsafe, secuencia, conexión) */
  notify(): void {
    this.schedule();
  }

  // ── Conexión con el puente ─────────────────────────────────────

  connect(): void {
    if (this.ws) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}${REMOTE_PATH}?role=host`);
    } catch {
      this.setView({ status: 'off' });
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.everOpened = true;
      this.retryMs = 1000;
    };
    ws.onmessage = (e) => this.onMessage(String(e.data));
    ws.onclose = () => {
      this.ws = null;
      if (this.view.status === 'replaced') return;
      // Sin puente (página servida por la ESP32 o un servidor sin el plugin): reintento lento,
      // y si nunca hubo puente, se deja de intentar tras 3 fallos
      this.setView({ status: opened ? 'connecting' : 'off', phones: [] });
      this.clearActivity();
      if (!this.everOpened && ++this.failedAttempts >= 3) return;
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10_000);
    };
  }

  /** Volver a tomar el control remoto si otra pestaña lo tenía */
  reclaim(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.view.status = 'connecting';
    this.connect();
  }

  private onMessage(data: string): void {
    const msg = parseMessage(data);
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        this.setView({
          status: 'online',
          pin: String(msg.pin ?? ''),
          urls: Array.isArray(msg.urls) ? msg.urls.map(String) : [],
          exposed: msg.exposed === true,
        });
        this.flush();
        break;
      case 'replaced':
        this.setView({ status: 'replaced', phones: [] });
        break;
      case 'phones':
        this.setView({ phones: Array.isArray(msg.list) ? (msg.list as PhoneInfo[]) : [] });
        break;
      case 'cmd': {
        const from = String(msg.from ?? '');
        const who = String(msg.name ?? 'Teléfono');
        const seq = typeof msg.seq === 'number' ? msg.seq : -1;
        const cmd = parseCommand(msg.cmd);
        const result = cmd ? this.apply(cmd, who) : 'Comando no válido.';
        this.send({ t: 'ack', to: from, seq, ok: result === null, ...(result ? { msg: result } : {}) });
        this.flush();
        break;
      }
      case 'touch':
        if (isField(msg.field)) this.touch(msg.field, msg.on === true, String(msg.name ?? 'Teléfono'));
        break;
    }
  }

  private send(msg: HostToBridge): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setView(patch: Partial<BridgeView>): void {
    this.view = { ...this.view, ...patch };
    this.viewCb?.(this.view);
  }

  // ── Órdenes del teléfono ───────────────────────────────────────

  /** Aplicar una orden; devuelve null si se aplicó o el motivo si no */
  private apply(cmd: RemoteCommand, who: string): string | null {
    const st = this.state;
    if (st.mode === 'reproduccion' && cmd.k !== 'stop') {
      return 'En Reproducción no hay nada que controlar.';
    }
    this.applying = true;
    try {
      switch (cmd.k) {
        case 'setpoint':
          st.setSetpoint(cmd.cm / 100);
          this.show('setpoint', who, `ajustando el setpoint → ${cm(st.setpoint).toFixed(1)} cm`);
          return null;
        case 'go':
          st.setSetpoint(cmd.cm / 100);
          st.requestPidGo();
          this.show('setpoint', who, `PID → ${cm(st.setpoint).toFixed(1)} cm`);
          return null;
        case 'control':
          st.setControlMode(cmd.mode);
          this.show('control', who, cmd.mode === 'pid' ? 'cambió a AUTO (PID)' : 'cambió a MANUAL');
          return null;
        case 'pwm':
          if (st.controlMode !== 'manual') st.setControlMode('manual');
          st.setManualPwm(Math.round(cmd.us));
          this.show('pwm', who, `PWM manual → ${Math.round(st.manualPwm)} µs`);
          return null;
        case 'stop':
          this.actions.stop(who);
          this.show('stop', who, '⏻ PARADA');
          return null;
        case 'rearm':
          this.actions.rearm();
          this.show('rearm', who, 'rearmó tras la parada');
          return null;
        case 'run':
          if (st.mode !== 'simulacion') return 'Iniciar/pausar solo existe en Simulación.';
          st.setRunning(cmd.on);
          this.show('run', who, cmd.on ? '▶ inició la simulación' : '⏸ pausó la simulación');
          return null;
        case 'profile': {
          const err = this.actions.profile(cmd.on);
          if (!err) this.show('profile', who, cmd.on ? '▶ secuencia P2' : 'canceló la secuencia P2');
          return err;
        }
      }
    } finally {
      this.applying = false;
    }
  }

  // ── Resaltado en la página ─────────────────────────────────────

  private touch(field: RemoteField, on: boolean, who: string): void {
    if (on) {
      this.holding.add(field);
      if (this.activity?.field !== field) {
        this.show(field, who, field === 'setpoint' ? 'ajustando el setpoint' : field === 'pwm' ? 'ajustando el PWM' : 'tocando');
      }
    } else {
      this.holding.delete(field);
    }
    if (this.activity?.field === field) this.show(field, who, this.activity.text);
  }

  private show(field: RemoteField, who: string, text: string): void {
    this.activity = { field, who, text, holding: this.holding.has(field) };
    this.activityCb?.(this.activity);
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = null;
    if (!this.activity.holding) this.activityTimer = setTimeout(() => this.clearActivity(), RELEASE_MS);
  }

  private clearActivity(): void {
    this.holding.clear();
    if (!this.activity) return;
    this.activity = null;
    this.activityCb?.(null);
  }

  // ── Instantánea ────────────────────────────────────────────────

  /** Registrar qué cambió el PC (el teléfono lo avisa); solo si el valor cambió de verdad */
  private trackPcEdit(field: RemoteField): void {
    const st = this.state;
    const now = { sp: st.setpoint, control: st.controlMode as string, pwm: st.manualPwm };
    const differs = field === 'setpoint' ? now.sp !== this.last.sp
      : field === 'control' ? now.control !== this.last.control
        : now.pwm !== this.last.pwm;
    this.last = now;
    if (differs && !this.applying && !this.info().profile) this.pcEdit = { field, at: performance.now() };
  }

  private schedule(): void {
    if (this.flushTimer !== null) return;
    const wait = STATE_INTERVAL_MS - (performance.now() - this.lastFlush);
    // Ya pasó el intervalo: publicar ahora. Con la pestaña oculta el navegador
    // frena los temporizadores a 1 Hz, pero no los mensajes de la placa.
    if (wait <= 0) this.flush();
    else this.flushTimer = setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.lastFlush = performance.now();
    if (this.ws?.readyState !== WebSocket.OPEN || this.view.status !== 'online') return;
    this.send({ t: 'state', s: this.snapshot() });
  }

  snapshot(): RemoteState {
    const st = this.state;
    const info = this.info();
    const s = this.lastSample;
    const pcEdit = this.pcEdit && performance.now() - this.pcEdit.at < PC_EDIT_MS ? this.pcEdit.field : null;
    return {
      rev: ++this.rev,
      mode: st.mode,
      running: st.running,
      live: info.live,
      engaged: info.engaged,
      control: st.controlMode,
      sp: cm(st.setpoint),
      spMin: cm(SETPOINT_MIN_M),
      spMax: cm(SETPOINT_MAX_M),
      y: s ? cm(s.height) : null,
      u: s ? Math.round(s.pwm) : null,
      t: s ? s.t : 0,
      pwm: Math.round(st.manualPwm),
      pwmMin: PWM_MIN,
      pwmMax: PWM_MAX,
      u0: st.feedforward,
      kp: st.kp,
      ki: st.ki,
      kd: st.kd,
      failsafe: info.failsafe,
      profile: info.profile,
      pcEdit,
      pcHidden: document.hidden,
    };
  }
}

