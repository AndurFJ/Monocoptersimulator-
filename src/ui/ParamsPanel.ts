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
import type { LengthUnit } from '../data/parseTable';
import type { StepResult } from '../core/StepMetrics';
import {
  H_MAX, PWM_MIN, PWM_MAX, DEFAULT_KP, DEFAULT_KI, DEFAULT_KD,
  DEAD_ZONE_FRACTION, UNSTABLE_ZONE_FRACTION, DEAD_ZONE_TOP_M, UNSTABLE_ZONE_START_M,
} from '../physics/constants';
import { zoneOf } from '../physics/zones';
import { hoverThrottle } from '../physics/MonocopterModel';
import { fadeIn, pulse } from './animations';

export interface ParamsPanelDeps {
  state: AppState;
  replay: ReplaySource;
  serial: SerialSource;
  /** Descargar la grabación actual como Excel para PID Tuner */
  onExportRecording: () => void;
  /** Descartar la grabación actual */
  onClearRecording: () => void;
}

export interface RecordingStatus {
  count: number;
  duration: number;
  recording: boolean;
  full: boolean;
}

const TIME_UNIT_LABELS = { s: 's', ms: 'ms', clock: 'hh:mm:ss' } as const;
const SETPOINT_PRESETS_CM = [10, 20, 30, 40, 50, 60];

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
  private stopPulse: (() => void) | null = null;
  private readonly deps: ParamsPanelDeps;

  constructor(container: HTMLElement, deps: ParamsPanelDeps) {
    this.deps = deps;
    this.state = deps.state;
    this.replay = deps.replay;
    this.serial = deps.serial;
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
        </div>

        <div class="transport">
          <button class="btn btn-primary" data-action="toggle-run" title="Espacio">▶ Iniciar</button>
          <button class="btn btn-icon" data-action="reset" title="Reiniciar (R)" aria-label="Reiniciar">⟲</button>
        </div>
      </header>

      <div class="sidebar-body">
        <!-- ── Simulación ── -->
        <section class="mode-section" data-section="simulacion">
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
                <span class="range-mark" style="--at: ${hoverThrottle()}" title="Empuje = peso">equilibrio</span>
                <div class="range-scale"><span>${PWM_MIN}</span><span>${PWM_MAX} µs</span></div>
              </div>
              <p class="hint">Sin realimentación: el carro sube si el empuje supera el peso y cae si no.</p>
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
              <label class="gain"><span>K<sub>p</sub></span><input type="number" data-gain="kp" step="0.1" min="0" value="${s.kp}" /></label>
              <label class="gain"><span>K<sub>i</sub></span><input type="number" data-gain="ki" step="0.05" min="0" value="${s.ki}" /></label>
              <label class="gain"><span>K<sub>d</sub></span><input type="number" data-gain="kd" step="0.05" min="0" value="${s.kd}" /></label>
              <label class="gain" title="Potencia base sumada a la salida del PID">
                <span>u<sub>0</sub></span><input type="number" data-input="feedforward" step="0.01" min="0" max="1" value="${s.feedforward.toFixed(3)}" />
              </label>
            </div>
            <p class="hint">u₀ = potencia de equilibrio (${fmt(hoverThrottle(), 3)}). Con 0 el PID es exactamente el de la spec.</p>
            <button type="button" class="btn btn-ghost btn-sm" data-action="reset-gains">Restaurar valores</button>
          </details>
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
              <span class="field-label">Columnas de cada línea</span>
              <input type="text" data-input="columns" value="${this.serial.columns.join(', ')}" spellcheck="false" />
            </label>
            <p class="hint">Nombres: <code>t</code> (s), <code>ms</code>, <code>altura</code>, <code>pwm</code>, <code>setpoint</code>, <code>_</code> (ignorar). Las líneas con etiquetas como <code>h:12.3,pwm:1500</code> se leen solas.</p>
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
      if (!st.running) st.setRunning(true);
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
      ff.value = st.feedforward.toFixed(3);
    });
    this.q('[data-action="reset-gains"]').addEventListener('click', () => {
      st.setPIDGains(DEFAULT_KP, DEFAULT_KI, DEFAULT_KD);
      st.setFeedforward(hoverThrottle());
      const defaults = [DEFAULT_KP, DEFAULT_KI, DEFAULT_KD];
      gainInputs.forEach((input, k) => { input.value = String(defaults[k]); });
      ff.value = st.feedforward.toFixed(3);
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

    // Grabación
    this.q('[data-action="export"]').addEventListener('click', () => this.deps.onExportRecording());
    this.q('[data-action="clear-rec"]').addEventListener('click', () => this.deps.onClearRecording());

    // Reflejar cambios del estado
    st.bus.on('mode-change', (m) => this.updateMode(m));
    st.bus.on('running-change', (r) => this.updateRunning(r));
    st.bus.on('control-mode-change', () => this.updateControlMode());
    st.bus.on('pid-change', () => this.updateGainsSummary());
    st.bus.on('feedforward-change', () => this.updateGainsSummary());
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
      const visible = sec.dataset.section === mode;
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
    const serialMode = this.state.mode === 'serial';
    btn.textContent = serialMode
      ? (running ? '⏏ Desconectar' : '🔌 Conectar')
      : (running ? '⏸ Pausar' : '▶ Iniciar');
    btn.classList.toggle('running', running);

    // En serial la configuración del puerto no se puede cambiar conectado
    for (const sel of ['[data-input="baud"]', '[data-input="serial-unit"]', '[data-input="columns"]']) {
      this.q<HTMLInputElement>(sel).disabled = serialMode && running;
    }
  }

  private updateGainsSummary(): void {
    const s = this.state;
    this.q('[data-out="gains-summary"]').textContent =
      `${fmt(s.kp, 2)} · ${fmt(s.ki, 2)} · ${fmt(s.kd, 2)}`;
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
