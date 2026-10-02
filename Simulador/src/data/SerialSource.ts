/**
 * SerialSource — fuente de datos del modo "Serial en vivo".
 *
 * Usa la Web Serial API nativa del navegador para conectarse
 * al puerto USB de la ESP32. Solo funciona en navegadores basados
 * en Chromium (Chrome/Edge).
 *
 * Es BIDIRECCIONAL. Protocolo de 04_firmware/PROTOCOLO.md (Arduino Uno y ESP32):
 *  - Envía comandos de texto: "SP 30", "PID 4 2.5 0.3", "U0 1762", "START", "STOP"…
 *    (ambos firmwares los entienden; con dispositivo "esp32" se envía JSON)
 *  - Recibe telemetría CSV:  "tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm"
 *    (también el formato viejo de 3 columnas "tiempo_ms,pwm_us,altura_cm")
 *  - Recibe estado: "STATUS:..." (Uno) o JSON {"type":"status",...} (ESP32)
 *  - Ignora avisos que empiezan con "#".
 *
 * Formatos de línea aceptados (uno por línea, terminada en \n):
 *  - Con etiquetas:  "h:12.3,pwm:1500"  o  "altura=12.3 pwm=1500 t=1234"
 *  - Solo números:   "12345,1580,34.2,34.5,30.0"  — el orden lo define `columns`
 */

import type { DataSource, SourceStatus, TelemetrySample, EspStatus } from './types';
import type { LengthUnit } from './parseTable';
import { toNumber } from './parseTable';

// ── Tipos mínimos de Web Serial (no están en lib.dom de TypeScript) ──

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo?: () => { usbVendorId?: number; usbProductId?: number };
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  /** Puertos ya autorizados por el navegador (para reconectar sin selector) */
  getPorts?: () => Promise<SerialPortLike[]>;
}

/**
 * Vendor IDs de chips USB-serial conocidos:
 * ESP32: 0x10C4 CP210x · 0x1A86 CH340 · 0x303A Espressif · 0x0403 FTDI
 * Arduino: 0x2341 Arduino LLC · 0x2A03 Arduino SRL · 0x1B4F SparkFun
 */
const KNOWN_USB_VENDORS = new Set([
  0x10c4, 0x1a86, 0x303a, 0x0403,
  0x2341, 0x2a03, 0x1b4f,
]);

/** Columnas que se pueden usar en el formato numérico */
export type SerialColumn = 't' | 'ms' | 'altura' | 'crudo' | 'pwm' | 'setpoint' | '_';

export const SERIAL_COLUMN_ALIASES: Record<string, SerialColumn> = {
  t: 't', tiempo: 't', time: 't', s: 't',
  ms: 'ms', millis: 'ms',
  h: 'altura', altura: 'altura', height: 'altura', dist: 'altura', distancia: 'altura', d: 'altura',
  crudo: 'crudo', raw: 'crudo',
  pwm: 'pwm', u: 'pwm', throttle: 'pwm', motor: 'pwm',
  sp: 'setpoint', setpoint: 'setpoint', ref: 'setpoint', referencia: 'setpoint',
  _: '_',
};

/** Convierte "t, altura, pwm" en la lista de columnas. Lanza si hay nombres desconocidos. */
export function parseColumnSpec(spec: string): SerialColumn[] {
  const cols = spec.split(/[,;\s]+/).filter(Boolean).map((name) => {
    const col = SERIAL_COLUMN_ALIASES[name.toLowerCase()];
    if (!col) throw new Error(`Columna desconocida: "${name}"`);
    return col;
  });
  if (!cols.includes('altura')) throw new Error('El formato debe incluir la columna "altura".');
  return cols;
}

export interface ParsedLine {
  /** Segundos si venía en la trama, null si no */
  t: number | null;
  height: number;
  /** Lectura cruda del sensor (ausente si la trama no la trae o no hubo eco) */
  raw?: number;
  pwm: number;
  setpoint?: number;
}

const LENGTH_FACTORS: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001 };

