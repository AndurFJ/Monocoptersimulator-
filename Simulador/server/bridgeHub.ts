/**
 * bridgeHub.ts — lógica del puente del control remoto (sin red: se prueba con tests).
 *
 * Reenvía mensajes entre la página del PC (host, una sola) y los teléfonos:
 *  - Los teléfonos entran con el PIN que muestra la página. Tras 5 PIN errados
 *    desde una misma IP, esa IP espera 60 s.
 *  - Un solo teléfono tiene el mando; los demás son «solo ver» hasta que pulsen
 *    «Tomar el mando». La parada (stop) pasa siempre, la mande quien la mande.
 *  - Guarda la última instantánea del PC para que un teléfono que entra la vea al instante.
 * El puente no interpreta el estado: la página del PC es la única que decide.
 */

import { parseCommand, parseMessage, isField } from '../src/remote/protocol.ts';
import type { BridgeToHost, BridgeToPhone, PhoneInfo, RemoteState } from '../src/remote/protocol.ts';

/** Conexión abstracta (un WebSocket en el servidor, un objeto falso en los tests) */
export interface Peer {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Conn {
  message(data: string): void;
  close(): void;
}

export interface BridgeHubOptions {
  pin?: string;
  /** Direcciones para abrir la página del teléfono (se piden al conectar el PC) */
  urls: () => string[];
  /** false si el servidor solo escucha en localhost (el teléfono no llega) */
  exposed: () => boolean;
  now?: () => number;
}

interface Phone {
  peer: Peer;
  id: string;
  name: string;
  ip: string;
  authed: boolean;
}

const MAX_MESSAGE = 4096;
const MAX_PIN_FAILS = 5;
const PIN_LOCK_MS = 60_000;

export function randomPin(random: () => number = Math.random): string {
  return String(Math.floor(random() * 10000)).padStart(4, '0');
}

export class BridgeHub {
  readonly pin: string;
  private readonly opts: BridgeHubOptions;
  private readonly now: () => number;
  private host: Peer | null = null;
  private lastState: RemoteState | null = null;
  /** Orden de entrada = prioridad para heredar el mando */
  private readonly phones = new Map<Peer, Phone>();
  private controllerId: string | null = null;
  private nextId = 1;
  private readonly fails = new Map<string, { count: number; until: number }>();

  constructor(opts: BridgeHubOptions) {
    this.opts = opts;
    this.pin = opts.pin ?? randomPin();
    this.now = opts.now ?? Date.now;
  }

  // ── Página del PC ──────────────────────────────────────────────

  connectHost(peer: Peer): Conn {
    if (this.host) {
      // Otra pestaña toma el relevo: la anterior deja de mandar
      send(this.host, { t: 'replaced' });
      this.host.close(4000, 'replaced');
    }
    this.host = peer;
    this.lastState = null;
    send(peer, { t: 'welcome', pin: this.pin, urls: this.opts.urls(), exposed: this.opts.exposed() });
    this.sendPhoneList();
    this.broadcast({ t: 'host', online: true });

    return {
      message: (data) => this.hostMessage(peer, data),
      close: () => {
        if (this.host !== peer) return;
        this.host = null;
        this.lastState = null;
        this.broadcast({ t: 'host', online: false });
      },
    };
  }

  private hostMessage(peer: Peer, data: string): void {
    if (peer !== this.host || data.length > 64 * 1024) return;
    const msg = parseMessage(data);
    if (!msg) return;
    if (msg.t === 'state' && typeof msg.s === 'object' && msg.s !== null) {
      this.lastState = msg.s as RemoteState;
      this.broadcast({ t: 'state', s: this.lastState });
    } else if (msg.t === 'ack' && typeof msg.to === 'string' && typeof msg.seq === 'number') {
      const phone = this.phoneById(msg.to);
      if (phone) {
        send(phone.peer, {
          t: 'ack', seq: msg.seq, ok: msg.ok === true,
          ...(typeof msg.msg === 'string' ? { msg: msg.msg } : {}),
        });
      }
    }
  }

  // ── Teléfonos ──────────────────────────────────────────────────

  connectPhone(peer: Peer, ip: string): Conn {
    this.phones.set(peer, { peer, id: `p${this.nextId++}`, name: 'Teléfono', ip, authed: false });
    return {
      message: (data) => this.phoneMessage(peer, data),
      close: () => this.removePhone(peer),
    };
  }

