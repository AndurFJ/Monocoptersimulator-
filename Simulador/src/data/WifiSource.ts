/**
 * WifiSource — fuente de datos del modo "WiFi/ESP32 en vivo".
 *
 * Conecta por WebSocket a una ESP32 que hace de puente serial (UART→WS)
 * y retransmite telemetría a todos los clientes conectados.
 *
 * Soporta dos formatos de trama del ESP32:
 *  - JSON: {"type":"telemetry","t":12.34,"height":0.342,"raw":0.345,"pwm":1580,"ok":true}
 *  - CSV:  "12345,1580,34.2,34.5,30.0" (tiempo_ms, pwm_us, altura_cm, crudo_cm, setpoint_cm)
 *
 * También recibe mensajes de estado:
 *  {"type":"status","uart_connected":true,"clients":3,"ip":"192.168.1.47"}
 */

import type { DataSource, SourceStatus, TelemetrySample, EspStatus } from './types';
import { parseSerialLine, sampleFromJson } from './SerialSource';
import type { TelemetryJson } from './SerialSource';

// Re-export para mantener compatibilidad con importadores existentes
export type { EspStatus };

/** Estado de la conexión WebSocket (para el indicador y el HUD) */
export type WifiConnectionState = 'connecting' | 'connected' | 'disconnected';

export class WifiSource implements DataSource {
  readonly mode = 'wifi' as const;

  /** URL del WebSocket — editable desde el panel */
  url = 'ws://monocoptero.local/ws';

  /**
   * true = al entrar en modo WiFi se conecta solo (main.ts) y reintenta
   * en segundo plano si se corta. false = conexión manual con Conectar.
   */
  autoConnect = true;

  private ws: WebSocket | null = null;
  private sampleCb: ((s: TelemetrySample) => void) | null = null;
  /** Último estado del sensor reportado (para avisar solo en los cambios) */
  private lastSensorOk: boolean | undefined = undefined;
  /** Ya se avisó de la conexión con este dispositivo */
  private announcedDevice = false;
  private statusCb: ((s: SourceStatus) => void) | null = null;
  private espStatusCb: ((s: EspStatus) => void) | null = null;
  private connStateCb: ((s: WifiConnectionState) => void) | null = null;

  private t0: number | null = null;
  private lastEmittedT = 0;
  private lastRawT = 0;
  private virtualTimeOffset = 0;
  private connectTime = 0;

  /** Reconexión con backoff exponencial */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly MAX_RECONNECT_DELAY = 10000;
  private shouldReconnect = false;
  /** Intentos del ciclo actual (para no repetir toasts en cada reintento) */
  private connectAttempts = 0;
  private everConnected = false;

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Abrir WebSocket y empezar a recibir telemetría */
  async start(): Promise<void> {
    if (this.ws) return;
    this.shouldReconnect = true;
    this.reconnectDelay = 1000;
    this.connectAttempts = 0;
    this.connect();
  }

  /** Cerrar WebSocket */
  async stop(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnect();
    this.setConnState('disconnected');
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    try {
      ws.close();
    } catch {
      // ya estaba cerrado
    }
    this.status({ level: 'info', message: 'Conexión WiFi cerrada.', stopped: true });
  }

  reset(): void {
    this.lastSensorOk = undefined;
    this.announcedDevice = false;
    this.t0 = null;
    this.lastEmittedT = 0;
    this.lastRawT = 0;
    this.virtualTimeOffset = 0;
    this.connectTime = performance.now();
  }

  onSample(cb: (s: TelemetrySample) => void): void {
    this.sampleCb = cb;
  }

  onStatus(cb: (s: SourceStatus) => void): void {
    this.statusCb = cb;
  }

  /** Suscribirse a mensajes de estado de la ESP32 (clientes, IP, UART) */
  onEspStatus(cb: (s: EspStatus) => void): void {
    this.espStatusCb = cb;
  }

  /** Suscribirse al estado de la conexión (indicador + HUD) */
  onConnectionState(cb: (s: WifiConnectionState) => void): void {
    this.connStateCb = cb;
  }

