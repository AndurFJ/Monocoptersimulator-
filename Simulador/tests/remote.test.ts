/**
 * remote.test.ts — control remoto desde el teléfono: protocolo, puente y secuencia P2.
 */

import { describe, it, expect } from 'vitest';
import { BridgeHub } from '../server/bridgeHub';
import type { Peer } from '../server/bridgeHub';
import { parseCommand } from '../src/remote/protocol';
import { SetpointProfile } from '../src/core/SetpointProfile';

/** Conexión de mentira que guarda lo recibido */
class FakePeer implements Peer {
  inbox: Record<string, unknown>[] = [];
  closed = false;
  send(data: string): void { this.inbox.push(JSON.parse(data)); }
  close(): void { this.closed = true; }
  last(t: string) { return [...this.inbox].reverse().find((m) => m.t === t); }
  all(t: string) { return this.inbox.filter((m) => m.t === t); }
}

function setup() {
  let now = 0;
  const hub = new BridgeHub({ pin: '1234', urls: () => ['http://192.168.1.5:5173/control.html?pin=1234'], exposed: () => true, now: () => now });
  const hostPeer = new FakePeer();
  const host = hub.connectHost(hostPeer);
  const phone = (ip = '192.168.1.20') => {
    const peer = new FakePeer();
    const conn = hub.connectPhone(peer, ip);
    const say = (msg: object) => conn.message(JSON.stringify(msg));
    return { peer, conn, say };
  };
  return { hub, hostPeer, host, phone, advance: (ms: number) => { now += ms; } };
}

describe('parseCommand', () => {
  it('acepta los comandos bien formados', () => {
    expect(parseCommand({ k: 'setpoint', cm: 35 })).toEqual({ k: 'setpoint', cm: 35 });
    expect(parseCommand({ k: 'control', mode: 'manual' })).toEqual({ k: 'control', mode: 'manual' });
    expect(parseCommand({ k: 'stop' })).toEqual({ k: 'stop' });
    expect(parseCommand({ k: 'profile', on: true })).toEqual({ k: 'profile', on: true });
  });

  it('rechaza valores no numéricos o desconocidos', () => {
    expect(parseCommand({ k: 'setpoint', cm: 'NaN' })).toBeNull();
    expect(parseCommand({ k: 'setpoint', cm: Infinity })).toBeNull();
    expect(parseCommand({ k: 'pwm' })).toBeNull();
    expect(parseCommand({ k: 'control', mode: 'auto' })).toBeNull();
    expect(parseCommand({ k: 'borrar' })).toBeNull();
    expect(parseCommand(null)).toBeNull();
  });
});

