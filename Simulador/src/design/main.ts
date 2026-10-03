/**
 * Página de diseño del controlador (Etapa 2): del ensayo de escalón a los tres PID.
 *
 *   1. Ensayo      → cargar el escalón (o el ejemplo de la guía)
 *   2. Tres puntos → K, R, ζ, ωn, θ, caso de amortiguamiento, ke, B, kF
 *   3. Verificar   → Fit del modelo (tres puntos, ajuste fino y FOPDT de Fit 3)
 *   4. Tres PID    → Ziegler–Nichols, Lambda y la regla del grupo
 *   5. Gemelo      → el PID del firmware sobre el modelo, perfil P2, métricas vs. especificaciones
 *
 * Cada cálculo muestra la fórmula, los números sustituidos y qué significa.
 */

import '../styles/design.css';
import type uPlot from 'uplot';
import { parseTable } from '../data/parseTable';
import { simulate } from '../control/sopdt';
import type { Fopdt, Sopdt } from '../control/sopdt';
import {
  TABLE_1, threePoint, analyzeStep, CASE_LABELS, R_DOMINANT,
} from '../control/threePoint';
import type { StepAnalysis, StepRecord, ThreePointInput, ThreePointResult } from '../control/threePoint';
import { refineSopdt, modelFit } from '../control/refine';
import {
  zieglerNichols, lambdaTuning, groupRule, isaToParallel, GROUP_RULES,
} from '../control/tuning';
import type { GroupRule, IsaGains } from '../control/tuning';
import { runTwin, twinMetrics, SPECS } from '../control/twin';
import type { TwinConfig, TwinMetrics, TwinRun } from '../control/twin';
import { P2_STEPS_CM, P2_SEGMENT_S } from '../core/SetpointProfile';
import { makePlot, vline, hline, C } from './plots';

// ── Estado ──────────────────────────────────────────────────────

interface Source { name: string; rec: StepRecord; example: boolean }

type RuleKey = 'zn' | 'lambda' | 'group';

const st = {
  source: null as Source | null,
  analysis: null as StepAnalysis | null,
  /** Datos del paso 2 (del ensayo o escritos a mano) */
  manual: { du: 150, dy: 30, t10: 0.53, t50: 1.19, t90: 2.71 } as ThreePointInput,
  massG: 120 as number | null,
  refined: null as { model: Sopdt; fit: number } | null,
  useRefined: true,
  fopdt: { K: 0.2, tau: 1.01, t0: 0.48 } as Fopdt,
  lambdaMult: 2,
  // AMIGO por defecto: SIMC con τc = θ da lo mismo que Lambda con λ = θ (con polos reales)
  // o un PI sin derivada (con polos complejos); AMIGO siempre es un PID distinto
  group: 'amigo' as GroupRule,
  taucMult: 1,
  twin: { u0: 1400, y0: 20, uMin: 1100, uMax: 1800, noise: false },
};

const SAVE_KEY = 'diseno-etapa2-v1';
try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
  if (saved) {
    if (typeof saved.lambdaMult === 'number') st.lambdaMult = saved.lambdaMult;
    if (saved.group in GROUP_RULES) st.group = saved.group;
    if (typeof saved.taucMult === 'number') st.taucMult = saved.taucMult;
  }
} catch { /* sin almacenamiento: valores por defecto */ }
const save = () => {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ lambdaMult: st.lambdaMult, group: st.group, taucMult: st.taucMult }));
  } catch { /* nada */ }
};

// ── Utilidades de formato ───────────────────────────────────────

const f = (v: number | null | undefined, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ── Ejemplo de la guía como ensayo (para que todos los pasos funcionen) ──

function exampleRecord(): StepRecord {
  const model: Sopdt = { K: 0.2, zeta: 1.21, wn: 2.03, theta: 0.26 };
  const t = Array.from({ length: 27 / 0.05 + 1 }, (_, i) => Math.round(i * 5) / 100);
  const u = t.map((x) => (x >= 3 && x < 15 ? 1550 : 1400));
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const noise = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd()) * 0.25;
  const y = simulate(model, t, u, 1400, 20).map((v) => Math.round((v + noise()) * 100) / 100);
  return { t, y, u };
}

// ── Página ──────────────────────────────────────────────────────