/** Parsear una línea recibida por serial. Devuelve null si no es una trama de datos. */
export function parseSerialLine(line: string, columns: SerialColumn[], unit: LengthUnit): ParsedLine | null {
  const text = line.trim();
  if (!text || text.startsWith('#')) return null;

  const values: Partial<Record<SerialColumn, number>> = {};

  // Formato con etiquetas: clave:valor o clave=valor
  const labeled = [...text.matchAll(/([A-Za-z_áéíóúñ]+)\s*[:=]\s*(-?[\d.]+)/g)];
  if (labeled.length > 0) {
    for (const [, key, raw] of labeled) {
      const col = SERIAL_COLUMN_ALIASES[key.toLowerCase()];
      const v = toNumber(raw);
      if (col && col !== '_' && v !== null) values[col] = v;
    }
  } else {
    const tokens = text.split(/[,;\t ]+/).filter(Boolean);
    // Se aceptan tramas más cortas que `columns` (firmware viejo de 3 columnas)
    // siempre que traigan la altura y al menos 3 campos (o todos, si son menos):
    // así una línea suelta con un número no se confunde con un dato.
    if (tokens.length < Math.min(columns.length, 3) || tokens.length <= columns.indexOf('altura')) return null;
    const n = Math.min(tokens.length, columns.length);
    for (let i = 0; i < n; i++) {
      const v = toNumber(tokens[i]);
      if (v === null) return null; // línea de log/texto, no de datos
      if (columns[i] !== '_') values[columns[i]] = v;
    }
  }

  if (values.altura === undefined) return null;
  const k = LENGTH_FACTORS[unit];
  const t = values.t ?? (values.ms !== undefined ? values.ms / 1000 : null);
  // Negativo = "no aplica" en el firmware (sin eco / sin PID)
  return {
    t,
    height: values.altura * k,
    raw: values.crudo !== undefined && values.crudo >= 0 ? values.crudo * k : undefined,
    pwm: values.pwm ?? 0,
    setpoint: values.setpoint !== undefined && values.setpoint >= 0 ? values.setpoint * k : undefined,
  };
}

export class SerialSource implements DataSource {
  readonly mode = 'serial' as const;

  baudRate = 115200;
  /** Formato CSV de los firmwares: "tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm" */
  columns: SerialColumn[] = ['ms', 'pwm', 'altura', 'crudo', 'setpoint'];
  heightUnit: LengthUnit = 'cm';

  /**
   * Cómo se envían los comandos. 'auto' y 'arduino' mandan texto ("SP 30"),
   * que entienden el Arduino Uno y la ESP32; 'esp32' manda JSON.
   */
  deviceProtocol: 'auto' | 'esp32' | 'arduino' = 'auto';

  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readLoopDone: Promise<void> | null = null;
  private t0Device: number | null = null;
  private t0Host = 0;
  private sampleCb: ((s: TelemetrySample) => void) | null = null;
  /** Último estado del sensor reportado (para avisar solo en los cambios) */
  private lastSensorOk: boolean | undefined = undefined;
  /** Ya se avisó de la conexión con este dispositivo */
  private announcedDevice = false;
  private statusCb: ((s: SourceStatus) => void) | null = null;
  private espStatusCb: ((s: EspStatus) => void) | null = null;

  /**
   * true = al conectar se abre solo el puerto ESP32 ya autorizado por el
   * navegador (sin selector). false = mostrar siempre el selector de puerto.
   */
  autoConnect = true;

  /** Puerto guardado por el navegador detectado en el último escaneo */
  private savedPort: SerialPortLike | null = null;
  /** Forzar el selector de puerto en la próxima conexión (botón "Cambiar puerto") */
  private forcePicker = false;

  /** Verifica si el navegador soporta Web Serial API */
  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  get connected(): boolean {
    return this.port !== null;
  }

  /** ¿Hay un puerto ESP32 ya autorizado listo para conectar sin selector? */
  hasSavedPort(): boolean {
    return this.savedPort !== null;
  }

  /**
   * Escanear los puertos ya autorizados por el navegador y recordar el mejor
   * candidato a ESP32 (por vendor ID del chip USB-serial; si solo hay uno
   * autorizado, se acepta ese). Se llama al arrancar y tras cada conexión.
   */
  async scanForSavedPort(): Promise<void> {
    if (!SerialSource.isSupported()) return;
    const serial = (navigator as Navigator & { serial: SerialLike }).serial;
    if (!serial.getPorts) return;
    try {
      const ports = await serial.getPorts();
      const match = ports.find((p) => {
        const vid = p.getInfo?.().usbVendorId;
        return vid !== undefined && KNOWN_USB_VENDORS.has(vid);
      });
      // Si hay varios puertos autorizados y ninguno parece ESP32, no adivinar.
      this.savedPort = match ?? (ports.length === 1 ? ports[0] : null);
    } catch {
      this.savedPort = null;
    }
  }

