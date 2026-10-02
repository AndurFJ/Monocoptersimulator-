/**
 * ParamsPanel — barra lateral de controles del usuario.
 *
 * Cabecera fija: selector de modo + iniciar/pausar/reiniciar.
 * Cuerpo (un solo scroll), según el modo:
 *  - Simulación:   altura objetivo (o PWM manual), métricas del escalón, ganancias PID
 *  - Reproducción: archivo Excel/CSV (arrastrar y soltar), unidad, velocidad, posición
 *  - Serial:       estado de conexión, baudios, unidad, formato de trama
 */

import type { AppState } from '../core/AppState';
import type { DataMode } from '../data/types';
import type { ReplaySource, LoadedFile } from '../data/ReplaySource';
import { SerialSource, parseColumnSpec } from '../data/SerialSource';
import type { WifiSource, EspStatus, WifiConnectionState } from '../data/WifiSource';
import type { LengthUnit } from '../data/parseTable';
import type { StepResult } from '../core/StepMetrics';
import type { StepPhase } from '../core/StepSequence';
import {
  H_MAX, PWM_MIN, PWM_MAX, DEFAULT_KP, DEFAULT_KI, DEFAULT_KD, DEFAULT_U0_US,
  DEAD_ZONE_FRACTION, UNSTABLE_ZONE_FRACTION, DEAD_ZONE_TOP_M, UNSTABLE_ZONE_START_M,
  PLANT_K_CM_PER_US, PLANT_U0_US, PLANT_Y0_M, REST_HEIGHT_M,
  STEP_TEST_U0_US, STEP_TEST_DELTA_US, STEP_TEST_PRE_S, STEP_TEST_TOTAL_S,
} from '../physics/constants';
import { zoneOf } from '../physics/zones';
import { fadeIn, pulse } from './animations';

export interface ParamsPanelDeps {
  state: AppState;
  replay: ReplaySource;
  serial: SerialSource;
  wifi: WifiSource;
  /** Descargar la grabación actual como Excel para PID Tuner */
  onExportRecording: () => void;
  /** Descartar la grabación actual */
  onClearRecording: () => void;
  /** Ensayo de escalón automático en el banco, flotando en u₀ [µs] */
  onStepTest: (u0: number) => void;
  /** Cancelar el ensayo automático (apaga el motor) */
  onStepTestCancel: () => void;
}

export interface StepTestView {
  phase: StepPhase;
  text: string;
}

export interface RecordingStatus {
  count: number;
  duration: number;
  recording: boolean;
  full: boolean;
}

const TIME_UNIT_LABELS = { s: 's', ms: 'ms', clock: 'hh:mm:ss' } as const;
const SETPOINT_PRESETS_CM = [15, 20, 30, 40, 50, 60, 70];

/** PWM a partir del cual el carro se despega de la base, según el modelo identificado */
const LIFT_OFF_US = Math.round(PLANT_U0_US + ((REST_HEIGHT_M - PLANT_Y0_M) * 100) / PLANT_K_CM_PER_US);
/** Posición ∈ [0,1] de un PWM en el slider manual */
const pwmPos = (us: number) => (us - PWM_MIN) / (PWM_MAX - PWM_MIN);

/** Etiquetas legibles del modo de control reportado por el firmware de la ESP32 */
const ESP_MODE_LABELS: Record<string, string> = {
  idle: 'Reposo',
  pid: 'PID',
  manual: 'Manual',
  step: 'Escalón',
};

const RANGE_FORMATS: Record<string, (v: number) => string> = {
  cm: (v) => `${v.toFixed(1)} cm`,
  us: (v) => `${Math.round(v)} µs`,
  pct: (v) => `${Math.round(v / 10)} %`,
};

/**
 * Actualiza el relleno y la burbuja de un slider personalizado.
 * `--pos` ∈ [0,1] lo usan el track (CSS) y la burbuja de valor.
 * Hay que llamarlo también cuando el valor cambia por código.
 */
function syncRange(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const v = Number(input.value);
  const pos = max > min ? (v - min) / (max - min) : 0;
  const wrap = input.closest<HTMLElement>('.range-wrap') ?? input;
  wrap.style.setProperty('--pos', String(pos));
  const bubble = wrap.querySelector('.range-bubble');
  const format = RANGE_FORMATS[input.dataset.format ?? ''];
  if (bubble && format) bubble.textContent = format(v);
}