function renderShell(): void {
  $('#app').innerHTML = `
    <header class="d-top">
      <a class="d-brand" href="./" title="Volver al simulador">
        <span class="brand-mark" aria-hidden="true">◈</span>
        <div><b>Diseño del controlador</b><small>Etapa 2 · segundo orden, tres PID y gemelo digital</small></div>
      </a>
      <nav class="d-nav" aria-label="Pasos">
        ${['Ensayo', 'Tres puntos', 'Verificar', 'Tres PID', 'Gemelo'].map((n, i) => `<a href="#paso${i + 1}"><span>${i + 1}</span>${n}</a>`).join('')}
      </nav>
      <a class="d-back" href="./">← Simulador</a>
    </header>

    <main class="d-main">
      <section class="d-intro">
        <h1>Del ensayo de escalón a los tres controladores</h1>
        <p>Esta página hace, paso a paso, las cuentas de las secciones 3 y 4 de la guía. En cada paso verás
          <b>la fórmula</b>, <b>tus números sustituidos</b> y <b>qué significa</b>. Empieza con el ejemplo resuelto de la
          guía para comprobar que todo coincide; después carga tu ensayo.</p>
      </section>

      <!-- 1 · Ensayo -->
      <section class="d-step" id="paso1">
        <header class="d-step-head"><span class="d-num">1</span>
          <div><h2>El ensayo de escalón</h2><p>Con el carro quieto en u₀ se sube el PWM de golpe y se mide cómo responde la altura.</p></div>
        </header>
        <div class="d-grid">
          <div class="d-col">
            <label class="dropzone" data-drop>
              <input type="file" accept=".xlsx,.xls,.csv,.txt" data-input="file" class="visually-hidden" />
              <span class="dropzone-icon" aria-hidden="true">⇪</span>
              <span><strong>Elige tu ensayo</strong> o arrástralo aquí</span>
              <span class="hint">.xlsx · .csv con tiempo, altura y PWM (p. ej. G#_datos_escalon2_1.csv)</span>
            </label>
            <button type="button" class="btn btn-sm" data-action="example">Usar el ejemplo de la guía</button>
            <div class="d-file" data-out="file"></div>
            <ul class="d-warnings" data-out="warnings"></ul>
            <label class="field d-mass">
              <span class="field-label">Masa del carro (pésalo)</span>
              <div class="input-unit"><input type="number" data-input="mass" min="1" step="1" inputmode="decimal" /><span>g</span></div>
            </label>
            <div class="d-explain">
              <b>¿Qué buscamos?</b>
              <p>Toda la información del modelo está en la <em>forma</em> de esta curva: <b>cuánto</b> sube por cada µs
                (ganancia K), <b>cuánto tarda en empezar</b> a moverse (tiempo muerto θ) y <b>cómo llega</b> al valor final:
                de frente, despacio o pasándose y volviendo (eso lo dice el amortiguamiento ζ).</p>
              <p>La guía pide el carro <b>quieto</b> al menos 3 s antes del escalón: si ya se está moviendo, los tiempos
                que se miden después quedan corridos.</p>
            </div>
          </div>
          <div class="d-col">
            <div class="d-chart-head"><b>Altura y PWM del ensayo</b>
              <span class="d-legend"><i style="--c:${C.y}"></i>altura <i style="--c:${C.u}"></i>PWM <i class="dash" style="--c:${C.mark}"></i>y₀ e y∞</span></div>
            <div class="d-plot" data-plot="test"></div>
            <dl class="d-facts" data-out="facts"></dl>
          </div>
        </div>
      </section>

      <!-- 2 · Tres puntos -->
      <section class="d-step" id="paso2">
        <header class="d-step-head"><span class="d-num">2</span>
          <div><h2>Método de tres puntos (10 – 50 – 90 %)</h2><p>Se leen ζ, ωn y θ de la forma de la curva normalizada.</p></div>
          <span class="d-case" data-out="case"></span>
        </header>
        <div class="d-grid">
          <div class="d-col">
            <div class="d-explain">
              <b>Normalizar la curva</b>
              <p>Para comparar formas sin importar cuánto subió el carro se usa F(t) = (y − y₀)/Δy, que va de 0 (antes
                del escalón) a 1 (valor final). Se miden los instantes, contados desde el escalón, en que F pasa por
                <b>0.1</b>, <b>0.5</b> y <b>0.9</b>.</p>
            </div>
            <div class="d-inputs">
              <span class="d-inputs-title">Datos medidos <button type="button" class="link" data-action="reset-manual" hidden>↺ los del ensayo</button></span>
              ${[['du', 'Δu', 'µs'], ['dy', 'Δy', 'cm'], ['t10', 't₁₀', 's'], ['t50', 't₅₀', 's'], ['t90', 't₉₀', 's']].map(([k, l, unit]) => `
                <label><span>${l} [${unit}]</span><input type="number" step="any" data-manual="${k}" /></label>`).join('')}
              <p class="hint">Puedes escribir aquí tus tiempos medidos a mano (la guía pide el cálculo manual del ensayo 1) y comprobar el resultado.</p>
            </div>
          </div>
          <div class="d-col">
            <div class="d-chart-head"><b>Curva normalizada F(t)</b>
              <span class="d-legend"><i style="--c:${C.y}"></i>medida <i style="--c:${C.model}"></i>modelo de tres puntos</span></div>
            <div class="d-plot" data-plot="norm"></div>
          </div>
        </div>
        <ol class="calc" data-out="calc"></ol>
        <details class="d-table1">
          <summary>Ver la Tabla 1 de la guía (las filas usadas se resaltan)</summary>
          <div data-out="table1"></div>
        </details>
      </section>

      <!-- 3 · Verificar -->
      <section class="d-step" id="paso3">
        <header class="d-step-head"><span class="d-num">3</span>
          <div><h2>¿El modelo representa al banco?</h2><p>Se simula cada modelo con el PWM del ensayo y se compara con la altura medida.</p></div>
          <span class="d-badge" data-out="fit-badge"></span>
        </header>
        <div class="d-grid">
          <div class="d-col">
            <div class="d-chart-head"><b>Medida contra modelos</b>
              <span class="d-legend"><i style="--c:${C.y}"></i>medida <i style="--c:${C.model}"></i>tres puntos <i style="--c:${C.refined}"></i>ajuste fino <i class="dash" style="--c:${C.fopdt}"></i>FOPDT (Fit 3)</span></div>
            <div class="d-plot" data-plot="fit"></div>
          </div>
          <div class="d-col">
            <table class="d-table" data-out="fit-table"></table>
            <label class="field-check"><input type="checkbox" data-input="use-refined" /> Usar el modelo del ajuste fino para sintonizar</label>
            <div class="d-explain">
              <b>¿Qué es el Fit?</b>
              <p>Dice qué tanto se parece la curva del modelo a la medida: 100 % sería idéntica, 0 % es tan malo como
                una línea plana en el promedio. La guía pide <b>Fit ≥ 80 %</b>.</p>
              <p>El método de tres puntos usa solo tres puntos de la curva. El <b>ajuste fino</b> mueve K, ζ, ωn y θ
                hasta que el modelo pase lo más cerca posible de <em>todos</em> los puntos (mínimos cuadrados, lo mismo
                que hace <code>fminsearch</code> en MATLAB). Ese es el modelo final de la guía (<code>modelo_so.mat</code>).</p>
              <p>El <b>FOPDT de Fit 3</b> (Etapa 1) se calcula sobre el mismo ensayo con los instantes del 28.3 % y 63.2 %;
                Ziegler–Nichols lo necesita.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 4 · Tres PID -->
      <section class="d-step" id="paso4">
        <header class="d-step-head"><span class="d-num">4</span>
          <div><h2>Los tres controladores PID</h2><p>Todos en forma ISA: C(s) = Kc·[1 + 1/(Ti·s) + Td·s], el mismo firmware sirve para los tres.</p></div>
        </header>
        <div class="d-controls">
          <label class="field"><span class="field-label">λ de Lambda tuning <output data-out="lambda-val"></output></span>
            <div class="segmented" data-out="lambda-seg">
              ${[1, 1.5, 2, 2.5, 3].map((m) => `<button type="button" data-lambda="${m}">${m === 1 ? 'θ' : `${m}θ`}</button>`).join('')}
            </div></label>
          <label class="field"><span class="field-label">Regla del grupo</span>
            <select data-input="group">${Object.entries(GROUP_RULES).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join('')}</select></label>
          <label class="field" data-out="tauc-field"><span class="field-label">τc de SIMC <output data-out="tauc-val"></output></span>
            <div class="segmented">${[0.5, 1, 1.5, 2].map((m) => `<button type="button" data-tauc="${m}">${m === 1 ? 'θ' : `${m}θ`}</button>`).join('')}</div></label>
          <div class="d-fopdt">
            <span class="field-label">FOPDT de Fit 3 (para Ziegler–Nichols)</span>
            <div class="d-inputs d-inputs-row">
              ${[['K', 'K', 'cm/µs'], ['tau', 'τ', 's'], ['t0', 't₀', 's']].map(([k, l, unit]) => `
                <label><span>${l} [${unit}]</span><input type="number" step="any" data-fopdt="${k}" /></label>`).join('')}
            </div>
          </div>
        </div>
        <table class="d-table d-gains" data-out="gains"></table>
        <div class="d-rules" data-out="rules"></div>
      </section>

      <!-- 5 · Gemelo -->
      <section class="d-step" id="paso5">
        <header class="d-step-head"><span class="d-num">5</span>
          <div><h2>Gemelo digital</h2><p>El PID del firmware (sección 4.4) corriendo cada 50 ms sobre el modelo, con el perfil de P2.</p></div>
        </header>
        <div class="d-controls">
          ${[['u0', 'u₀ (hovering del modelo)', 'µs'], ['y0', 'y₀ en ese u₀', 'cm'], ['uMin', 'Saturación mínima', 'µs'], ['uMax', 'Saturación máxima', 'µs']].map(([k, l, unit]) => `
            <label class="field"><span class="field-label">${l}</span><div class="input-unit"><input type="number" step="any" data-twin="${k}" /><span>${unit}</span></div></label>`).join('')}
          <label class="field-check d-noise"><input type="checkbox" data-input="noise" /> Ruido del sensor (±0.4 cm)</label>
        </div>
        <div class="d-grid">
          <div class="d-col">
            <div class="d-chart-head"><b>Altura con cada regla</b>
              <span class="d-legend"><i class="dash" style="--c:${C.sp}"></i>setpoint <i style="--c:${C.zn}"></i>Z–N <i style="--c:${C.lambda}"></i>Lambda <i style="--c:${C.group}"></i><span data-out="group-name">grupo</span></span></div>
            <div class="d-plot" data-plot="twin-y"></div>
          </div>
          <div class="d-col">
            <div class="d-chart-head"><b>PWM que pide cada regla</b>
              <span class="d-legend"><i class="dash" style="--c:${C.mark}"></i>saturación</span></div>
            <div class="d-plot" data-plot="twin-u"></div>
          </div>
        </div>
        <table class="d-table d-metrics" data-out="metrics"></table>
        <details class="d-segments"><summary>Ver los tres tramos de cada regla</summary><div data-out="segments"></div></details>
        <div class="d-explain d-explain-wide">
          <b>Cómo leer la tabla</b>
          <p><b>Mp</b> (sobreimpulso): cuánto se pasa del setpoint, en % del salto (20 → 40 cm: 10 % son 2 cm). <b>ts</b>
            (establecimiento al 2 %): cuánto tarda en quedarse a menos del 2 % del salto. <b>IAE</b>: el área entre el setpoint
            y la altura: menos es mejor. <b>|e|</b>: el error que queda al final (promedio de los últimos 2 s).
            <b>u</b>: el rango de PWM que usa; si toca la saturación, el controlador pide más de lo que el motor puede dar.</p>
          <p>Especificaciones de la guía: Mp ≤ ${SPECS.mp} %, ts ≤ ${SPECS.ts} s, |e| ≤ ${SPECS.ess} cm y sin saturar. No se exige
            que las tres cumplan: se exige <b>medirlas, compararlas y elegir</b> el controlador final con argumentos.</p>
        </div>
      </section>
    </main>
    <div id="toasts" aria-live="polite"></div>
  `;
}