  private phoneMessage(peer: Peer, data: string): void {
    const phone = this.phones.get(peer);
    if (!phone || data.length > MAX_MESSAGE) return;
    const msg = parseMessage(data);
    if (!msg) return;

    if (!phone.authed) {
      if (msg.t === 'hello') this.hello(phone, String(msg.pin ?? ''), String(msg.name ?? ''));
      return;
    }

    const isController = phone.id === this.controllerId;
    switch (msg.t) {
      case 'cmd': {
        const seq = typeof msg.seq === 'number' ? msg.seq : -1;
        const cmd = parseCommand(msg.cmd);
        const nack = (text: string) => send(peer, { t: 'ack', seq, ok: false, msg: text });
        if (!cmd) return nack('Comando no válido.');
        if (!isController && cmd.k !== 'stop') return nack('Solo ver: toca «Tomar el mando».');
        if (!this.host) return nack('El PC no está conectado.');
        send(this.host, { t: 'cmd', from: phone.id, name: phone.name, seq, cmd });
        return;
      }
      case 'touch':
        if (isController && this.host && isField(msg.field)) {
          send(this.host, { t: 'touch', from: phone.id, name: phone.name, field: msg.field, on: msg.on === true });
        }
        return;
      case 'take':
        if (!isController) this.setController(phone.id);
        return;
    }
  }

  private hello(phone: Phone, pin: string, name: string): void {
    const lock = this.fails.get(phone.ip);
    if (lock && lock.until > this.now()) {
      send(phone.peer, { t: 'denied', reason: 'Demasiados intentos. Espera un minuto.' });
      return;
    }
    if (pin !== this.pin) {
      // Un bloqueo ya cumplido vuelve a empezar la cuenta
      const lockServed = lock !== undefined && lock.until > 0;
      const count = (lock && !lockServed ? lock.count : 0) + 1;
      this.fails.set(phone.ip, { count, until: count >= MAX_PIN_FAILS ? this.now() + PIN_LOCK_MS : 0 });
      send(phone.peer, { t: 'denied', reason: 'PIN incorrecto.' });
      return;
    }
    this.fails.delete(phone.ip);
    phone.authed = true;
    phone.name = this.uniqueName(name.trim().slice(0, 24) || 'Teléfono', phone);
    if (this.controllerId === null) this.controllerId = phone.id;
    send(phone.peer, {
      t: 'welcome', id: phone.id, name: phone.name,
      controller: this.controllerId === phone.id, host: this.host !== null,
    });
    if (this.lastState) send(phone.peer, { t: 'state', s: this.lastState });
    this.sendPhoneList();
  }

  private removePhone(peer: Peer): void {
    const phone = this.phones.get(peer);
    if (!phone) return;
    this.phones.delete(peer);
    if (!phone.authed) return;
    if (phone.id === this.controllerId) {
      // El mando pasa al teléfono que lleva más tiempo conectado
      const heir = [...this.phones.values()].find((p) => p.authed);
      this.controllerId = null;
      if (heir) this.setController(heir.id);
    }
    this.sendPhoneList();
  }

  private setController(id: string): void {
    const previous = this.controllerId;
    this.controllerId = id;
    for (const p of this.phones.values()) {
      if (!p.authed) continue;
      if (p.id === id || p.id === previous) send(p.peer, { t: 'role', controller: p.id === id });
    }
    this.sendPhoneList();
  }

  // ── Utilidades ─────────────────────────────────────────────────

  /** Teléfonos con PIN correcto, en orden de llegada */
  get phoneList(): PhoneInfo[] {
    return [...this.phones.values()]
      .filter((p) => p.authed)
      .map((p) => ({ id: p.id, name: p.name, controller: p.id === this.controllerId }));
  }

  private sendPhoneList(): void {
    if (this.host) send(this.host, { t: 'phones', list: this.phoneList });
  }

  private broadcast(msg: BridgeToPhone): void {
    const data = JSON.stringify(msg);
    for (const p of this.phones.values()) if (p.authed) p.peer.send(data);
  }

  private phoneById(id: string): Phone | undefined {
    for (const p of this.phones.values()) if (p.id === id && p.authed) return p;
    return undefined;
  }

  private uniqueName(base: string, self: Phone): string {
    const taken = new Set([...this.phones.values()].filter((p) => p.authed && p !== self).map((p) => p.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }
}

function send(peer: Peer, msg: BridgeToHost | BridgeToPhone): void {
  peer.send(JSON.stringify(msg));
}