  /**
   * Enviar un comando al ESP32 vía WebSocket.
   * Ejemplo: sendCommand({ type: 'cmd', action: 'set_setpoint', value: 0.5 })
   */
  sendCommand(cmd: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    }
  }

  // ── Conexión interna ──────────────────────────────────────────

  private setConnState(s: WifiConnectionState): void {
    this.connStateCb?.(s);
  }

  private connect(): void {
    this.clearReconnect();
    this.connectAttempts++;
    if (this.connectAttempts === 1) {
      this.status({ level: 'info', message: `Conectando a ${this.url}…` });
    }
    this.setConnState('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.setConnState('disconnected');
      this.status({
        level: 'error',
        message: `URL inválida: ${this.url}`,
        stopped: true,
      });
      return;
    }

    ws.onopen = () => {
      this.ws = ws;
      this.reconnectDelay = 1000;
      this.connectAttempts = 0;
      const wasReconnect = this.everConnected;
      this.everConnected = true;
      this.reset();
      this.setConnState('connected');
      this.status({
        level: 'success',
        message: wasReconnect ? `Reconectado a ${this.url}` : `Conectado a ${this.url}`,
      });
    };

    ws.onmessage = (ev) => {
      this.handleMessage(String(ev.data));
    };

    ws.onerror = () => {
      // El evento error no da información útil; onclose se encarga
    };

    ws.onclose = () => {
      const wasConnected = this.ws === ws;
      if (this.ws === ws) this.ws = null;
      this.setConnState('disconnected');

      if (this.shouldReconnect) {
        // Avisar UNA vez por caída y reintentar en silencio en segundo plano.
        if (wasConnected) {
          this.status({
            level: 'warning',
            message: 'Se perdió la conexión WiFi — reintentando en segundo plano…',
          });
        } else if (this.connectAttempts === 1) {
          this.status({
            level: 'error',
            message: `No se pudo conectar a ${this.url}. Reintentando en segundo plano… ¿Está encendida la ESP32?`,
          });
        }
        this.scheduleReconnect();
      } else {
        this.status({ level: 'info', message: 'Desconectado.', stopped: true });
      }
    };
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = this.reconnectDelay;
    // Reintento silencioso: el indicador ya muestra "Conectando…".
    this.setConnState('connecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) this.connect();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.MAX_RECONNECT_DELAY);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Manejo de mensajes ────────────────────────────────────────

  private handleMessage(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) return;

    // Intentar JSON primero
    if (trimmed.startsWith('{')) {
      try {
        const msg = JSON.parse(trimmed);
        if (msg.type === 'telemetry') {
          this.handleTelemetryJson(msg);
          return;
        }
        if (msg.type === 'status') {
          this.handleStatusJson(msg);
          return;
        }
        if (msg.type === 'pong') {
          // Respuesta al ping — ignorar
          return;
        }
      } catch {
        // No era JSON válido — intentar CSV
      }
    }

    // Fallback: formato CSV "tiempo_ms,pwm_us,altura_cm"
    this.handleCsvLine(trimmed);
  }

  private handleTelemetryJson(msg: TelemetryJson): void {
    let t: number;
    if (msg.t !== undefined && msg.t !== null) {
      t = this.deviceTime(msg.t);
    } else {
      t = this.monotonic((performance.now() - this.connectTime) / 1000);
    }
    this.sampleCb?.(sampleFromJson(t, msg));
  }

  /** Tiempo del dispositivo [s] → tiempo relativo estrictamente creciente */
  private deviceTime(tDevice: number): number {
    // Si el dispositivo se reinició (el tiempo retrocede) se continúa desde el último instante
    if (this.t0 === null || tDevice < this.lastRawT - 0.2) {
      this.t0 = tDevice;
      this.virtualTimeOffset = this.lastEmittedT > 0 ? this.lastEmittedT + 0.05 : 0;
    }
    this.lastRawT = tDevice;
    return this.monotonic(this.virtualTimeOffset + (tDevice - this.t0));
  }

  /** uPlot REQUIERE timestamps estrictamente crecientes */
  private monotonic(t: number): number {
    const out = t <= this.lastEmittedT ? this.lastEmittedT + 0.02 : t;
    this.lastEmittedT = out;
    return out;
  }

  private handleStatusJson(msg: EspStatus & { type: string }): void {
    // Reportar estado UART al HUD
    // Avisar solo cuando cambia (el firmware manda el estado cada 2 s)
    if (msg.sensor_ok !== undefined && msg.sensor_ok !== this.lastSensorOk) {
      if (msg.sensor_ok === false) {
        this.status({ level: 'warning', message: 'El HC-SR04 no devuelve eco: revisa cableado y que apunte al carro.' });
      } else if (this.lastSensorOk === false) {
        this.status({ level: 'success', message: 'Sensor HC-SR04 midiendo de nuevo.' });
      }
      this.lastSensorOk = msg.sensor_ok;
    }
    if (msg.uart_connected === true && !this.announcedDevice) {
      this.announcedDevice = true;
      this.status({ level: 'success', message: `Conectado — ${msg.clients ?? '?'} clientes · IP ${msg.ip ?? '?'}` });
    }
    this.espStatusCb?.({
      uart_connected: msg.uart_connected,
      clients: msg.clients,
      uptime_s: msg.uptime_s,
      wifi_mode: msg.wifi_mode,
      ip: msg.ip,
      control_mode: msg.control_mode,
      setpoint_cm: msg.setpoint_cm,
      kp: msg.kp,
      ki: msg.ki,
      kd: msg.kd,
      u0: msg.u0,
      pwm: msg.pwm,
      distancia_cm: msg.distancia_cm,
      sensor_ok: msg.sensor_ok,
      failsafe: msg.failsafe,
      simulado: msg.simulado,
    });
  }

  /** Línea CSV "tiempo_ms,pwm_us,altura_cm[,crudo_cm,setpoint_cm]" */
  private handleCsvLine(line: string): void {
    const parsed = parseSerialLine(line, ['ms', 'pwm', 'altura', 'crudo', 'setpoint'], 'cm');
    if (!parsed || parsed.t === null) return;
    const sample: TelemetrySample = {
      t: this.deviceTime(parsed.t),
      height: Math.max(0, Math.min(1.5, parsed.height)),
      pwm: Math.max(1000, Math.min(2000, parsed.pwm)),
    };
    if (parsed.raw !== undefined) sample.raw = parsed.raw;
    if (parsed.setpoint !== undefined) {
      sample.setpoint = parsed.setpoint;
      sample.error = parsed.setpoint - sample.height;
    }
    this.sampleCb?.(sample);
  }

  private status(s: SourceStatus): void {
    this.statusCb?.(s);
  }
}