// ── Gráficas ────────────────────────────────────────────────────

let plots: Record<string, uPlot> = {};
/** Marcas que dibujan los hooks (se actualizan antes de cada redibujo) */
const marks = {
  test: null as null | { tStep: number; y0: number; yInf: number },
  norm: null as null | { t10: number; t50: number; t90: number },
  twin: { uMin: 1100, uMax: 1800 },
};

function createPlots(): void {
  plots = {
    test: makePlot($('[data-plot="test"]'), {
      height: 230,
      series: [{ label: 'Altura', color: C.y }, { label: 'PWM', color: C.u, scale: 'u', width: 1.2 }],
      yAxes: [{ scale: 'y', label: 'altura [cm]' }, { scale: 'u', label: 'PWM [µs]' }],
      draw: (u) => {
        const m = marks.test;
        if (!m) return;
        vline(u, m.tStep, C.mark, 'escalón');
        hline(u, m.y0, C.mark, 'y₀');
        hline(u, m.yInf, C.mark, 'y∞');
      },
    }),
    norm: makePlot($('[data-plot="norm"]'), {
      height: 260,
      xLabel: 't − t_escalón [s]',
      series: [{ label: 'Medida', color: C.y, points: true, width: 0 }, { label: 'Modelo', color: C.model, width: 2 }],
      yAxes: [{ scale: 'y', label: 'F(t)', digits: 1 }],
      draw: (u) => {
        for (const p of [0.1, 0.5, 0.9]) hline(u, p, 'rgba(251,191,36,0.6)', `${p * 100} %`);
        const m = marks.norm;
        if (!m) return;
        vline(u, m.t10, C.sp, 't₁₀');
        vline(u, m.t50, C.sp, 't₅₀');
        vline(u, m.t90, C.sp, 't₉₀');
      },
    }),
    fit: makePlot($('[data-plot="fit"]'), {
      height: 260,
      series: [
        { label: 'Medida', color: C.y, points: true, width: 0 },
        { label: 'Tres puntos', color: C.model },
        { label: 'Ajuste fino', color: C.refined, width: 2 },
        { label: 'FOPDT', color: C.fopdt, dash: [5, 4] },
      ],
      yAxes: [{ scale: 'y', label: 'altura [cm]' }],
    }),
    'twin-y': makePlot($('[data-plot="twin-y"]'), {
      height: 260,
      series: [
        { label: 'Setpoint', color: C.sp, dash: [6, 4] },
        { label: 'Z–N', color: C.zn },
        { label: 'Lambda', color: C.lambda, width: 2 },
        { label: 'Grupo', color: C.group },
      ],
      yAxes: [{ scale: 'y', label: 'altura [cm]' }],
    }),
    'twin-u': makePlot($('[data-plot="twin-u"]'), {
      height: 260,
      series: [
        { label: 'Z–N', color: C.zn, width: 1.2 },
        { label: 'Lambda', color: C.lambda, width: 1.5 },
        { label: 'Grupo', color: C.group, width: 1.2 },
      ],
      yAxes: [{ scale: 'y', label: 'PWM [µs]' }],
      draw: (u) => {
        hline(u, marks.twin.uMin, C.mark, `${marks.twin.uMin}`);
        hline(u, marks.twin.uMax, C.mark, `${marks.twin.uMax}`);
      },
    }),
  };
}

// ── Cálculo ─────────────────────────────────────────────────────

interface Computed {
  r: ThreePointResult;
  model: Sopdt;
  gains: Record<RuleKey, IsaGains>;
  twin: TwinConfig;
  runs: Record<RuleKey, TwinRun>;
  metrics: Record<RuleKey, TwinMetrics>;
}

function compute(): Computed {
  const r = threePoint({ ...st.manual, massKg: st.massG ? st.massG / 1000 : undefined });
  const model = st.useRefined && st.refined && !manualEdited() ? st.refined.model : r.model;
  const lambda = st.lambdaMult * model.theta;
  const gains: Record<RuleKey, IsaGains> = {
    zn: zieglerNichols(st.fopdt),
    lambda: lambdaTuning(model, lambda),
    group: groupRule(st.group, model, st.fopdt, st.taucMult * model.theta),
  };
  const twin: TwinConfig = {
    plant: model, u0: st.twin.u0, y0: st.twin.y0, ts: 0.05, uMin: st.twin.uMin, uMax: st.twin.uMax, N: 10,
    profile: P2_STEPS_CM, segment: P2_SEGMENT_S, noise: st.twin.noise ? 0.4 : 0,
  };
  const runs = { zn: runTwin(gains.zn, twin), lambda: runTwin(gains.lambda, twin), group: runTwin(gains.group, twin) };
  const metrics = {
    zn: twinMetrics(runs.zn, twin), lambda: twinMetrics(runs.lambda, twin), group: twinMetrics(runs.group, twin),
  };
  return { r, model, gains, twin, runs, metrics };
}

/** ¿El usuario cambió a mano los datos del paso 2 respecto a los del ensayo? */
function manualEdited(): boolean {
  const a = st.analysis;
  if (!a) return false;
  const m = st.manual;
  return Math.abs(m.du - a.du) > 1e-6 || Math.abs(m.dy - a.dy) > 1e-6
    || Math.abs(m.t10 - a.t10) > 1e-6 || Math.abs(m.t50 - a.t50) > 1e-6 || Math.abs(m.t90 - a.t90) > 1e-6;
}

// ── Carga de datos ──────────────────────────────────────────────