  /** La próxima conexión mostrará el selector (llamar dentro de un gesto del usuario) */
  requestPicker(): void {
    this.forcePicker = true;
  }

  /** Conectar (auto o con selector) y empezar a leer */
  async start(): Promise<void> {
    if (this.port) return;
    if (!SerialSource.isSupported()) {
      this.status({ level: 'error', message: 'Web Serial no está disponible. Usa Chrome o Edge.', stopped: true });
      return;
    }
    const serial = (navigator as Navigator & { serial: SerialLike }).serial;

    // 1) Autoconexión: puerto ESP32 ya autorizado, sin selector.
    const useSaved = !this.forcePicker && this.autoConnect && this.savedPort !== null;
    this.forcePicker = false;

    let port: SerialPortLike;
    let auto = false;
    if (useSaved) {
      port = this.savedPort!;
      auto = true;
      try {
        await port.open({ baudRate: this.baudRate });
      } catch (err) {
        // El puerto ya no está disponible (desconectado/ocupado):
        // olvidarlo para que la próxima conexión muestre el selector.
        this.savedPort = null;
        this.status({
          level: 'error',
          message: `No se pudo abrir el puerto guardado: ${errorMessage(err)}. Pulsa Conectar de nuevo para elegir puerto.`,
          stopped: true,
        });
        return;
      }
    } else {
      // 2) Selector de puerto (requiere gesto del usuario — llega del botón Conectar).
      try {
        port = await serial.requestPort();
        await port.open({ baudRate: this.baudRate });
      } catch (err) {
        const cancelled = err instanceof DOMException && err.name === 'NotFoundError';
        this.status({
          level: cancelled ? 'info' : 'error',
          message: cancelled ? 'No se seleccionó ningún puerto.' : `No se pudo abrir el puerto: ${errorMessage(err)}`,
          stopped: true,
        });
        return;
      }
      // El puerto quedó autorizado: recordarlo para la próxima autoconexión.
      this.savedPort = port;
    }

    this.port = port;
    if (port.writable) {
      this.writer = port.writable.getWriter();
    }
    this.reset();
    this.status({
      level: 'success',
      message: auto
        ? `Conectado automáticamente al puerto USB (${this.baudRate} baudios).`
        : `Conectado a ${this.baudRate} baudios.`,
    });
    // Pedir el estado actual al firmware para sincronizar parámetros al instante.
    // Arduino responde a "STATUS\n"; ESP32 a JSON {type:"cmd",action:"get_status"}.
    this.sendCommand({ type: 'cmd', action: 'get_status' });
    this.readLoopDone = this.readLoop(port);
  }

  /** Cierra el puerto */
  async stop(): Promise<void> {
    const port = this.port;
    if (!port) return;
    this.port = null;
    try {
      await this.reader?.cancel();
    } catch {
      // el lector ya estaba cerrado
    }
    await this.readLoopDone;
    const writer = this.writer;
    this.writer = null;
    try {
      await writer?.close();
    } catch {
      // el escritor ya estaba cerrado
    }
    try {
      await port.close();
    } catch {
      // el puerto ya estaba cerrado (p.ej. cable desconectado)
    }
    this.status({ level: 'info', message: 'Puerto serial cerrado.', stopped: true });
    void this.scanForSavedPort();
  }

  reset(): void {
    this.lastSensorOk = undefined;
    this.announcedDevice = false;
    this.t0Device = null;
    this.t0Host = performance.now();
  }

  onSample(cb: (s: TelemetrySample) => void): void {
    this.sampleCb = cb;
  }

  onStatus(cb: (s: SourceStatus) => void): void {
    this.statusCb = cb;
  }

  /** Suscribirse a mensajes de estado de la ESP32 recibidos por USB */
  onEspStatus(cb: (s: EspStatus) => void): void {
    this.espStatusCb = cb;
  }