describe('BridgeHub', () => {
  it('el PC recibe el PIN y las direcciones al conectarse', () => {
    const { hostPeer } = setup();
    expect(hostPeer.last('welcome')).toMatchObject({ pin: '1234', exposed: true });
  });

  it('un PIN errado no entra; tras 5 intentos la IP espera un minuto', () => {
    const { phone, advance } = setup();
    const p = phone();
    for (let i = 0; i < 5; i++) p.say({ t: 'hello', pin: '0000', name: 'iPhone' });
    expect(p.peer.all('denied')).toHaveLength(5);
    p.say({ t: 'hello', pin: '1234', name: 'iPhone' });
    expect(p.peer.last('denied')).toMatchObject({ reason: expect.stringContaining('minuto') });
    advance(61_000);
    p.say({ t: 'hello', pin: '1234', name: 'iPhone' });
    expect(p.peer.last('welcome')).toMatchObject({ controller: true });
  });

  it('sin PIN no se reenvía nada al PC', () => {
    const { phone, hostPeer } = setup();
    const p = phone();
    p.say({ t: 'cmd', seq: 1, cmd: { k: 'stop' } });
    expect(hostPeer.all('cmd')).toHaveLength(0);
  });

  it('el primer teléfono tiene el mando y recibe la última instantánea', () => {
    const { phone, host, hostPeer } = setup();
    host.message(JSON.stringify({ t: 'state', s: { rev: 7, sp: 30 } }));
    const p = phone();
    p.say({ t: 'hello', pin: '1234', name: 'iPhone' });
    expect(p.peer.last('welcome')).toMatchObject({ controller: true, host: true, name: 'iPhone' });
    expect(p.peer.last('state')).toMatchObject({ s: { rev: 7 } });
    expect(hostPeer.last('phones')).toMatchObject({ list: [{ name: 'iPhone', controller: true }] });
  });

  it('reenvía las órdenes del mando al PC y la confirmación al teléfono', () => {
    const { phone, host, hostPeer } = setup();
    const p = phone();
    p.say({ t: 'hello', pin: '1234', name: 'iPhone' });
    p.say({ t: 'cmd', seq: 3, cmd: { k: 'setpoint', cm: 35 } });
    const cmd = hostPeer.last('cmd') as { from: string; seq: number };
    expect(cmd).toMatchObject({ seq: 3, name: 'iPhone', cmd: { k: 'setpoint', cm: 35 } });
    host.message(JSON.stringify({ t: 'ack', to: cmd.from, seq: 3, ok: true }));
    expect(p.peer.last('ack')).toEqual({ t: 'ack', seq: 3, ok: true });
  });

  it('un segundo teléfono solo ve, salvo la parada; con «tomar el mando» pasa a mandar', () => {
    const { phone, hostPeer } = setup();
    const a = phone();
    a.say({ t: 'hello', pin: '1234', name: 'Android' });
    const b = phone('192.168.1.21');
    b.say({ t: 'hello', pin: '1234', name: 'Android' });
    expect(b.peer.last('welcome')).toMatchObject({ controller: false, name: 'Android 2' });

    b.say({ t: 'cmd', seq: 1, cmd: { k: 'setpoint', cm: 60 } });
    expect(b.peer.last('ack')).toMatchObject({ ok: false });
    expect(hostPeer.all('cmd')).toHaveLength(0);

    b.say({ t: 'cmd', seq: 2, cmd: { k: 'stop' } });
    expect(hostPeer.last('cmd')).toMatchObject({ cmd: { k: 'stop' } });

    b.say({ t: 'take' });
    expect(b.peer.last('role')).toEqual({ t: 'role', controller: true });
    expect(a.peer.last('role')).toEqual({ t: 'role', controller: false });
    b.say({ t: 'cmd', seq: 3, cmd: { k: 'setpoint', cm: 40 } });
    expect(hostPeer.last('cmd')).toMatchObject({ cmd: { k: 'setpoint', cm: 40 } });
  });

  it('si el mando se va, lo hereda el teléfono que llegó antes', () => {
    const { phone, hostPeer } = setup();
    const a = phone();
    a.say({ t: 'hello', pin: '1234', name: 'A' });
    const b = phone();
    b.say({ t: 'hello', pin: '1234', name: 'B' });
    a.conn.close();
    expect(b.peer.last('role')).toEqual({ t: 'role', controller: true });
    expect(hostPeer.last('phones')).toMatchObject({ list: [{ name: 'B', controller: true }] });
  });

  it('avisa a los teléfonos cuando el PC se va, y rechaza órdenes sin PC', () => {
    const { phone, host } = setup();
    const p = phone();
    p.say({ t: 'hello', pin: '1234', name: 'iPhone' });
    host.close();
    expect(p.peer.last('host')).toEqual({ t: 'host', online: false });
    p.say({ t: 'cmd', seq: 9, cmd: { k: 'go', cm: 30 } });
    expect(p.peer.last('ack')).toMatchObject({ seq: 9, ok: false });
  });

  it('una pestaña nueva del PC reemplaza a la anterior', () => {
    const { hub, hostPeer } = setup();
    const second = new FakePeer();
    hub.connectHost(second);
    expect(hostPeer.last('replaced')).toBeTruthy();
    expect(hostPeer.closed).toBe(true);
    expect(second.last('welcome')).toBeTruthy();
  });

  it('el aviso de dedo apoyado solo llega del teléfono con el mando', () => {
    const { phone, hostPeer } = setup();
    const a = phone();
    a.say({ t: 'hello', pin: '1234', name: 'A' });
    const b = phone();
    b.say({ t: 'hello', pin: '1234', name: 'B' });
    b.say({ t: 'touch', field: 'setpoint', on: true });
    expect(hostPeer.all('touch')).toHaveLength(0);
    a.say({ t: 'touch', field: 'setpoint', on: true });
    expect(hostPeer.last('touch')).toMatchObject({ field: 'setpoint', on: true, name: 'A' });
  });
});

describe('SetpointProfile (P2)', () => {
  it('recorre 20 → 40 → 30 → 50 cm cada 12 s con el tiempo de la telemetría', () => {
    const p = new SetpointProfile();
    expect(p.start()).toBe(20);
    const changes: (number | string)[] = [];
    for (let t = 100; t <= 150; t += 0.05) {
      const r = p.push(Math.round(t * 100) / 100);
      if (r !== null) changes.push(r);
    }
    expect(changes).toEqual([40, 30, 50, 'done']); // el 20 lo devuelve start()
    expect(p.active).toBe(false);
  });

  it('si el tiempo no avanza (simulación pausada), la secuencia espera', () => {
    const p = new SetpointProfile();
    p.start();
    p.push(5);
    for (let i = 0; i < 100; i++) p.push(5);
    expect(p.view()).toMatchObject({ index: 0, elapsed: 0 });
    expect(p.push(17.01)).toBe(40);
  });

  it('cancelar la deja inactiva', () => {
    const p = new SetpointProfile();
    p.start();
    p.cancel();
    expect(p.push(100)).toBeNull();
    expect(p.view()).toBeNull();
    expect(p.current).toBeNull();
  });
});