function loadSource(src: Source): void {
  st.source = src;
  const a = analyzeStep(src.rec, st.massG ? st.massG / 1000 : undefined);
  st.analysis = a;
  st.refined = null;
  if (a) {
    st.manual = { du: a.du, dy: a.dy, t10: a.t10, t50: a.t50, t90: a.t90, mp: a.mp || undefined };
    st.fopdt = { ...a.fopdt };
    // Operación del modelo = la del ensayo; saturación de la guía o la propia del banco
    st.twin.u0 = Math.round(a.u0);
    st.twin.y0 = Math.round(a.y0 * 10) / 10;
    const bench = a.u0 > 1600;
    st.twin.uMin = bench ? 1550 : 1100;
    st.twin.uMax = bench ? 1980 : 1800;
    // Ajuste fino sobre el escalón (3 s antes hasta el fin del tramo)
    const w = windowOf(src.rec, a);
    st.refined = refineSopdt(a.result.model, w);
  } else {
    toast('No encontré un escalón de PWM en el archivo (¿tiene columna de PWM?).', 'error');
  }
  fillInputs();
  render();
}

function windowOf(rec: StepRecord, a: StepAnalysis) {
  const idx = rec.t.map((_, i) => i).filter((i) => rec.t[i] >= a.tStep - 3 && rec.t[i] <= a.tEnd);
  return { t: idx.map((i) => rec.t[i]), y: idx.map((i) => rec.y[i]), u: idx.map((i) => rec.u[i]), u0: a.u0, y0: a.y0 };
}

async function loadFile(file: File): Promise<void> {
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false });
    const { samples } = parseTable(rows);
    loadSource({
      name: file.name,
      example: false,
      rec: { t: samples.map((s) => s.t), y: samples.map((s) => s.height * 100), u: samples.map((s) => s.pwm) },
    });
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'error');
  }
}

// ── Dibujo ──────────────────────────────────────────────────────

function render(): void {
  const c = compute();
  renderTest();
  renderThreePoint(c);
  renderFit(c);
  renderGains(c);
  renderTwin(c);
}

function renderTest(): void {
  const src = st.source;
  const a = st.analysis;
  $('[data-out="file"]').innerHTML = src
    ? `<b>${esc(src.name)}</b><span class="hint">${src.rec.t.length} muestras · ${f(src.rec.t[src.rec.t.length - 1], 1)} s</span>`
    : '<span class="hint">Sin ensayo cargado: se usan los tiempos del ejemplo resuelto de la guía.</span>';
  $('[data-out="warnings"]').innerHTML = (a?.warnings ?? []).map((w) => `<li>⚠ ${esc(w)}</li>`).join('');
  $('[data-out="facts"]').innerHTML = a ? `
    <div><dt>Escalón</dt><dd>t = ${f(a.tStep, 2)} s</dd></div>
    <div><dt>u₀ → u₁</dt><dd>${f(a.u0, 0)} → ${f(a.u1, 0)} µs</dd></div>
    <div><dt>Δu</dt><dd>${f(a.du, 0)} µs</dd></div>
    <div><dt>y₀ → y∞</dt><dd>${f(a.y0, 2)} → ${f(a.yInf, 2)} cm</dd></div>
    <div><dt>Δy</dt><dd>${f(a.dy, 2)} cm</dd></div>
    <div><dt>Quieto antes</dt><dd class="${Math.abs(a.preSlope) * 2 > 0.1 * Math.abs(a.dy) ? 'bad' : 'ok'}">${f(a.preSlope, 2)} cm/s</dd></div>` : '';
  marks.test = a ? { tStep: a.tStep, y0: a.y0, yInf: a.yInf } : null;
  $('[data-plot="test"]').classList.toggle('empty', !src);
  plots.test.setData(src ? [src.rec.t, src.rec.y, src.rec.u] as unknown as uPlot.AlignedData : [[], [], []] as unknown as uPlot.AlignedData);
}

