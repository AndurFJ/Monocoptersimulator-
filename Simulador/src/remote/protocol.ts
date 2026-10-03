/**
 * protocol.ts — mensajes del control remoto desde el teléfono.
 *
 *   teléfono ──WebSocket──▶ puente (servidor Vite, /remote) ◀──WebSocket── página del PC
 *
 * La página del PC es la ÚNICA dueña del estado. El teléfono manda intenciones
 * (RemoteCommand) y dibuja la instantánea (RemoteState) que la página publica;
 * nunca aplica nada por su cuenta, así que no puede quedar desincronizado.
 * Todos los valores van en unidades del banco (cm y µs).
 */

import type { DataMode } from '../data/types.ts';

/** Controles que el teléfono puede manipular (se resaltan en la página del PC) */
export type RemoteField = 'setpoint' | 'control' | 'pwm' | 'stop' | 'rearm' | 'run' | 'profile';

/** Intención del teléfono. Los valores son absolutos: repetir un mensaje no cambia el resultado. */
export type RemoteCommand =
  /** Mover el setpoint (sin arrancar nada, como el deslizador del panel) */
  | { k: 'setpoint'; cm: number }
  /** Setpoint + arrancar el PID (como «Ir ▲» o los atajos de altura) */
  | { k: 'go'; cm: number }
  | { k: 'control'; mode: 'pid' | 'manual' }
  /** PWM manual absoluto [µs] (pasa a MANUAL si hace falta) */
  | { k: 'pwm'; us: number }
  /** Parada de emergencia: la acepta el puente aunque el teléfono sea «solo ver» */
  | { k: 'stop' }
  | { k: 'rearm' }
  /** Iniciar/pausar (solo en Simulación) */
  | { k: 'run'; on: boolean }
  /** Secuencia de setpoints de la prueba P2 */
  | { k: 'profile'; on: boolean };

/** Progreso de la secuencia de setpoints */
export interface ProfileView {
  steps: number[];
  index: number;
  /** Segundos transcurridos en el tramo actual */
  elapsed: number;
  segment: number;
}

/** Instantánea del estado que la página del PC publica para los teléfonos */
export interface RemoteState {
  /** Número de versión creciente: el teléfono descarta lo que llegue desordenado */
  rev: number;
  mode: DataMode;
  running: boolean;
  /** Hay datos en vivo: simulación en marcha o placa conectada */
  live: boolean;
  /** El PID está cerrando el lazo ahora mismo */
  engaged: boolean;
  control: 'pid' | 'manual';
  /** Setpoint y su rango permitido [cm] */
  sp: number;
  spMin: number;
  spMax: number;
  /** Altura medida [cm] y PWM aplicado [µs]; null sin telemetría */
  y: number | null;
  u: number | null;
  /** Tiempo de la última muestra [s] */
  t: number;
  /** PWM manual [µs] y su rango */
  pwm: number;
  pwmMin: number;
  pwmMax: number;
  u0: number;
  kp: number;
  ki: number;
  kd: number;
  failsafe: boolean;
  profile: ProfileView | null;
  /** Control que se cambió desde el PC hace un momento (para avisarlo en el teléfono) */
  pcEdit: RemoteField | null;
  /** La pestaña del simulador está oculta en el PC (el navegador frena la simulación) */
  pcHidden: boolean;
}

/** Teléfono conectado al puente */
export interface PhoneInfo {
  id: string;
  name: string;
  /** true = tiene el mando; false = solo ver */
  controller: boolean;
}

// ── Mensajes ────────────────────────────────────────────────────

export type PhoneToBridge =
  | { t: 'hello'; pin: string; name: string }
  | { t: 'cmd'; seq: number; cmd: RemoteCommand }
  /** Dedo apoyado (on) o levantado (off) sobre un control */
  | { t: 'touch'; field: RemoteField; on: boolean }
  /** Pedir el mando (si otro teléfono lo tiene) */
  | { t: 'take' };

export type BridgeToPhone =
  | { t: 'welcome'; id: string; name: string; controller: boolean; host: boolean }
  | { t: 'denied'; reason: string }
  | { t: 'role'; controller: boolean }
  | { t: 'host'; online: boolean }
  | { t: 'state'; s: RemoteState }
  | { t: 'ack'; seq: number; ok: boolean; msg?: string };

export type HostToBridge =
  | { t: 'state'; s: RemoteState }
  | { t: 'ack'; to: string; seq: number; ok: boolean; msg?: string };

export type BridgeToHost =
  | { t: 'welcome'; pin: string; urls: string[]; exposed: boolean }
  | { t: 'replaced' }
  | { t: 'phones'; list: PhoneInfo[] }
  | { t: 'cmd'; from: string; name: string; seq: number; cmd: RemoteCommand }
  | { t: 'touch'; from: string; name: string; field: RemoteField; on: boolean };

/** Ruta del WebSocket del puente en el servidor Vite */
export const REMOTE_PATH = '/remote';

/** Página del teléfono */
export const PHONE_PAGE = 'control.html';

/** Periodo mínimo entre instantáneas [ms] (10 Hz: suficiente para el dedo y el ojo) */
export const STATE_INTERVAL_MS = 100;

/** Instantánea de latido aunque nada cambie [ms]: el teléfono sabe que el PC sigue vivo */
export const HEARTBEAT_MS = 500;

/** Sin instantáneas durante este tiempo, el teléfono avisa «sin datos del PC» [ms] */
export const STALE_MS = 1500;

// ── Validación ──────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Validar un comando que llega por la red (null si no tiene la forma esperada) */
export function parseCommand(raw: unknown): RemoteCommand | null {
  if (!isObj(raw)) return null;
  switch (raw.k) {
    case 'setpoint':
    case 'go':
      return isNum(raw.cm) ? { k: raw.k, cm: raw.cm } : null;
    case 'control':
      return raw.mode === 'pid' || raw.mode === 'manual' ? { k: 'control', mode: raw.mode } : null;
    case 'pwm':
      return isNum(raw.us) ? { k: 'pwm', us: raw.us } : null;
    case 'stop':
    case 'rearm':
      return { k: raw.k };
    case 'run':
    case 'profile':
      return typeof raw.on === 'boolean' ? { k: raw.k, on: raw.on } : null;
    default:
      return null;
  }
}

/** Campo del panel que corresponde a cada comando */
export function fieldOf(cmd: RemoteCommand): RemoteField {
  switch (cmd.k) {
    case 'setpoint':
    case 'go':
      return 'setpoint';
    default:
      return cmd.k;
  }
}

const FIELDS: RemoteField[] = ['setpoint', 'control', 'pwm', 'stop', 'rearm', 'run', 'profile'];
export const isField = (v: unknown): v is RemoteField => FIELDS.includes(v as RemoteField);

/** Leer un mensaje JSON sin lanzar excepciones */
export function parseMessage(data: string): Record<string, unknown> | null {
  try {
    const msg: unknown = JSON.parse(data);
    return isObj(msg) && typeof msg.t === 'string' ? msg : null;
  } catch {
    return null;
  }
}