  /**
   * Enviar un comando al firmware vía USB. Por defecto se traduce a texto
   * ("SP 30"), que entienden ambos firmwares desde el primer instante.
   */
  sendCommand(cmd: object): void {
    const writer = this.writer;
    if (!writer) return;
    const enc = new TextEncoder();
    if (this.deviceProtocol !== 'esp32') {
      const text = SerialSource.toArduinoCmd(cmd);
      if (text) writer.write(enc.encode(`${text}\n`)).catch(() => {});
    } else {
      writer.write(enc.encode(`${JSON.stringify(cmd)}\n`)).catch(() => {});
    }
  }

  /**
   * Traduce un comando JSON (formato ESP32/WebSocket) al protocolo de texto
   * del firmware Arduino Uno. Devuelve null si la acción no tiene equivalente.
   */
  private static toArduinoCmd(cmd: object): string | null {
    const c = cmd as Record<string, unknown>;
    if (c.type !== 'cmd') return null;
    switch (c.action) {
      case 'set_pwm': return `PWM ${Math.round(c.value as number)}`;
      case 'set_setpoint': {
        const v = c.value as number;
        // El front-end envía metros; el Arduino espera centímetros.
        const cm = v <= 1.5 ? v * 100 : v;
        return `SP ${cm.toFixed(1)}`;
      }
      case 'set_pid':
        return `PID ${(c.kp as number).toFixed(3)} ${(c.ki as number).toFixed(3)} ${(c.kd as number).toFixed(3)}`;
      case 'set_u0': return `U0 ${Math.round(c.value as number)}`;
      case 'start': return 'START';
      case 'stop': return 'STOP';
      case 'start_step': return 'STEP';
      case 'get_status': return 'STATUS';
      case 'clear_failsafe': return 'CLEAR';
      default: return null;
    }
  }