function renderThreePoint(c: Computed): void {
  const { r } = c;
  const m = st.manual;
  const tb = r.table;
  const caseClass = r.dampingCase === 'subamortiguado' ? 'sub' : r.dampingCase === 'critico' ? 'crit' : 'over';
  $('[data-out="case"]').innerHTML = `<span class="case-${caseClass}">${CASE_LABELS[r.dampingCase]}</span>`;
  $('[data-action="reset-manual"]').hidden = !manualEdited();

  const interp = tb.lo && tb.hi
    ? `R = ${f(r.R)} cae entre ζ = ${tb.lo.zeta} (R = ${tb.lo.R}) y ζ = ${tb.hi.zeta} (R = ${tb.hi.R}).<br>
       fracción = (${f(r.R)} − ${tb.lo.R}) / (${tb.hi.R} − ${tb.lo.R}) = <b>${f(tb.frac)}</b><br>
       ζ = ${tb.lo.zeta} + ${f(tb.frac)} × ${f(tb.hi.zeta - tb.lo.zeta, 1)} = <b>${f(tb.zeta)}</b>`
    : tb.outOfRange === 'bajo'
      ? `R = ${f(r.R)} es menor que 0.862 (la primera fila): ζ < 0.3, fuera de la tabla.${r.zetaMp !== null ? ' Se usa el sobreimpulso (paso 5).' : ''}`
      : `R = ${f(r.R)} ≥ ${R_DOMINANT}: el segundo polo es tan rápido que se confunde con el retardo. ζ no se puede identificar con un escalón (se toma la última fila, ζ = 2).`;

  const fromMp = r.zetaMp !== null && tb.outOfRange === 'bajo';
  const xs = tb.lo && tb.hi
    ? `Interpolando igual en la tabla:<br>
       x₁₀ = ${tb.lo.x10} + ${f(tb.frac)} × (${tb.hi.x10} − ${tb.lo.x10}) = ${f(r.x.x10)}<br>
       x₅₀ = ${tb.lo.x50} + ${f(tb.frac)} × (${tb.hi.x50} − ${tb.lo.x50}) = ${f(r.x.x50)}<br>
       x₉₀ = ${tb.lo.x90} + ${f(tb.frac)} × (${tb.hi.x90} − ${tb.lo.x90}) = ${f(r.x.x90)}`
    : fromMp
      ? `Con ζ = ${f(r.zeta)} (del sobreimpulso), de la respuesta exacta: x₁₀ = ${f(r.x.x10)}, x₅₀ = ${f(r.x.x50)}, x₉₀ = ${f(r.x.x90)}`
      : `Fila ζ = ${f(r.zeta, 1)}: x₁₀ = ${f(r.x.x10)}, x₅₀ = ${f(r.x.x50)}, x₉₀ = ${f(r.x.x90)}`;

  const polesText = r.poles.map((p) => (p.im ? `${f(p.re, 2)} ${p.im > 0 ? '+' : '−'} ${f(Math.abs(p.im), 2)}j` : f(p.re, 2))).join(' y ');
  const mass = st.massG;

  const rows: { n: string; title: string; result: string; formula: string; why: string }[] = [
    {
      n: '1', title: 'Ganancia', result: `K = ${f(r.K, 4)} cm/µs`,
      formula: `K = Δy / Δu = ${f(m.dy, 2)} / ${f(m.du, 0)} = <b>${f(r.K, 4)}</b> cm/µs`,
      why: `Por cada 10 µs extra de PWM, el carro termina ${f(r.K * 10, 2)} cm más arriba. Se calcula igual que en Fit 3 de la Etapa 1.`,
    },
    {
      n: '2', title: 'Razón de tiempos → ζ', result: `R = ${f(r.R)}  →  ζ = ${f(r.zeta)}`,
      formula: `R = (t₉₀ − t₅₀) / (t₅₀ − t₁₀) = (${f(m.t90)} − ${f(m.t50)}) / (${f(m.t50)} − ${f(m.t10)}) = <b>${f(r.R)}</b><br>${interp}
        ${r.zetaExact !== null ? `<br><span class="hint">Valor exacto sin interpolar: ζ = ${f(r.zetaExact)}.</span>` : ''}`,
      why: 'R compara la segunda mitad de la subida (del 50 al 90 %) con la primera (del 10 al 50 %). Un sistema muy amortiguado "se arrastra" al final (R grande, hasta 2.7); uno poco amortiguado llega rápido y se pasa (R pequeño). Lo importante: R no depende de qué tan rápido sea el sistema (ωn) ni del retardo (θ), solo de ζ. Por eso con R se lee ζ en la Tabla 1.',
    },
    {
      n: '3', title: 'Frecuencia natural', result: `ωn = ${f(r.wn)} rad/s`,
      formula: `${xs}<br>ωn = (x₉₀ − x₁₀) / (t₉₀ − t₁₀) = (${f(r.x.x90)} − ${f(r.x.x10)}) / (${f(m.t90)} − ${f(m.t10)}) = <b>${f(r.wn)}</b> rad/s`,
      why: 'La Tabla 1 dice en qué "tiempo adimensional" x = ωn·(t − θ) el sistema estándar pasa por el 10 % y el 90 %. En el banco medimos esos mismos instantes en segundos; dividir uno entre otro dice qué tan rápido "corre" el sistema. Más ωn = respuesta más rápida.',
    },
    {
      n: '4', title: 'Tiempo muerto', result: `θ = ${f(r.theta)} s`,
      formula: `θ = t₅₀ − x₅₀ / ωn = ${f(m.t50)} − ${f(r.x.x50)} / ${f(r.wn)} = <b>${f(r.theta)}</b> s`,
      why: `Sin retardo, el 50 % ocurriría a los x₅₀/ωn = ${f(r.x.x50 / r.wn)} s. Lo que sobra hasta t₅₀ es el tiempo que el sistema tarda en empezar a reaccionar: el ESC, la hélice que acelera y el sensor.`,
    },
    {
      n: '5', title: 'Verificación con el sobreimpulso', result: r.zetaMp !== null ? `ζ(Mp) = ${f(r.zetaMp)}` : 'no hubo sobreimpulso',
      formula: r.zetaMp !== null
        ? `Mp = ${f((m.mp ?? 0) * 100, 1)} %  →  ζ = −ln(Mp) / √(π² + ln²Mp) = −ln(${f(m.mp ?? 0)}) / √(π² + ${f(Math.log(m.mp ?? 1) ** 2)}) = <b>${f(r.zetaMp)}</b>`
        : 'La curva no pasó del valor final (más de un 3 %, el nivel del ruido): no hay nada que verificar con esta fórmula.',
      why: 'Si la respuesta se pasa del valor final, el porcentaje que se pasa depende solo de ζ (Nise, cap. 4). Sirve para comprobar el ζ de la tabla, y cuando ζ < 0.3 (R fuera de la tabla) es la única forma de obtenerlo.',
    },
    {
      n: '6', title: 'Caso de amortiguamiento', result: CASE_LABELS[r.dampingCase],
      formula: `ζ = ${f(r.zeta)}  →  ${r.zeta < 0.95 ? 'ζ < 0.95' : r.zeta <= 1.05 ? '0.95 ≤ ζ ≤ 1.05' : 'ζ > 1.05'}${r.R >= R_DOMINANT ? ` y R ≥ ${R_DOMINANT}` : ''}<br>
        Polos: s₁,₂ = −ζωn ± ωn√(ζ² − 1) = <b>${polesText}</b> rad/s
        ${r.tau ? `<br>τ₁,₂ = 1 / [ωn(ζ ∓ √(ζ² − 1))] = <b>${f(r.tau[0])} s</b> y <b>${f(r.tau[1])} s</b>` : ''}`,
      why: r.zeta < 0.95
        ? 'Polos complejos: la parte imaginaria es una oscilación. La respuesta al escalón se pasa del valor final y vuelve (guías suaves, carro liviano o cables elásticos).'
        : r.zeta <= 1.05
          ? 'Dos polos casi iguales: la respuesta más rápida posible sin pasarse.'
          : 'Dos polos reales distintos: la respuesta llega despacio y sin pasarse; manda la fricción viscosa. τ₁ (el polo lento) es el que más se nota.',
    },
    {
      n: '7', title: 'Dimensionamiento físico', result: mass ? `ke = ${f(r.ke, 3)} N/m · B = ${f(r.B, 3)} N·s/m` : 'falta la masa',
      formula: mass
        ? `m = ${f(mass / 1000, 3)} kg<br>ke = m·ωn² = ${f(mass / 1000, 3)} × ${f(r.wn)}² = <b>${f(r.ke, 3)}</b> N/m<br>
           B = 2ζ·m·ωn = 2 × ${f(r.zeta)} × ${f(mass / 1000, 3)} × ${f(r.wn)} = <b>${f(r.B, 3)}</b> N·s/m<br>
           kF = (K/100)·ke = (${f(r.K, 4)}/100) × ${f(r.ke, 3)} = <b>${r.kF !== null ? r.kF.toExponential(2) : '—'}</b> N/µs`
        : 'Escribe la masa del carro en el paso 1 (pésalo con todo lo que se mueve: motor, hélice, ESC si va montado, placa reflectora).',
      why: 'El carro se comporta como un masa–resorte–amortiguador: m·Δÿ + B·Δẏ + ke·Δy = kF·Δu(t − θ). ke es una "rigidez" equivalente (efecto suelo, cables, recirculación del aire), B es la fricción viscosa de las guías y kF cuánto empuje da cada µs de PWM. K se divide entre 100 porque está en cm/µs y aquí va en m/µs.',
    },
  ];
  $('[data-out="calc"]').innerHTML = rows.map((row) => `
    <li class="calc-row">
      <div class="calc-head"><span class="calc-n">${row.n}</span><b>${row.title}</b><span class="calc-res mono">${row.result}</span></div>
      <div class="calc-formula mono">${row.formula}</div>
      <p class="calc-why">${row.why}</p>
    </li>`).join('');

  $('[data-out="table1"]').innerHTML = `<table class="d-table d-t1"><thead><tr><th>ζ</th><th>R</th><th>x₁₀</th><th>x₅₀</th><th>x₉₀</th></tr></thead><tbody>
    ${TABLE_1.map((row) => `<tr class="${row === tb.lo || row === tb.hi ? 'hl' : ''}"><td>${row.zeta.toFixed(1)}</td><td>${row.R.toFixed(3)}</td><td>${row.x10.toFixed(3)}</td><td>${row.x50.toFixed(3)}</td><td>${row.x90.toFixed(3)}</td></tr>`).join('')}
    </tbody></table>`;

  // Curva normalizada: medida (si hay ensayo) y modelo de tres puntos
  marks.norm = { t10: m.t10, t50: m.t50, t90: m.t90 };
  const a = st.analysis;
  const src = st.source;
  const tMax = a ? Math.min(a.tEnd - a.tStep, 12) : Math.max(6, m.t90 * 2.5);
  const tt: number[] = [];
  for (let x = -1; x <= tMax + 1e-9; x += 0.05) tt.push(Math.round(x * 100) / 100);
  const model = r.model;
  const fModel = simulate(model, tt.map((x) => x), tt.map((x) => (x >= 0 ? 1 : 0)), 0, 0).map((v) => v / model.K);
  let fMeas: (number | null)[] = tt.map(() => null);
  if (a && src) {
    fMeas = tt.map((x) => {
      const target = a.tStep + x;
      const i = src.rec.t.findIndex((tv) => tv >= target - 1e-6);
      return i < 0 || Math.abs(src.rec.t[i] - target) > 0.03 ? null : (src.rec.y[i] - a.y0) / a.dy;
    });
  }
  plots.norm.setData([tt, fMeas, fModel] as unknown as uPlot.AlignedData);
}