/** Formatea con coma o punto según el idioma del navegador */
const fmt = (v: number, digits: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export class ParamsPanel {
  private readonly root: HTMLElement;
  private readonly state: AppState;
  private readonly replay: ReplaySource;
  private readonly serial: SerialSource;
  private readonly wifi: WifiSource;
  private stopPulse: (() => void) | null = null;
  private stopWifiPulse: (() => void) | null = null;
  private stepTestActive = false;
  private readonly deps: ParamsPanelDeps;

  constructor(container: HTMLElement, deps: ParamsPanelDeps) {
    this.deps = deps;
    this.state = deps.state;
    this.replay = deps.replay;
    this.serial = deps.serial;
    this.wifi = deps.wifi;
    this.root = container;
    this.render();
    this.bind();
    this.root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((r) => {
      syncRange(r);
      r.addEventListener('input', () => syncRange(r));
    });
    this.updateMode(this.state.mode);
    this.updateRunning(this.state.running);
    this.showMetrics(null);
    this.showSetpointZone(this.state.setpoint);
  }

  // ── Construcción del DOM ──────────────────────────────────────────

  private render(): void {
    const s = this.state;
    const hMaxCm = H_MAX * 100;
    this.root.innerHTML = `
      <header class="sidebar-header">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">◈</span>
          <div>
            <div class="brand-title">Monocóptero 1-GDL</div>
            <div class="brand-sub">Banco de pruebas · control de altura</div>
          </div>
        </div>

        <div class="segmented" role="tablist" aria-label="Fuente de datos">
          <button role="tab" data-mode="simulacion" title="Física + PID en el navegador">Simulación</button>
          <button role="tab" data-mode="reproduccion" title="Reproducir un ensayo guardado">Reproducción</button>
          <button role="tab" data-mode="serial" title="Datos en vivo del microcontrolador">Serial</button>
          <button role="tab" data-mode="wifi" title="WiFi/ESP32 en vivo">WiFi</button>
        </div>

        <div class="transport">
          <button class="btn btn-primary" data-action="toggle-run" title="Espacio">▶ Iniciar</button>
          <button class="btn btn-icon" data-action="reset" title="Reiniciar (R)" aria-label="Reiniciar">⟲</button>
        </div>
      </header>

      <div class="sidebar-body">
        <!-- ── Control de Altura y Parámetros (Simulación, Serial y WiFi) ── -->
        <section class="mode-section" data-section="simulacion,wifi,serial">
          <div class="card">
            <div class="card-head">
              <h2 class="card-title" data-out="control-title">Altura objetivo</h2>
              <div class="segmented segmented-xs" aria-label="Tipo de control">
                <button data-control="pid" title="El PID decide la potencia">PID</button>
                <button data-control="manual" title="Tú decides la potencia">Manual</button>
              </div>
            </div>

            <div data-only="pid" class="stack">
              <form class="setpoint-form" data-form="setpoint">
                <div class="input-unit input-big">
                  <input id="setpoint-cm" type="number" data-input="setpoint-cm" min="0" max="${hMaxCm}" step="0.5"
                    value="${(s.setpoint * 100).toFixed(1)}" inputmode="decimal" aria-label="Altura objetivo en centímetros" />
                  <span>cm</span>
                </div>
                <button type="submit" class="btn btn-go" title="Aplicar y arrancar (Enter)">Ir ▲</button>
              </form>
              <div class="range-wrap range-setpoint">
                <input type="range" data-input="setpoint" data-format="cm" min="0" max="${hMaxCm}" step="0.5" value="${s.setpoint * 100}"
                  aria-label="Altura objetivo" />
                <output class="range-bubble" aria-hidden="true"></output>
                <div class="zone-strip" aria-hidden="true"
                  style="--dz: ${DEAD_ZONE_FRACTION}; --uz: ${UNSTABLE_ZONE_FRACTION}">
                  <span class="zs-dead" title="Zona muerta: 0 – ${fmt(DEAD_ZONE_TOP_M * 100, 1)} cm"></span>
                  <span class="zs-span" title="Span útil: ${fmt(DEAD_ZONE_TOP_M * 100, 1)} – ${fmt(UNSTABLE_ZONE_START_M * 100, 1)} cm"></span>
                  <span class="zs-unstable" title="Zona inestable: ${fmt(UNSTABLE_ZONE_START_M * 100, 1)} – ${hMaxCm} cm"></span>
                </div>
                <div class="range-scale"><span>0</span><span>span ${fmt(DEAD_ZONE_TOP_M * 100, 1)} – ${fmt(UNSTABLE_ZONE_START_M * 100, 1)} cm</span><span>${hMaxCm} cm</span></div>
              </div>
              <p class="zone-warning" data-out="sp-zone" role="status" hidden></p>
              <div class="presets" aria-label="Alturas rápidas">
                ${SETPOINT_PRESETS_CM.map((cm) => `<button type="button" class="chip" data-preset="${cm}">${cm}</button>`).join('')}
              </div>
            </div>

            <div data-only="manual" class="stack">
              <div class="big-readout"><output data-out="manual-pwm">${s.manualPwm}</output><span>µs</span></div>
              <div class="range-wrap range-pwm">
                <input type="range" data-input="manual-pwm" data-format="us" min="${PWM_MIN}" max="${PWM_MAX}" step="5" value="${s.manualPwm}"
                  aria-label="PWM manual" />
                <output class="range-bubble" aria-hidden="true"></output>
                <span class="range-mark" style="--at: ${pwmPos(s.feedforward)}" title="PWM de equilibrio u₀ (hovering identificado)">u₀</span>
                <div class="range-scale"><span>${PWM_MIN}</span><span>${PWM_MAX} µs</span></div>
              </div>
              <p class="hint">Lazo abierto. Por debajo de ~${LIFT_OFF_US} µs el carro se queda apoyado en la base;
                cada +10 µs sobre u₀ lo suben ≈ ${fmt(PLANT_K_CM_PER_US * 10, 1)} cm (modelo identificado). 1000 µs = motor apagado.</p>
            </div>
          </div>

          <div class="card" data-only="pid">
            <div class="card-head">
              <h2 class="card-title">Respuesta al escalón</h2>
              <span class="badge" data-out="settled">—</span>
            </div>
            <dl class="metrics">
              <div><dt title="Tiempo del 10 % al 90 % del salto">Subida</dt><dd data-metric="rise">—</dd></div>
              <div><dt title="Cuánto se pasa del objetivo, en % del salto">Sobrepico</dt><dd data-metric="overshoot">—</dd></div>
              <div><dt title="Hasta quedar dentro de ±2 % del salto">Establec.</dt><dd data-metric="settling">—</dd></div>
              <div><dt title="Error medio del último segundo">Error</dt><dd data-metric="error">—</dd></div>
            </dl>
          </div>

          <details class="card" data-only="pid" data-collapse="gains">
            <summary class="card-head">
              <h2 class="card-title"><span class="chevron" aria-hidden="true">▸</span> Ganancias PID</h2>
              <span class="summary-values mono" data-out="gains-summary"></span>
            </summary>
            <div class="gains">
              <label class="gain" title="µs de PWM por cm de error"><span>K<sub>p</sub></span><input type="number" data-gain="kp" step="0.1" min="0" value="${s.kp}" /></label>
              <label class="gain" title="µs por cm·s de error acumulado"><span>K<sub>i</sub></span><input type="number" data-gain="ki" step="0.1" min="0" value="${s.ki}" /></label>
              <label class="gain" title="µs por cm/s de velocidad (derivada de la medida)"><span>K<sub>d</sub></span><input type="number" data-gain="kd" step="0.05" min="0" value="${s.kd}" /></label>
              <label class="gain" title="PWM de equilibrio sumado a la salida del PID [µs]">
                <span>u<sub>0</sub></span><input type="number" data-input="feedforward" step="1" min="1500" max="1900" value="${s.feedforward}" />
              </label>
            </div>
            <p class="hint">Unidades del banco: K<sub>p</sub> [µs/cm], K<sub>i</sub> [µs/(cm·s)], K<sub>d</sub> [µs·s/cm], u₀ [µs] —
              las mismas del firmware, así que lo que pruebes aquí vale en el prototipo.
              Por defecto: sintonía SIMC sobre G<sub>p</sub>(s) = 0.4302 e<sup>−0.1188s</sup>/(1.5719s+1).</p>
            <button type="button" class="btn btn-ghost btn-sm" data-action="reset-gains">Restaurar valores</button>
          </details>
        </section>

        <!-- ── Control en vivo del prototipo (Serial USB y WiFi, sincronizado) ── -->
        <section class="mode-section" data-section="serial,wifi">
          <!-- Parada de emergencia: siempre a la vista, primero -->
          <div class="card card-ems">
            <button type="button" class="btn btn-ems" data-action="live-emergency" disabled>
              <span class="ems-icon" aria-hidden="true">⏻</span> PARADA DE EMERGENCIA
            </button>
            <p class="hint">Corta el motor al instante (PWM → 1000 µs). Púlsala antes de acercarte al banco.</p>
          </div>

          <!-- Aviso de failsafe del firmware -->
          <div class="card card-failsafe" data-out="failsafe-banner" hidden>
            <div class="failsafe-title">⚠ FAILSAFE ACTIVADO</div>
            <p class="hint">El firmware cortó el motor por altura excesiva. Revisa el banco antes de continuar.</p>
            <button type="button" class="btn btn-warning" data-action="live-rearm" disabled>Rearmar (reconocer)</button>
          </div>

          <div class="card">
            <h2 class="card-title">Acciones en vivo</h2>
            <label class="field step-u0">
              <span class="field-label">u₀ del ensayo de escalón
                <output data-out="step-u1">${STEP_TEST_U0_US} → ${STEP_TEST_U0_US + STEP_TEST_DELTA_US} µs</output></span>
              <div class="input-unit">
                <input type="number" data-input="step-u0" min="1500" max="1900" step="5" value="${STEP_TEST_U0_US}"
                  inputmode="numeric" aria-label="PWM de flotado del ensayo de escalón" />
                <span>µs</span>
              </div>
            </label>
            <div class="actions-grid">
              <button type="button" class="btn btn-go" data-action="live-pid" disabled>🎯 Iniciar PID</button>
              <button type="button" class="btn" data-action="live-step" disabled>⏺ Ensayo de escalón</button>
              <button type="button" class="btn btn-danger" data-action="live-stop" disabled>⏹ Detener Motor</button>
            </div>
            <p class="step-status mono" data-out="step-status" role="status" hidden></p>
            <p class="hint">Ensayo automático: despega con una rampa de PWM, flota en u₀ hasta quedar quieto
              ${STEP_TEST_PRE_S} s, la ESP32 hace el escalón (${STEP_TEST_PRE_S} s en u₀ → ${STEP_TEST_TOTAL_S - STEP_TEST_PRE_S} s en u₀+${STEP_TEST_DELTA_US})
              y se descarga el Excel solo. Se cancela con ⏹ o con la parada de emergencia.</p>
            <p class="hint">Los comandos viajan por el canal activo (USB o WiFi) y la ESP32 los retransmite a todos los dispositivos conectados.</p>
          </div>

          <!-- Valores en vivo del prototipo (eco de la ESP32) -->
          <div class="card" data-out="wifi-live" hidden>
            <h2 class="card-title">Valores en vivo · prototipo</h2>
            <div class="live-grid">
              <div class="live-cell"><span>Altura (sensor)</span><b data-out="live-height">—</b></div>
              <div class="live-cell"><span>Lectura cruda</span><b data-out="live-raw">—</b></div>
              <div class="live-cell"><span>PWM</span><b data-out="live-pwm">—</b></div>
              <div class="live-cell"><span>Sensor</span><b data-out="live-sensor">—</b></div>
              <div class="live-cell"><span>Modo</span><b data-out="live-mode">—</b></div>
              <div class="live-cell"><span>Objetivo</span><b data-out="live-setpoint">—</b></div>
            </div>
          </div>

          <div class="card" data-out="wifi-info" hidden>
            <h2 class="card-title">Estado del dispositivo</h2>
            <dl class="mapping">
              <dt>IP</dt><dd data-out="esp-ip">—</dd>
              <dt>Clientes</dt><dd data-out="esp-clients">—</dd>
              <dt>Modo</dt><dd data-out="esp-mode">—</dd>
              <dt>Uptime</dt><dd data-out="esp-uptime">—</dd>
              <dt>Ganancias</dt><dd data-out="esp-gains">—</dd>
            </dl>
          </div>
        </section>

        <!-- ── Reproducción ── -->
        <section class="mode-section" data-section="reproduccion">
          <div class="card">
            <h2 class="card-title">Ensayo guardado</h2>
            <label class="dropzone" data-dropzone>
              <input type="file" data-input="file" accept=".xlsx,.xls,.csv,.txt" class="visually-hidden" />
              <span class="dropzone-icon" aria-hidden="true">⇪</span>
              <span><strong>Elige un archivo</strong> o arrástralo aquí</span>
              <span class="hint">.xlsx · .xls · .csv</span>
            </label>
            <div class="file-info" data-out="file-info" hidden></div>
          </div>

          <div class="card">
            <h2 class="card-title">Reproducción</h2>
            <label class="field">
              <span class="field-label">Posición <output data-out="progress">0 %</output></span>
              <div class="range-wrap range-seek">
                <input type="range" data-input="seek" data-format="pct" min="0" max="1000" step="1" value="0" disabled aria-label="Posición" />
                <output class="range-bubble" aria-hidden="true"></output>
              </div>
            </label>
            <div class="field-row">
              <label class="field">
                <span class="field-label">Velocidad</span>
                <select data-input="speed">
                  <option value="0.25">0.25×</option>
                  <option value="0.5">0.5×</option>
                  <option value="1" selected>1×</option>
                  <option value="2">2×</option>
                  <option value="4">4×</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">Unidad de altura</span>
                <select data-input="replay-unit">
                  <option value="">Automática</option>
                  <option value="m">m</option>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <!-- ── Serial ── -->
        <section class="mode-section" data-section="serial">
          <div class="card">
            <div class="serial-status">
              <span class="dot" data-out="serial-dot" aria-hidden="true"></span>
              <div>
                <div data-out="serial-state">Desconectado</div>
                <div class="hint">Pulsa <strong>Conectar</strong> y elige el puerto del Arduino.</div>
              </div>
            </div>
            ${SerialSource.isSupported() ? '' : '<p class="hint hint-warning">Este navegador no soporta Web Serial. Usa Chrome o Edge de escritorio.</p>'}
            <p class="hint">Canal bidireccional: los controles de arriba mandan comandos al firmware. Compatible con Arduino Uno y ESP32.</p>

            <div class="field-check">
              <input type="checkbox" id="serial-autoconnect" data-input="serial-auto" checked />
              <label for="serial-autoconnect">Autoconectar por USB (sin elegir puerto)</label>
            </div>
            <p class="hint">Abre el puerto del microcontrolador ya autorizado por el navegador (también al entrar en este modo). Desactívalo para elegir el puerto cada vez.</p>
            <button type="button" class="btn btn-ghost btn-sm" data-action="serial-picker">🔁 Cambiar puerto…</button>
          </div>

          <div class="card">
            <h2 class="card-title">Puerto y trama</h2>
            <div class="field-row">
              <label class="field">
                <span class="field-label">Baudios</span>
                <select data-input="baud">
                  ${[9600, 19200, 38400, 57600, 115200, 230400].map((b) => `<option value="${b}" ${b === this.serial.baudRate ? 'selected' : ''}>${b}</option>`).join('')}
                </select>
              </label>
              <label class="field">
                <span class="field-label">Unidad de altura</span>
                <select data-input="serial-unit">
                  <option value="cm" selected>cm</option>
                  <option value="m">m</option>
                  <option value="mm">mm</option>
                </select>
              </label>
            </div>
            <label class="field">
              <span class="field-label">Dispositivo</span>
              <select data-input="serial-device">
                <option value="auto" selected>Automático</option>
                <option value="arduino">Arduino Uno</option>
                <option value="esp32">ESP32</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Columnas de cada línea</span>
              <input type="text" data-input="columns" value="${this.serial.columns.join(', ')}" spellcheck="false" />
            </label>
            <p class="hint">Nombres: <code>t</code> (s), <code>ms</code>, <code>altura</code>, <code>crudo</code>, <code>pwm</code>, <code>setpoint</code>, <code>_</code> (ignorar). Las líneas con etiquetas como <code>h:12.3,pwm:1500</code> se leen solas.</p>
          </div>
        </section>

        <!-- ── WiFi/ESP32 ── -->
        <section class="mode-section" data-section="wifi">
          <div class="card">
            <div class="wifi-status">
              <span class="dot" data-out="wifi-dot" aria-hidden="true"></span>
              <div>
                <div data-out="wifi-state">Desconectado</div>
                <div class="hint">Pulsa <strong>Conectar</strong> para enlazar con la ESP32.</div>
              </div>
            </div>
            <div class="field-check">
              <input type="checkbox" id="wifi-autoconnect" data-input="wifi-auto" checked />
              <label for="wifi-autoconnect">Autoconectar al entrar en el modo</label>
            </div>
            <p class="hint">Conecta solo y reintenta en segundo plano si se corta la conexión (avisando una sola vez).</p>
          </div>

          <div class="card">
            <h2 class="card-title">Conexión WebSocket</h2>
            <label class="field">
              <span class="field-label">URL del WebSocket</span>
              <input type="text" data-input="wifi-url" value="${this.wifi.url}" spellcheck="false" placeholder="ws://monocoptero.local/ws" />
            </label>
            <p class="hint">Dirección del WebSocket de la ESP32. Usa <code>ws://monocoptero.local/ws</code> o la IP directa.</p>
          </div>
        </section>

        <!-- ── Grabación (Simulación y Serial) ── -->
        <section class="card recorder" data-recorder>
          <div class="card-head">
            <h2 class="card-title">Grabación</h2>
            <span class="rec-state" data-out="rec-state"><span class="rec-dot"></span><span data-out="rec-label">Sin datos</span></span>
          </div>
          <div class="rec-stats mono">
            <span><b data-out="rec-count">0</b> muestras</span>
            <span><b data-out="rec-duration">0,0</b> s</span>
          </div>
          <div class="rec-actions">
            <button type="button" class="btn btn-export" data-action="export" disabled>⬇ Excel para PID Tuner</button>
            <button type="button" class="btn btn-icon" data-action="clear-rec" title="Descartar grabación" aria-label="Descartar grabación" disabled>🗑</button>
          </div>
          <p class="hint" data-out="rec-hint">Se graba todo lo recibido mientras está en marcha. Cada conexión nueva empieza una grabación nueva.</p>
        </section>
      </div>

      <footer class="sidebar-footer">
        <kbd>Espacio</kbd> iniciar/pausar · <kbd>R</kbd> reiniciar
      </footer>
    `;
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`ParamsPanel: no existe ${selector}`);
    return el;
  }

  // ── Eventos ───────────────────────────────────────────────────────

  private bind(): void {
    const st = this.state;

    // Modo
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => st.setMode(btn.dataset.mode as DataMode));
    });

    // Transporte
    this.q('[data-action="toggle-run"]').addEventListener('click', () => st.setRunning(!st.running));
    this.q('[data-action="reset"]').addEventListener('click', () => st.requestReset());

    // Control PID / manual
    this.root.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((btn) => {
      btn.addEventListener('click', () => st.setControlMode(btn.dataset.control as 'pid' | 'manual'));
    });

    // Setpoint: slider (en vivo), casilla + "Ir" (aplica y arranca) y atajos
    const setpoint = this.q<HTMLInputElement>('[data-input="setpoint"]');
    setpoint.addEventListener('input', () => st.setSetpoint(Number(setpoint.value) / 100));

    const setpointCm = this.q<HTMLInputElement>('[data-input="setpoint-cm"]');
    const goTo = (cm: number) => {
      if (!Number.isFinite(cm)) return;
      st.setSetpoint(cm / 100);
      st.requestPidGo();
    };
    this.q<HTMLFormElement>('[data-form="setpoint"]').addEventListener('submit', (e) => {
      e.preventDefault();
      goTo(Number(setpointCm.value));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => goTo(Number(btn.dataset.preset)));
    });

    const manual = this.q<HTMLInputElement>('[data-input="manual-pwm"]');
    manual.addEventListener('input', () => st.setManualPwm(Number(manual.value)));

    // Ganancias
    const gainInputs = ['kp', 'ki', 'kd'].map((g) => this.q<HTMLInputElement>(`[data-gain="${g}"]`));
    const ff = this.q<HTMLInputElement>('[data-input="feedforward"]');
    const applyGains = () => {
      const [kp, ki, kd] = gainInputs.map((i) => Number(i.value));
      if ([kp, ki, kd].every(Number.isFinite)) st.setPIDGains(kp, ki, kd);
    };
    gainInputs.forEach((i) => i.addEventListener('change', applyGains));
    ff.addEventListener('change', () => {
      const v = Number(ff.value);
      if (Number.isFinite(v)) st.setFeedforward(v);
      ff.value = String(st.feedforward);
    });
    this.q('[data-action="reset-gains"]').addEventListener('click', () => {
      st.setPIDGains(DEFAULT_KP, DEFAULT_KI, DEFAULT_KD);
      st.setFeedforward(DEFAULT_U0_US);
    });
    const gainsBox = this.q<HTMLDetailsElement>('[data-collapse="gains"]');
    gainsBox.addEventListener('toggle', () => {
      if (gainsBox.open) fadeIn(this.q('.gains'));
    });
    this.updateGainsSummary();

    // Reproducción
    const fileInput = this.q<HTMLInputElement>('[data-input="file"]');
    const unitSelect = this.q<HTMLSelectElement>('[data-input="replay-unit"]');
    const selectedUnit = () => (unitSelect.value || undefined) as LengthUnit | undefined;
    const loadFile = async (file: File) => {
      st.setRunning(false);
      const info = this.q('[data-out="file-info"]');
      info.hidden = false;
      info.textContent = `Leyendo ${file.name}…`;
      try {
        this.showFileInfo(await this.replay.loadFile(file, selectedUnit()));
        st.requestReset();
        st.reportStatus({ level: 'success', message: `Archivo cargado: ${file.name}. Pulsa Iniciar.` });
      } catch (err) {
        info.textContent = 'No se pudo leer el archivo.';
        st.reportStatus({ level: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    };
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void loadFile(file);
    });

    const dropzone = this.q('[data-dropzone]');
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragging');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragging');
      const file = e.dataTransfer?.files[0];
      if (file) void loadFile(file);
    });

    unitSelect.addEventListener('change', () => {
      if (!this.replay.loaded) return;
      st.setRunning(false);
      this.showFileInfo(this.replay.setHeightUnit(selectedUnit()));
      st.requestReset();
    });

    const speed = this.q<HTMLSelectElement>('[data-input="speed"]');
    speed.addEventListener('change', () => { this.replay.speed = Number(speed.value); });

    const seek = this.q<HTMLInputElement>('[data-input="seek"]');
    seek.addEventListener('input', () => {
      this.replay.seek(Number(seek.value) / 1000);
      this.q('[data-out="progress"]').textContent = `${Math.round(Number(seek.value) / 10)} %`;
    });

    // Serial
    const baud = this.q<HTMLSelectElement>('[data-input="baud"]');
    baud.addEventListener('change', () => { this.serial.baudRate = Number(baud.value); });

    const serialUnit = this.q<HTMLSelectElement>('[data-input="serial-unit"]');
    serialUnit.addEventListener('change', () => { this.serial.heightUnit = serialUnit.value as LengthUnit; });

    const serialDevice = this.q<HTMLSelectElement>('[data-input="serial-device"]');
    serialDevice.addEventListener('change', () => {
      this.serial.deviceProtocol = serialDevice.value as 'auto' | 'esp32' | 'arduino';
    });

    const serialAuto = this.q<HTMLInputElement>('[data-input="serial-auto"]');
    serialAuto.addEventListener('change', () => { this.serial.autoConnect = serialAuto.checked; });

    this.q('[data-action="serial-picker"]').addEventListener('click', () => {
      this.serial.requestPicker();
      st.setRunning(true);
    });

    const columns = this.q<HTMLInputElement>('[data-input="columns"]');
    columns.addEventListener('change', () => {
      try {
        this.serial.columns = parseColumnSpec(columns.value);
        columns.classList.remove('invalid');
        columns.removeAttribute('aria-invalid');
      } catch (err) {
        columns.classList.add('invalid');
        columns.setAttribute('aria-invalid', 'true');
        st.reportStatus({ level: 'warning', message: err instanceof Error ? err.message : String(err) });
      }
    });

    // WiFi
    const wifiUrl = this.q<HTMLInputElement>('[data-input="wifi-url"]');
    wifiUrl.addEventListener('change', () => {
      this.wifi.url = wifiUrl.value.trim() || 'ws://monocoptero.local/ws';
    });
    const wifiAuto = this.q<HTMLInputElement>('[data-input="wifi-auto"]');
    wifiAuto.addEventListener('change', () => {
      this.wifi.autoConnect = wifiAuto.checked;
    });

    this.q('[data-action="live-pid"]').addEventListener('click', () => {
      if (!this.isLiveConnected()) return;
      st.requestPidGo();
      st.reportStatus({ level: 'info', message: `Control PID activado: objetivo ${fmt(st.setpoint * 100, 1)} cm.` });
    });
    const stepU0 = this.q<HTMLInputElement>('[data-input="step-u0"]');
    const readStepU0 = () => {
      const v = Number(stepU0.value);
      const u0 = Math.round(Math.max(1500, Math.min(1900, Number.isFinite(v) ? v : STEP_TEST_U0_US)));
      stepU0.value = String(u0);
      this.q('[data-out="step-u1"]').textContent = `${u0} → ${u0 + STEP_TEST_DELTA_US} µs`;
      return u0;
    };
    stepU0.addEventListener('change', readStepU0);
    this.q('[data-action="live-step"]').addEventListener('click', () => {
      if (this.stepTestActive) this.deps.onStepTestCancel();
      else if (this.isLiveConnected()) this.deps.onStepTest(readStepU0());
    });
    // La parada cancela primero el ensayo, si no la rampa volvería a encender el motor
    this.q('[data-action="live-stop"]').addEventListener('click', () => {
      this.deps.onStepTestCancel();
      if (!this.sendLiveCommand({ type: 'cmd', action: 'stop' })) return;
      st.reportStatus({ level: 'warning', message: 'Motor detenido en la ESP32.' });
    });
    this.q('[data-action="live-emergency"]').addEventListener('click', () => {
      this.deps.onStepTestCancel();
      if (!this.sendLiveCommand({ type: 'cmd', action: 'stop' })) return;
      st.reportStatus({ level: 'warning', message: '⏻ PARADA DE EMERGENCIA — motor a 1000 µs.' });
    });
    this.q('[data-action="live-rearm"]').addEventListener('click', () => {
      if (!this.sendLiveCommand({ type: 'cmd', action: 'clear_failsafe' })) return;
      st.reportStatus({
        level: 'info',
        message: 'Failsafe reconocido. El motor sigue detenido; inicia PID o escalón cuando estés listo.',
      });
    });

    // Grabación
    this.q('[data-action="export"]').addEventListener('click', () => this.deps.onExportRecording());
    this.q('[data-action="clear-rec"]').addEventListener('click', () => this.deps.onClearRecording());

    // Reflejar cambios del estado
    st.bus.on('mode-change', (m) => this.updateMode(m));
    st.bus.on('running-change', (r) => this.updateRunning(r));
    st.bus.on('control-mode-change', () => this.updateControlMode());
    // Reflejar en las casillas los cambios que llegan del firmware o de "Restaurar"
    st.bus.on('pid-change', ({ kp, ki, kd }) => {
      [kp, ki, kd].forEach((v, k) => {
        if (document.activeElement !== gainInputs[k]) gainInputs[k].value = String(Math.round(v * 1000) / 1000);
      });
      this.updateGainsSummary();
    });
    st.bus.on('feedforward-change', (u0) => {
      if (document.activeElement !== ff) ff.value = String(u0);
      this.root.querySelector<HTMLElement>('.range-pwm .range-mark')?.style.setProperty('--at', String(pwmPos(u0)));
      this.updateGainsSummary();
    });
    st.bus.on('setpoint-change', (v) => {
      const cm = v * 100;
      setpoint.value = String(cm);
      syncRange(setpoint);
      if (document.activeElement !== setpointCm) setpointCm.value = cm.toFixed(1);
      this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.preset) === cm);
      });
      this.showSetpointZone(v);
    });
    st.bus.on('manual-pwm-change', (v) => {
      this.q('[data-out="manual-pwm"]').textContent = String(Math.round(v));
    });
  }

  // ── Actualización visual ──────────────────────────────────────────

  /** Actualizar el estado visual del panel según el modo activo */
  updateMode(mode: DataMode): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    this.root.querySelectorAll<HTMLElement>('[data-section]').forEach((sec) => {
      const allowed = (sec.dataset.section ?? '').split(',').map((s) => s.trim());
      const visible = allowed.includes(mode);
      sec.hidden = !visible;
      if (visible) fadeIn(sec);
    });
    this.q('[data-recorder]').hidden = mode === 'reproduccion';
    this.updateControlMode();
    this.updateRunning(this.state.running);
  }

  /** Aviso si el setpoint cae fuera del span útil */
  private showSetpointZone(sp: number): void {
    const el = this.q('[data-out="sp-zone"]');
    const zone = zoneOf(sp);
    el.hidden = zone === 'util';
    el.dataset.zone = zone;
    el.textContent = zone === 'muerta'
      ? `Zona muerta (< ${fmt(DEAD_ZONE_TOP_M * 100, 1)} cm): el carro se queda apoyado en los resortes y no llega.`
      : `⚠ Zona inestable (> ${fmt(UNSTABLE_ZONE_START_M * 100, 1)} cm): el efecto techo no deja que se mantenga.`;
  }

  /** Estado de la grabación en curso */
  setRecording(r: RecordingStatus): void {
    const state = this.q('[data-out="rec-state"]');
    const active = r.recording && !r.full;
    state.classList.toggle('active', active);
    this.q('[data-out="rec-label"]').textContent = r.full
      ? 'Límite alcanzado'
      : active ? 'Grabando' : r.count > 0 ? 'Detenida' : 'Sin datos';
    this.q('[data-out="rec-count"]').textContent = r.count.toLocaleString();
    this.q('[data-out="rec-duration"]').textContent = fmt(r.duration, 1);
    const canExport = r.count >= 2;
    this.q<HTMLButtonElement>('[data-action="export"]').disabled = !canExport;
    this.q<HTMLButtonElement>('[data-action="clear-rec"]').disabled = r.count === 0;
  }

  private updateControlMode(): void {
    const cm = this.state.controlMode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((btn) => {
      const active = btn.dataset.control === cm;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    this.root.querySelectorAll<HTMLElement>('[data-only]').forEach((el) => {
      el.hidden = el.dataset.only !== cm;
    });
    this.q('[data-out="control-title"]').textContent = cm === 'pid' ? 'Altura objetivo' : 'Potencia manual';
  }

  private updateRunning(running: boolean): void {
    const btn = this.q<HTMLButtonElement>('[data-action="toggle-run"]');
    const connectMode = this.state.mode === 'serial' || this.state.mode === 'wifi';
    btn.textContent = connectMode
      ? (running ? '⏏ Desconectar' : '🔌 Conectar')
      : (running ? '⏸ Pausar' : '▶ Iniciar');
    btn.classList.toggle('running', running);

    // En serial la configuración del puerto no se puede cambiar conectado
    const serialMode = this.state.mode === 'serial';
    for (const sel of [
      '[data-input="baud"]', '[data-input="serial-unit"]', '[data-input="serial-device"]', '[data-input="columns"]',
      '[data-input="serial-auto"]', '[data-action="serial-picker"]',
    ]) {
      this.q<HTMLInputElement>(sel).disabled = serialMode && running;
    }
    // En WiFi la URL no se puede cambiar conectado
    if (this.state.mode === 'wifi') {
      this.q<HTMLInputElement>('[data-input="wifi-url"]').disabled = running;
      this.q<HTMLInputElement>('[data-input="wifi-auto"]').disabled = running;
    }
  }

  private updateGainsSummary(): void {
    const s = this.state;
    this.q('[data-out="gains-summary"]').textContent =
      `${fmt(s.kp, 2)} · ${fmt(s.ki, 2)} · ${fmt(s.kd, 2)} · ${s.feedforward} µs`;
  }

  /** Métricas de la respuesta al escalón en curso (null = sin datos) */
  showMetrics(r: StepResult | null): void {
    const set = (name: string, text: string) => { this.q(`[data-metric="${name}"]`).textContent = text; };
    const badge = this.q('[data-out="settled"]');
    if (!r || Math.abs(r.step) < 0.01) {
      ['rise', 'overshoot', 'settling', 'error'].forEach((m) => set(m, '—'));
      badge.textContent = r ? 'sin escalón' : '—';
      badge.className = 'badge';
      return;
    }
    // El sobrepico solo tiene sentido tras cruzar el 90 % del salto
    const crossed = r.riseTime !== null || r.settled;
    set('rise', r.riseTime === null ? '…' : `${fmt(r.riseTime, 2)} s`);
    set('overshoot', crossed ? `${fmt(r.overshoot, 1)} %` : '…');
    set('settling', r.settlingTime === null ? '…' : `${fmt(r.settlingTime, 2)} s`);
    set('error', r.steadyError === null ? '…' : `${fmt(r.steadyError * 100, 1)} cm`);
    if (r.settled) {
      badge.textContent = '✓ Estable';
      badge.className = 'badge badge-success';
    } else {
      badge.textContent = this.state.running ? 'En curso' : 'Pausado';
      badge.className = this.state.running ? 'badge badge-info' : 'badge';
    }
  }

  /** Indicador de conexión serial */
  setSerialConnected(connected: boolean): void {
    const dot = this.q('[data-out="serial-dot"]');
    dot.classList.toggle('connected', connected);
    this.q('[data-out="serial-state"]').textContent = connected ? 'Conectado — recibiendo datos' : 'Desconectado';
    this.stopPulse?.();
    this.stopPulse = connected ? pulse(dot) : null;
    // Al desconectar, ocultar el eco y el estado para no dejar datos obsoletos.
    if (!connected) {
      this.q('[data-out="wifi-live"]').hidden = true;
      this.q('[data-out="wifi-info"]').hidden = true;
      this.q('[data-out="failsafe-banner"]').hidden = true;
    }
    this.updateLiveControls();
  }

  /** Indicador de conexión WiFi por estados (conectando / conectado / desconectado) */
  setWifiState(state: WifiConnectionState): void {
    const dot = this.q('[data-out="wifi-dot"]');
    dot.classList.toggle('connected', state === 'connected');
    dot.classList.toggle('connecting', state === 'connecting');
    this.q('[data-out="wifi-state"]').textContent =
      state === 'connected' ? 'Conectado — recibiendo datos'
        : state === 'connecting' ? 'Conectando… (reintento automático)'
          : 'Desconectado';
    this.stopWifiPulse?.();
    this.stopWifiPulse = state === 'connected' ? pulse(dot) : null;
    // Sin conexión: ocultar el eco y el estado para no dejar datos obsoletos.
    if (state !== 'connected') {
      this.q('[data-out="wifi-live"]').hidden = true;
      this.q('[data-out="wifi-info"]').hidden = true;
      this.q('[data-out="failsafe-banner"]').hidden = true;
    }
    this.updateLiveControls();
  }

  /** Indicador de conexión WiFi (booleano simple, para estados externos) */
  setWifiConnected(connected: boolean): void {
    this.setWifiState(connected ? 'connected' : 'disconnected');
  }

  /** ¿Está vivo el canal activo (WiFi o USB) para mandar comandos? */
  private isLiveConnected(): boolean {
    return (this.state.mode === 'wifi' && this.wifi.connected)
      || (this.state.mode === 'serial' && this.serial.connected);
  }

  /**
   * Enviar un comando al prototipo por el canal activo (WiFi o USB).
   * Devuelve false si el canal no está conectado (el botón debería estar
   * deshabilitado, pero esto evita comandos ciegos).
   */
  private sendLiveCommand(cmd: object): boolean {
    const mode = this.state.mode;
    if (mode === 'wifi' && this.wifi.connected) {
      this.wifi.sendCommand(cmd);
      return true;
    }
    if (mode === 'serial' && this.serial.connected) {
      this.serial.sendCommand(cmd);
      return true;
    }
    return false;
  }

  /** Habilitar las acciones de control solo cuando el canal activo está vivo */
  private updateLiveControls(): void {
    const liveConnected = this.isLiveConnected();
    for (const sel of [
      '[data-action="live-emergency"]', '[data-action="live-rearm"]',
      '[data-action="live-pid"]', '[data-action="live-step"]', '[data-action="live-stop"]',
    ]) {
      this.q<HTMLButtonElement>(sel).disabled = !liveConnected;
    }
  }

  /** Actualizar info del ESP32 (clientes, IP, UART, Modo, ganancias, failsafe) */
  setEspStatus(s: EspStatus): void {
    const info = this.q('[data-out="wifi-info"]');
    info.hidden = false;
    this.q('[data-out="esp-ip"]').textContent = s.ip ?? '—';
    this.q('[data-out="esp-clients"]').textContent = s.clients !== undefined ? String(s.clients) : '—';
    this.q('[data-out="esp-uptime"]').textContent = s.uptime_s !== undefined ? `${s.uptime_s} s` : '—';

    const failsafe = s.failsafe === true;
    const modeLabel = failsafe
      ? 'FAILSAFE'
      : ESP_MODE_LABELS[s.control_mode ?? ''] ?? (s.control_mode ? s.control_mode.toUpperCase() : '—');
    this.q('[data-out="esp-mode"]').textContent = failsafe ? '⚠ FAILSAFE' : modeLabel;
    this.q('[data-out="esp-gains"]').textContent =
      s.kp !== undefined && s.ki !== undefined && s.kd !== undefined
        ? `${fmt(s.kp, 2)} · ${fmt(s.ki, 2)} · ${fmt(s.kd, 2)}${s.u0 !== undefined ? ` · u₀ ${s.u0} µs` : ''}`
        : '—';

    // Eco en vivo de los parámetros que el prototipo tiene realmente
    const live = this.q('[data-out="wifi-live"]');
    live.hidden = false;
    this.q('[data-out="live-mode"]').textContent = modeLabel;
    if (s.setpoint_cm !== undefined) this.q('[data-out="live-setpoint"]').textContent = `${fmt(s.setpoint_cm, 1)} cm`;
    if (s.pwm !== undefined) this.q('[data-out="live-pwm"]').textContent = `${Math.round(s.pwm)} µs`;
    if (s.distancia_cm !== undefined) this.q('[data-out="live-height"]').textContent = `${fmt(s.distancia_cm, 1)} cm`;
    if (s.sensor_ok !== undefined) {
      const el = this.q('[data-out="live-sensor"]');
      el.textContent = s.sensor_ok ? (s.simulado ? 'Simulado' : 'Midiendo') : '⚠ Sin eco';
      el.classList.toggle('warn', !s.sensor_ok);
    }

    // Banner de failsafe: visible solo cuando el firmware cortó por seguridad
    this.q('[data-out="failsafe-banner"]').hidden = !failsafe;
  }

  /** Progreso del ensayo de escalón automático (null = ninguno) */
  showStepTest(view: StepTestView | null): void {
    const active = view !== null && ['despegue', 'estabilizando', 'escalon'].includes(view.phase);
    this.stepTestActive = active;
    const btn = this.q<HTMLButtonElement>('[data-action="live-step"]');
    btn.textContent = active ? '✕ Cancelar ensayo' : '⏺ Ensayo de escalón';
    btn.classList.toggle('btn-danger', active);
    this.q<HTMLInputElement>('[data-input="step-u0"]').disabled = active;
    const status = this.q('[data-out="step-status"]');
    status.hidden = view === null;
    status.textContent = view?.text ?? '';
    status.dataset.phase = view?.phase ?? '';
  }

  /** Valores de telemetría en vivo (20 Hz) para la tarjeta de "Valores en vivo" */
  setEspLive(heightM: number, pwmUs: number, rawM?: number): void {
    const live = this.q('[data-out="wifi-live"]');
    live.hidden = false;
    this.q('[data-out="live-height"]').textContent = `${fmt(heightM * 100, 1)} cm`;
    this.q('[data-out="live-raw"]').textContent = rawM === undefined ? 'sin eco' : `${fmt(rawM * 100, 1)} cm`;
    this.q('[data-out="live-pwm"]').textContent = `${Math.round(pwmUs)} µs`;
  }

  /** Progreso de la reproducción ∈ [0,1] */
  setReplayProgress(fraction: number): void {
    const seek = this.q<HTMLInputElement>('[data-input="seek"]');
    if (document.activeElement !== seek) {
      seek.value = String(Math.round(fraction * 1000));
      syncRange(seek);
    }
    this.q('[data-out="progress"]').textContent = `${Math.round(fraction * 100)} %`;
  }

  private showFileInfo(info: LoadedFile): void {
    const m = info.mapping;
    const name = (i: number | null, fallback: string) =>
      i === null ? null : m.headers?.[i] || `${fallback} (col. ${String.fromCharCode(65 + i)})`;
    const rows: [string, string][] = [
      ['Tiempo', m.time === null ? 'sin columna (50 Hz)' : `${name(m.time, 't')} · ${TIME_UNIT_LABELS[m.timeUnit]}`],
      ['Altura', `${name(m.height, 'altura')} · ${m.heightUnit}`],
      ['PWM', m.pwm === null ? 'sin columna' : String(name(m.pwm, 'pwm'))],
    ];
    if (m.setpoint !== null) rows.push(['Setpoint', String(name(m.setpoint, 'setpoint'))]);

    const el = this.q('[data-out="file-info"]');
    el.hidden = false;
    el.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'file-name';
    title.textContent = info.name;
    const summary = document.createElement('div');
    summary.className = 'hint';
    summary.textContent = `${info.samples} muestras · ${fmt(info.duration, 1)} s`
      + (info.skipped ? ` · ${info.skipped} filas descartadas` : '');
    const dl = document.createElement('dl');
    dl.className = 'mapping';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    el.append(title, summary, dl);

    this.q<HTMLInputElement>('[data-input="seek"]').disabled = false;
    this.setReplayProgress(0);
  }
}