  private async readLoop(port: SerialPortLike): Promise<void> {
    if (!port.readable) return;
    const decoder = new TextDecoderStream();
    const pipeDone = port.readable.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {});
    this.reader = decoder.readable.getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) this.handleLine(line);
      }
    } catch (err) {
      if (this.port) {
        this.status({ level: 'error', message: `Error de lectura: ${errorMessage(err)}` });
      }
    } finally {
      this.reader.releaseLock();
      this.reader = null;
      await pipeDone;
    }
    // Si el puerto sigue "abierto" es que se desconectó el dispositivo
    if (this.port) {
      this.port = null;
      this.status({ level: 'warning', message: 'Se perdió la conexión serial.', stopped: true });
    }
  }

  private handleLine(line: string): void {
    const text = line.trim();
    if (!text) return;

    // ── Arduino: línea de estado ─────────────────────────────────
    if (text.startsWith('STATUS:')) {
      this.handleArduinoStatus(text);
      return;
    }

    // ── Arduino: eventos especiales ──────────────────────────────
    if (text === 'FAILSAFE' || text === 'FAILSAFE_ACTIVADO') {
      this.espStatusCb?.({ failsafe: true });
      this.status({ level: 'warning', message: '⚠ FAILSAFE — el firmware cortó el motor.' });
      return;
    }
    if (text === 'FIN_PRUEBA') {
      this.status({ level: 'info', message: 'Prueba de escalón finalizada.' });
      this.espStatusCb?.({ control_mode: 'idle', failsafe: false });
      return;
    }
    // Líneas informativas que no son datos
    if (text.startsWith('#')) {
      if (text.startsWith('# failsafe')) this.status({ level: 'warning', message: `⚠ ${text.slice(2)}` });
      return;
    }
    if (text === 'READY' || text.startsWith('tiempo_ms') || text.startsWith('Listo')) {
      // El firmware se reinició (al abrir el puerto): pedir su estado
      if (text === 'READY') this.sendCommand({ type: 'cmd', action: 'get_status' });
      return;
    }

    // ── ESP32: mensajes JSON por USB (estado/ping/telemetría) ────
    if (text.startsWith('{')) {
      try {
        const msg = JSON.parse(text) as EspStatus & { type?: string };
        if (msg.type === 'status') {
          this.handleStatusJson(msg);
          return;
        }
        if (msg.type === 'telemetry') {
          this.handleTelemetryJson(msg as TelemetryJson);
          return;
        }
        if (msg.type === 'pong') return;
      } catch {
        // no era JSON válido — seguir con CSV
      }
    }

    // ── Telemetría CSV (Arduino y ESP32 usan el mismo formato) ───
    const parsed = parseSerialLine(text, this.columns, this.heightUnit);
    if (!parsed) return;

    let t: number;
    if (parsed.t !== null) {
      if (this.t0Device === null) this.t0Device = parsed.t;
      t = parsed.t - this.t0Device;
    } else {
      t = (performance.now() - this.t0Host) / 1000;
    }

    const sample: TelemetrySample = { t, height: parsed.height, pwm: parsed.pwm };
    if (parsed.raw !== undefined) sample.raw = parsed.raw;
    if (parsed.setpoint !== undefined) {
      sample.setpoint = parsed.setpoint;
      sample.error = parsed.setpoint - parsed.height;
    }
    this.sampleCb?.(sample);
  }

  /**
   * Parsear línea de estado del Arduino Uno.
   * Formato: STATUS:mode,setpoint_cm,kp,ki,kd,pwm,distancia_cm,failsafe[,u0,sensor_ok]
   * Ejemplo: STATUS:idle,30.0,4.000,2.500,0.300,1000,11.2,0,1762,1
   */
  private handleArduinoStatus(line: string): void {
    const parts = line.substring(7).split(',');
    if (parts.length < 8) return;
    const [modeStr, sp, kpStr, kiStr, kdStr, pwmStr, distStr, fsStr, u0Str, okStr] = parts;
    this.espStatusCb?.({
      u0: u0Str !== undefined ? parseInt(u0Str, 10) : undefined,
      sensor_ok: okStr !== undefined ? okStr.trim() === '1' : undefined,
      control_mode: modeStr.trim(),
      setpoint_cm: parseFloat(sp),
      kp: parseFloat(kpStr),
      ki: parseFloat(kiStr),
      kd: parseFloat(kdStr),
      pwm: parseInt(pwmStr, 10),
      distancia_cm: parseFloat(distStr),
      failsafe: fsStr.trim() === '1',
      uart_connected: true,
    });
  }

  /** Estado JSON de la ESP32 recibido por USB: notificar al panel y sincronizar */
  private handleStatusJson(msg: EspStatus & { type?: string }): void {
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
      this.status({ level: 'success', message: `Conectado — IP ${msg.ip ?? '?'}` });
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

  /** Telemetría JSON por USB (el firmware la envía como CSV, pero se acepta por simetría) */
  private handleTelemetryJson(msg: TelemetryJson): void {
    let t: number;
    if (msg.t !== undefined && msg.t !== null) {
      if (this.t0Device === null) this.t0Device = msg.t;
      t = msg.t - this.t0Device;
    } else {
      t = (performance.now() - this.t0Host) / 1000;
    }
    this.sampleCb?.(sampleFromJson(t, msg));
  }

  private status(s: SourceStatus): void {
    this.statusCb?.(s);
  }
}

/** Telemetría JSON del firmware ESP32 (WebSocket o USB) */
export interface TelemetryJson {
  t?: number;
  /** Altura filtrada [m] */
  height?: number;
  /** Lectura cruda [m] (ausente si no hubo eco) */
  raw?: number;
  pwm?: number;
  /** Setpoint [m] (solo en PID) */
  setpoint?: number;
  mode?: string;
  /** false si el sensor no devuelve eco */
  ok?: boolean;
}

/** Construir una muestra a partir de la telemetría JSON (compartido con WifiSource) */
export function sampleFromJson(t: number, msg: TelemetryJson): TelemetrySample {
  const clampH = (h: number) => Math.max(0, Math.min(1.5, h));
  const sample: TelemetrySample = {
    t,
    height: clampH(msg.height ?? 0),
    pwm: Math.max(1000, Math.min(2000, msg.pwm ?? 1000)),
  };
  if (typeof msg.raw === 'number' && msg.raw >= 0) sample.raw = clampH(msg.raw);
  if (typeof msg.ok === 'boolean') sample.sensorOk = msg.ok;
  if (typeof msg.setpoint === 'number' && msg.setpoint >= 0) {
    sample.setpoint = clampH(msg.setpoint);
    sample.error = sample.setpoint - sample.height;
  }
  return sample;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