function renderFit(c: Computed): void {
  const a = st.analysis;
  const src = st.source;
  const badge = $('[data-out="fit-badge"]');
  const table = $('[data-out="fit-table"]');
  $<HTMLInputElement>('[data-input="use-refined"]').disabled = !st.refined || manualEdited();
  $('[data-plot="fit"]').classList.toggle('empty', !a);
  if (!a || !src) {
    badge.textContent = '';
    table.innerHTML = '<tbody><tr><td class="hint">Carga un ensayo en el paso 1 para comparar los modelos con la medida.</td></tr></tbody>';
    plots.fit.setData([[], [], [], [], []] as unknown as uPlot.AlignedData);
    return;
  }
  const w = windowOf(src.rec, a);
  const fit3 = modelFit(c.r.model, w);
  const fitFo = modelFit(st.fopdt, w);
  const ref = st.refined;
  const best = Math.max(fit3, ref?.fit ?? 0);
  badge.className = `d-badge ${best >= 80 ? 'ok' : 'bad'}`;
  badge.textContent = best >= 80 ? `✓ Fit ${f(best, 1)} % (≥ 80 %)` : `✗ Fit ${f(best, 1)} % (< 80 %)`;
  const row = (name: string, color: string, mdl: string, fit: number) =>
    `<tr><td><i class="sw" style="--c:${color}"></i>${name}</td><td class="mono">${mdl}</td><td class="mono ${fit >= 80 ? 'ok' : 'bad'}">${f(fit, 1)} %</td></tr>`;
  const so = (s: Sopdt) => `K ${f(s.K, 4)} · ζ ${f(s.zeta, 3)} · ωn ${f(s.wn, 3)} · θ ${f(s.theta, 3)}`;
  table.innerHTML = `<thead><tr><th>Modelo</th><th>Parámetros</th><th>Fit</th></tr></thead><tbody>
    ${row('Tres puntos', C.model, so(c.r.model), fit3)}
    ${ref ? row('Ajuste fino', C.refined, so(ref.model), ref.fit) : ''}
    ${row('FOPDT (Fit 3)', C.fopdt, `K ${f(st.fopdt.K, 4)} · τ ${f(st.fopdt.tau, 3)} · t₀ ${f(st.fopdt.t0, 3)}`, fitFo)}
    </tbody>`;
  const y3 = simulate(c.r.model, w.t, w.u, w.u0, w.y0);
  const yr = ref ? simulate(ref.model, w.t, w.u, w.u0, w.y0) : w.t.map(() => null);
  const yf = simulate(st.fopdt, w.t, w.u, w.u0, w.y0);
  plots.fit.setData([w.t, w.y, y3, yr, yf] as unknown as uPlot.AlignedData);
}

const RULE_NAMES: Record<RuleKey, string> = { zn: 'Ziegler–Nichols', lambda: 'Lambda tuning', group: 'Regla del grupo' };

