/**
 * remoteBridge.ts — plugin de Vite: puente WebSocket del control remoto en /remote.
 *
 * Funciona con `npm run dev`, `npm run remoto` (dev accesible desde la red) y
 * `npm run preview`. El teléfono abre http://<IP del PC>:<puerto>/control.html.
 * Solo la página abierta en este mismo PC puede ser el host (la que manda);
 * los teléfonos entran con el PIN que ella muestra.
 */

import os from 'node:os';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { BridgeHub } from './bridgeHub.ts';
import type { Conn } from './bridgeHub.ts';
import { REMOTE_PATH, PHONE_PAGE } from '../src/remote/protocol.ts';

/** Latido del servidor: corta conexiones muertas (teléfono bloqueado, WiFi caído) */
const PING_MS = 5000;

/** IPv4 de la red local, primero el WiFi y luego el resto (sin adaptadores virtuales) */
function lanAddresses(): string[] {
  const found: { ip: string; score: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const n = name.toLowerCase();
      if (/vethernet|wsl|virtualbox|vmware|hyper-v|docker|loopback/.test(n)) continue;
      const score = /wi-?fi|wlan|wireless/.test(n) ? 0 : /ethernet|eth|en\d/.test(n) ? 1 : 2;
      found.push({ ip: a.address, score });
    }
  }
  return found.sort((a, b) => a.score - b.score).map((f) => f.ip);
}

/** Direcciones de este PC (para aceptar como host solo a la página abierta aquí) */
function ownAddresses(): Set<string> {
  const set = new Set(['127.0.0.1', '::1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) set.add(a.address);
  }
  return set;
}

const normalizeIp = (ip: string | undefined) => (ip ?? '').replace(/^::ffff:/, '');

function attach(server: ViteDevServer | PreviewServer, isPreview: boolean): void {
  const httpServer = server.httpServer as Server | null;
  if (!httpServer) return;

  const hostOption = () => (isPreview ? server.config.preview.host : server.config.server.host);
  const port = () => {
    const addr = httpServer.address();
    return typeof addr === 'object' && addr ? addr.port : 5173;
  };
  const exposed = () => {
    const h = hostOption();
    return h === true || (typeof h === 'string' && h !== 'localhost' && h !== '127.0.0.1');
  };
  const urls = (): string[] => lanAddresses().map((ip) => `http://${ip}:${port()}/${PHONE_PAGE}?pin=${hub.pin}`);
  const hub = new BridgeHub({ exposed, urls });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== REMOTE_PATH) return; // el resto (HMR de Vite) no es nuestro
    const role = url.searchParams.get('role');
    const ip = normalizeIp(req.socket.remoteAddress);
    if (role === 'host' && !ownAddresses().has(ip)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    if (role !== 'host' && role !== 'phone') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const peer = {
        send: (data: string) => { if (ws.readyState === ws.OPEN) ws.send(data); },
        close: (code?: number, reason?: string) => ws.close(code, reason),
      };
      const conn: Conn = role === 'host' ? hub.connectHost(peer) : hub.connectPhone(peer, ip);
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      ws.on('message', (data) => conn.message(data.toString()));
      ws.on('close', () => conn.close());
      ws.on('error', () => ws.terminate());
    });
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, PING_MS);
  httpServer.on('close', () => {
    clearInterval(ping);
    wss.close();
  });

  httpServer.once('listening', () => {
    const list = urls();
    const log = server.config.logger;
    if (exposed() && list.length) {
      log.info(`\n  📱 Control remoto: ${list[0].replace(/\?pin=\d+$/, '')}  ·  PIN ${hub.pin}\n`);
    } else {
      log.info('\n  📱 Control remoto: solo en este PC. Para el teléfono usa  npm run remoto\n');
    }
  });
}

export function remoteBridge(): Plugin {
  return {
    name: 'monocoptero-remote-bridge',
    configureServer(server) {
      attach(server, false);
    },
    configurePreviewServer(server) {
      attach(server, true);
    },
  };
}