function renderGains(c: Computed): void {
  const { model, gains } = c;
  const fo = st.fopdt;
  const lambda = st.lambdaMult * model.theta;
  document.querySelectorAll<HTMLButtonElement>('[data-lambda]').forEach((b) => b.classList.toggle('active', Number(b.dataset.lambda) === st.lambdaMult));
  document.querySelectorAll<HTMLButtonElement>('[data-tauc]').forEach((b) => b.classList.toggle('active', Number(b.dataset.tauc) === st.taucMult));
  $('[data-out="lambda-val"]').textContent = `λ = ${f(lambda)} s`;
  $('[data-out="tauc-val"]').textContent = `τc = ${f(st.taucMult * model.theta)} s`;
  $('[data-out="tauc-field"]').hidden = st.group !== 'simc';
  $('[data-out="group-name"]').textContent = GROUP_RULES[st.group].label;

  const groupLabel = GROUP_RULES[st.group].label;
  const modelOf: Record<RuleKey, string> = {
    zn: `FOPDT · K ${f(fo.K, 4)}, τ ${f(fo.tau, 3)}, t₀ ${f(fo.t0, 3)}`,
    lambda: `SOPDT · K ${f(model.K, 4)}, ζ ${f(model.zeta, 3)}, ωn ${f(model.wn, 3)}, θ ${f(model.theta, 3)}`,
    group: st.group === 'simc' && model.zeta >= 1 ? 'SOPDT (τ₁, τ₂)' : 'FOPDT',
  };
  const colors: Record<RuleKey, string> = { zn: C.zn, lambda: C.lambda, group: C.group };
  $('[data-out="gains"]').innerHTML = `<thead><tr><th>Regla</th><th>Modelo</th><th>Kc [µs/cm]</th><th>Ti [s]</th><th>Td [s]</th>
    <th title="Las mismas ganancias en la forma que usa el firmware actual de la ESP32">Kp · Ki · Kd (firmware actual)</th><th></th></tr></thead><tbody>
    ${(Object.keys(gains) as RuleKey[]).map((k) => {
      const g = gains[k];
      const p = isaToParallel(g);
      return `<tr><td><i class="sw" style="--c:${colors[k]}"></i>${k === 'group' ? `${RULE_NAMES[k]}: ${groupLabel}` : RULE_NAMES[k]}</td>
        <td class="hint">${modelOf[k]}</td>
        <td class="mono big">${f(g.Kc, 2)}</td><td class="mono big">${f(g.Ti, 3)}</td><td class="mono big">${f(g.Td, 3)}</td>
        <td class="mono">${f(p.kp, 2)} · ${f(p.ki, 2)} · ${f(p.kd, 2)}</td>
        <td><button type="button" class="btn btn-sm" data-load="${k}" title="Mandar estas ganancias al simulador (pestaña abierta)">Probar en el simulador</button></td></tr>`;
    }).join('')}</tbody>`;

  // Fórmulas con números, como en el cuaderno
  const zn = gains.zn;
  const lam = gains.lambda;
  const grp = gains.group;
  let groupFormula = '';
  if (st.group === 'simc') {
    const tau = model.zeta >= 1;
    const tc = st.taucMult * (tau ? model.theta : fo.t0);
    groupFormula = tau
      ? (() => {
        const t1 = 1 / (model.wn * (model.zeta - Math.sqrt(model.zeta ** 2 - 1)));
        const t2 = 1 / (model.wn * (model.zeta + Math.sqrt(model.zeta ** 2 - 1)));
        const kcS = t1 / (model.K * (tc + model.theta));
        const tI = Math.min(t1, 4 * (tc + model.theta));
        return `τ₁ = ${f(t1)} s, τ₂ = ${f(t2)} s, τc = ${f(tc)} s<br>
          Kc' = τ₁ / [K(τc + θ)] = ${f(t1)} / [${f(model.K, 4)} × (${f(tc)} + ${f(model.theta)})] = ${f(kcS, 2)}<br>
          τI = min(τ₁, 4(τc + θ)) = ${f(tI)} s, τD = τ₂ = ${f(t2)} s (forma serie)<br>
          A forma ISA: Kc = Kc'(1 + τD/τI) = <b>${f(grp.Kc, 2)}</b>, Ti = τI + τD = <b>${f(grp.Ti)}</b>, Td = τI·τD/(τI + τD) = <b>${f(grp.Td)}</b>`;
      })()
      : `Polos complejos (ζ < 1): SIMC usa el FOPDT y da un PI.<br>
        Kc = τ / [K(τc + t₀)] = ${f(fo.tau)} / [${f(fo.K, 4)} × (${f(tc)} + ${f(fo.t0)})] = <b>${f(grp.Kc, 2)}</b><br>
        Ti = min(τ, 4(τc + t₀)) = <b>${f(grp.Ti)}</b> s, Td = <b>0</b>`;
  } else if (st.group === 'amigo') {
    groupFormula = `Kc = (1/K)(0.2 + 0.45·τ/t₀) = (1/${f(fo.K, 4)})(0.2 + 0.45 × ${f(fo.tau / fo.t0)}) = <b>${f(grp.Kc, 2)}</b><br>
      Ti = t₀(0.4t₀ + 0.8τ)/(t₀ + 0.1τ) = <b>${f(grp.Ti)}</b> s<br>Td = 0.5·t₀·τ/(0.3t₀ + τ) = <b>${f(grp.Td)}</b> s`;
  } else {
    const rr = fo.t0 / fo.tau;
    groupFormula = `r = t₀/τ = ${f(rr)}<br>Kc = (1/K)(τ/t₀)(4/3 + r/4) = <b>${f(grp.Kc, 2)}</b><br>
      Ti = t₀(32 + 6r)/(13 + 8r) = <b>${f(grp.Ti)}</b> s<br>Td = 4t₀/(11 + 2r) = <b>${f(grp.Td)}</b> s`;
  }
  const groupWhy: Record<GroupRule, string> = {
    simc: 'Skogestad (2003) simplificó la idea de Lambda/IMC con una recomendación concreta: τc = θ, que da buena velocidad sin perder robustez. Ojo: con dos polos reales, SIMC con τc = θ da exactamente lo mismo que Lambda con λ = θ (no sería una tercera regla distinta), y con polos complejos se vuelve un PI sin derivada. Por eso recomendamos AMIGO como regla del grupo.',
    amigo: 'Åström y Hägglund (2006) ajustaron estas fórmulas probando cientos de procesos con tiempo muerto, buscando robustez: que el lazo siga estable aunque el modelo tenga errores (sensibilidad máxima Ms = 1.4). Usa el FOPDT, como Ziegler–Nichols, pero es mucho menos agresiva. Es la regla que recomendamos para el grupo: siempre da un PID distinto de las otras dos.',
    'cohen-coon': 'Cohen y Coon (1953): como Ziegler–Nichols busca un decaimiento de 1/4, pero corrige mejor el efecto del tiempo muerto. Es agresiva: mucho sobreimpulso.',
  };

  $('[data-out="rules"]').innerHTML = `
    <article class="rule" style="--c:${C.zn}">
      <h3>1 · Ziegler–Nichols (curva de reacción)</h3>
      <div class="calc-formula mono">Kc = 1.2τ / (K·t₀) = 1.2 × ${f(fo.tau)} / (${f(fo.K, 4)} × ${f(fo.t0)}) = <b>${f(zn.Kc, 2)}</b> µs/cm<br>
        Ti = 2t₀ = <b>${f(zn.Ti)}</b> s<br>Td = 0.5t₀ = <b>${f(zn.Td)}</b> s</div>
      <p class="calc-why">Regla de 1942 para el modelo de primer orden. Busca que cada oscilación sea 1/4 de la anterior: rápida,
        pero con sobreimpulso grande. No tiene nada que elegir. Usa el FOPDT y no el SOPDT, y eso permite ver qué cambia al usar un modelo u otro.
        Cuanto mayor es t₀/τ (aquí ${f(fo.t0 / fo.tau, 2)}), más le cuesta (pregunta 3 del cuestionario).</p>
    </article>
    <article class="rule" style="--c:${C.lambda}">
      <h3>2 · Lambda tuning (λ = ${st.lambdaMult === 1 ? '' : st.lambdaMult}θ = ${f(lambda)} s)</h3>
      <div class="calc-formula mono">Ti = 2ζ/ωn = 2 × ${f(model.zeta)} / ${f(model.wn)} = <b>${f(lam.Ti)}</b> s<br>
        Td = 1/(2ζωn) = 1 / (2 × ${f(model.zeta)} × ${f(model.wn)}) = <b>${f(lam.Td)}</b> s<br>
        Kc = Ti / [K(λ + θ)] = ${f(lam.Ti)} / [${f(model.K, 4)} × (${f(lambda)} + ${f(model.theta)})] = <b>${f(lam.Kc, 2)}</b> µs/cm</div>
      <p class="calc-why">Escoge Ti y Td para que los dos ceros del PID cancelen los dos polos de la planta. Lo que queda es el
        retardo y un primer orden con la constante de tiempo λ que tú eliges: <b>λ pequeño = rápido y agresivo; λ grande = lento y robusto</b>
        frente a errores del modelo. La guía pide λ entre θ y 3θ y que justifiquen su elección (pregunta 4).</p>
    </article>
    <article class="rule" style="--c:${C.group}">
      <h3>3 · Regla del grupo: ${groupLabel}</h3>
      <div class="calc-formula mono">${groupFormula}</div>
      <p class="calc-why">${groupWhy[st.group]}</p>
      <p class="hint">Fuente para el informe: ${GROUP_RULES[st.group].ref}</p>
    </article>`;
}

function renderTwin(c: Computed): void {
  const { runs, metrics, twin } = c;
  const name = (k: RuleKey) => (k === 'group' ? `Grupo: ${GROUP_RULES[st.group].label}` : RULE_NAMES[k]);
  marks.twin = { uMin: twin.uMin, uMax: twin.uMax };
  plots['twin-y'].setData([runs.zn.t, runs.zn.sp, runs.zn.y, runs.lambda.y, runs.group.y] as unknown as uPlot.AlignedData);
  plots['twin-u'].setData([runs.zn.t, runs.zn.u, runs.lambda.u, runs.group.u] as unknown as uPlot.AlignedData);

  const colors: Record<RuleKey, string> = { zn: C.zn, lambda: C.lambda, group: C.group };
  const cell = (ok: boolean, text: string) => `<td class="mono ${ok ? 'ok' : 'bad'}">${text}</td>`;
  const verdict = (m: TwinMetrics) => {
    const s = m.segments[0];
    return s.mp <= SPECS.mp && s.ts !== null && s.ts <= SPECS.ts && m.segments.every((x) => x.ess <= SPECS.ess) && !m.saturated;
  };
  $('[data-out="metrics"]').innerHTML = `<thead><tr><th>Regla</th><th>Mp 20→40</th><th>ts (2 %)</th><th>IAE [cm·s]</th><th>|e| final</th><th>u [µs]</th><th>¿Cumple?</th></tr></thead><tbody>
    ${(Object.keys(metrics) as RuleKey[]).map((k) => {
      const m = metrics[k];
      const s = m.segments[0];
      const ok = verdict(m);
      const essMax = Math.max(...m.segments.map((x) => x.ess));
      return `<tr><td><i class="sw" style="--c:${colors[k]}"></i>${name(k)}</td>
        ${cell(s.mp <= SPECS.mp, `${f(s.mp, 1)} %`)}
        ${cell(s.ts !== null && s.ts <= SPECS.ts, s.ts === null ? `> ${P2_SEGMENT_S} s` : `${f(s.ts, 2)} s`)}
        <td class="mono">${f(s.iae, 1)}</td>
        ${cell(essMax <= SPECS.ess, `${f(essMax, 2)} cm`)}
        ${cell(!m.saturated, `${f(m.uLo, 0)} – ${f(m.uHi, 0)}${m.saturated ? ' (satura)' : ''}`)}
        <td class="verdict ${ok ? 'ok' : 'bad'}">${ok ? '✓ cumple' : '✗ no cumple'}</td></tr>`;
    }).join('')}</tbody>`;

  $('[data-out="segments"]').innerHTML = (Object.keys(metrics) as RuleKey[]).map((k) => `
    <h4><i class="sw" style="--c:${colors[k]}"></i>${name(k)}</h4>
    <table class="d-table"><thead><tr><th>Tramo</th><th>Mp</th><th>ts</th><th>IAE</th><th>|e|</th></tr></thead><tbody>
    ${metrics[k].segments.map((s) => `<tr><td class="mono">${s.from} → ${s.to} cm</td><td class="mono">${f(s.mp, 1)} %</td>
      <td class="mono">${s.ts === null ? `> ${P2_SEGMENT_S} s` : `${f(s.ts, 2)} s`}</td><td class="mono">${f(s.iae, 1)}</td><td class="mono">${f(s.ess, 2)}</td></tr>`).join('')}
    </tbody></table>`).join('');
}

// ── Entradas ────────────────────────────────────────────────────

function fillInputs(): void {
  document.querySelectorAll<HTMLInputElement>('[data-manual]').forEach((i) => {
    const v = st.manual[i.dataset.manual as keyof ThreePointInput];
    i.value = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : '';
  });
  document.querySelectorAll<HTMLInputElement>('[data-fopdt]').forEach((i) => {
    i.value = String(Math.round(st.fopdt[i.dataset.fopdt as keyof Fopdt] * 10000) / 10000);
  });
  document.querySelectorAll<HTMLInputElement>('[data-twin]').forEach((i) => {
    i.value = String(st.twin[i.dataset.twin as 'u0' | 'y0' | 'uMin' | 'uMax']);
  });
  $<HTMLInputElement>('[data-input="mass"]').value = st.massG ? String(st.massG) : '';
  $<HTMLInputElement>('[data-input="use-refined"]').checked = st.useRefined;
  $<HTMLInputElement>('[data-input="noise"]').checked = st.twin.noise;
  $<HTMLSelectElement>('[data-input="group"]').value = st.group;
}

function bind(): void {
  const fileInput = $<HTMLInputElement>('[data-input="file"]');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void loadFile(file);
  });
  const drop = $('[data-drop]');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    const file = e.dataTransfer?.files[0];
    if (file) void loadFile(file);
  });
  $('[data-action="example"]').addEventListener('click', loadExample);
  $('[data-action="reset-manual"]').addEventListener('click', () => {
    const a = st.analysis;
    if (!a) return;
    st.manual = { du: a.du, dy: a.dy, t10: a.t10, t50: a.t50, t90: a.t90, mp: a.mp || undefined };
    fillInputs();
    render();
  });
  document.querySelectorAll<HTMLInputElement>('[data-manual]').forEach((i) => i.addEventListener('change', () => {
    const v = Number(i.value);
    if (!Number.isFinite(v)) return;
    (st.manual as unknown as Record<string, number>)[i.dataset.manual!] = v;
    render();
  }));
  document.querySelectorAll<HTMLInputElement>('[data-fopdt]').forEach((i) => i.addEventListener('change', () => {
    const v = Number(i.value);
    if (Number.isFinite(v) && v > 0) st.fopdt[i.dataset.fopdt as keyof Fopdt] = v;
    render();
  }));
  document.querySelectorAll<HTMLInputElement>('[data-twin]').forEach((i) => i.addEventListener('change', () => {
    const v = Number(i.value);
    if (Number.isFinite(v)) st.twin[i.dataset.twin as 'u0' | 'y0' | 'uMin' | 'uMax'] = v;
    render();
  }));
  $<HTMLInputElement>('[data-input="mass"]').addEventListener('change', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    st.massG = Number.isFinite(v) && v > 0 ? v : null;
    render();
  });
  $<HTMLInputElement>('[data-input="use-refined"]').addEventListener('change', (e) => {
    st.useRefined = (e.target as HTMLInputElement).checked;
    render();
  });
  $<HTMLInputElement>('[data-input="noise"]').addEventListener('change', (e) => {
    st.twin.noise = (e.target as HTMLInputElement).checked;
    render();
  });
  $<HTMLSelectElement>('[data-input="group"]').addEventListener('change', (e) => {
    st.group = (e.target as HTMLSelectElement).value as GroupRule;
    save();
    render();
  });
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.lambda) { st.lambdaMult = Number(b.dataset.lambda); save(); render(); }
    if (b.dataset.tauc) { st.taucMult = Number(b.dataset.tauc); save(); render(); }
    if (b.dataset.load) loadIntoSimulator(b.dataset.load as RuleKey);
  });
}

/** Mandar las ganancias al simulador abierto en otra pestaña (mismo origen) */
function loadIntoSimulator(rule: RuleKey): void {
  const c = compute();
  const p = isaToParallel(c.gains[rule]);
  const name = rule === 'group' ? GROUP_RULES[st.group].label : RULE_NAMES[rule];
  try {
    localStorage.setItem('monocoptero-gains', JSON.stringify({ ...p, isa: c.gains[rule], rule: name, at: Date.now() }));
    toast(`${name}: Kp ${f(p.kp, 2)} · Ki ${f(p.ki, 2)} · Kd ${f(p.kd, 2)} enviadas. Si el simulador está abierto en otra pestaña, ya las tiene.`, 'success');
  } catch {
    toast('El navegador no deja guardar datos: copia las ganancias a mano en el simulador.', 'error');
  }
}

function toast(text: string, level: 'info' | 'success' | 'error' = 'info'): void {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = `toast toast-${level === 'error' ? 'error' : level === 'success' ? 'success' : 'info'}`;
  t.textContent = text;
  box.append(t);
  setTimeout(() => t.remove(), level === 'error' ? 7000 : 4500);
}

// ── Arranque ────────────────────────────────────────────────────

/**
 * Ejemplo resuelto de la guía: una curva simulada con su modelo (para los pasos 1 y 3)
 * y, en el paso 2, exactamente los tiempos que da la guía, para comparar cifra por cifra.
 */
function loadExample(): void {
  st.massG = 120;
  loadSource({ name: 'Ejemplo de la guía (curva simulada con K 0.2, ζ 1.21, ωn 2.03, θ 0.26 y Δu +150 µs)', example: true, rec: exampleRecord() });
  st.manual = { du: 150, dy: 30, t10: 0.53, t50: 1.19, t90: 2.71 };
  st.fopdt = { K: 0.2, tau: 1.01, t0: 0.48 };
  st.twin = { ...st.twin, u0: 1400, y0: 20, uMin: 1100, uMax: 1800 };
  fillInputs();
  render();
}

renderShell();
createPlots();
bind();
loadExample();
