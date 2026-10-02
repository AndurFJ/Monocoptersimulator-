/**
 * ChartsPanel — gráficas en tiempo real con uPlot.
 *
 * Tres gráficas lado a lado bajo la vista 3D:
 * 1. Altura vs. tiempo (+ setpoint como línea punteada)
 * 2. PWM vs. tiempo
 * 3. Error / términos PID (solo si la fuente los da)
 *
 * Las muestras se acumulan en buffers y se redibujan a ~20 fps
 * (no por muestra), mostrando una ventana deslizante de WINDOW_S.
 * Cada gráfica ocupa todo el espacio de su tarjeta (ResizeObserver).
 */

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { TelemetrySample } from '../data/types';
import { DEAD_ZONE_TOP_M, UNSTABLE_ZONE_START_M } from '../physics/constants';

/** Dibuja las zonas muerta e inestable como bandas de fondo (en cm) */
function zoneBands(u: uPlot): void {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const band = (from: number, to: number, color: string) => {
    const y1 = u.valToPos(to, 'y', true);
    const y2 = u.valToPos(from, 'y', true);
    const yTop = Math.max(top, Math.min(y1, y2));
    const yBot = Math.min(top + height, Math.max(y1, y2));
    if (yBot > yTop) {
      ctx.fillStyle = color;
      ctx.fillRect(left, yTop, width, yBot - yTop);
    }
  };
  ctx.save();
  band(-1e3, DEAD_ZONE_TOP_M * 100, 'rgba(148, 152, 168, 0.12)');
  band(UNSTABLE_ZONE_START_M * 100, 1e3, 'rgba(248, 113, 113, 0.12)');
  ctx.restore();
}

/** Ventana visible [s] */
const WINDOW_S = 30;
/** Intervalo mínimo entre redibujos [ms] */
const REDRAW_MS = 50;

const COLORS = {
  height: '#4f8cff',
  raw: 'rgba(148, 152, 168, 0.75)',
  setpoint: '#fbbf24',
  pwm: '#ff6b35',
  error: '#f87171',
  p: '#34d399',
  i: '#a78bfa',
  d: '#9498a8',
  axis: '#8a8fa3',
  grid: 'rgba(61, 66, 96, 0.45)',
};

type Col = (number | null)[];

interface Buffers {
  t: number[];
  height: Col;
  raw: Col;
  setpoint: Col;
  pwm: Col;
  error: Col;
  p: Col;
  i: Col;
  d: Col;
}

function emptyBuffers(): Buffers {
  return { t: [], height: [], raw: [], setpoint: [], pwm: [], error: [], p: [], i: [], d: [] };
}

function axis(digits: number, extra: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: COLORS.axis,
    grid: { stroke: COLORS.grid, width: 1 },
    ticks: { show: false },
    font: '10px "JetBrains Mono", monospace',
    size: 40,
    gap: 4,
    values: (_u, vals) => vals.map((v) => v.toFixed(digits)),
    ...extra,
  };
}

function timeAxis(): uPlot.Axis {
  return axis(0, { size: 22, values: (_u, vals) => vals.map((v) => `${v.toFixed(0)}s`) });
}

function series(label: string, stroke: string, dash?: number[]): uPlot.Series {
  return { label, stroke, width: 1.5, dash, spanGaps: false, points: { show: false } };
}

interface ChartSpec {
  key: string;
  title: string;
  legend: { label: string; color: string; dashed?: boolean; band?: boolean }[];
}

const SPECS: ChartSpec[] = [
  {
    key: 'height',
    title: 'Altura [cm]',
    legend: [
      { label: 'Sensor (filtrada)', color: COLORS.height },
      { label: 'Crudo', color: COLORS.raw, dashed: true },
      { label: 'Objetivo', color: COLORS.setpoint, dashed: true },
      { label: 'Zona inestable', color: 'rgba(248, 113, 113, 0.5)', band: true },
    ],
  },
  { key: 'pwm', title: 'PWM [µs]', legend: [{ label: 'Comando', color: COLORS.pwm }] },
  {
    key: 'pid',
    title: 'Error [cm] · términos PID [µs]',
    legend: [
      { label: 'Error', color: COLORS.error },
      { label: 'P', color: COLORS.p },
      { label: 'I', color: COLORS.i },
      { label: 'D', color: COLORS.d },
    ],
  },
];

export class ChartsPanel {
  private readonly buf = emptyBuffers();
  private readonly charts: Record<string, uPlot> = {};
  private readonly cards: Record<string, HTMLElement> = {};
  private readonly observers: ResizeObserver[] = [];
  private readonly root: HTMLElement;
  private dirty = false;
  private lastRedraw = 0;
  private rafId = 0;

  constructor(container: HTMLElement) {
    this.root = container;
    container.innerHTML = SPECS.map((spec) => `
      <figure class="chart-card" data-card="${spec.key}">
        <figcaption class="chart-head">
          <span class="chart-title">${spec.title}</span>
          <span class="chart-legend">
            ${spec.legend.map((l) => `<span><i class="${l.dashed ? 'dashed' : ''}${l.band ? 'band' : ''}" style="--c:${l.color}"></i>${l.label}</span>`).join('')}
          </span>
        </figcaption>
        <div class="chart-plot" data-plot="${spec.key}">
          <div class="chart-empty"><span>Sin datos · pulsa <b>Iniciar</b></span></div>
        </div>
      </figure>
    `).join('');

    const base = (): Omit<uPlot.Options, 'series' | 'axes' | 'width' | 'height'> => ({
      scales: { x: { time: false } },
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, points: { show: false } },
      padding: [8, 8, 0, 0],
    });

    const make = (key: string, opts: Omit<uPlot.Options, 'width' | 'height'>, cols: number) => {
      const slot = container.querySelector<HTMLElement>(`[data-plot="${key}"]`)!;
      this.cards[key] = container.querySelector<HTMLElement>(`[data-card="${key}"]`)!;
      const chart = new uPlot({ ...opts, width: 300, height: 120 } as uPlot.Options,
        Array.from({ length: cols }, () => []) as unknown as uPlot.AlignedData, slot);
      // El gráfico está en position:absolute dentro del slot, así que cambiar su
      // tamaño no altera el del slot; el rAF evita el "ResizeObserver loop"
      let pending = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => {
          const w = Math.floor(slot.clientWidth);
          const h = Math.floor(slot.clientHeight);
          if (w > 0 && h > 0 && (w !== chart.width || h !== chart.height)) chart.setSize({ width: w, height: h });
        });
      });
      ro.observe(slot);
      this.observers.push(ro);
      this.charts[key] = chart;
    };

    make('height', {
      ...base(),
      series: [
        {},
        series('Altura', COLORS.height),
        { label: 'Crudo', stroke: COLORS.raw, width: 0, points: { show: true, size: 3, fill: COLORS.raw, stroke: COLORS.raw } },
        series('Objetivo', COLORS.setpoint, [6, 4]),
      ],
      axes: [timeAxis(), axis(0)],
      hooks: { drawClear: [zoneBands] },
    }, 4);

    make('pwm', {
      ...base(),
      series: [{}, series('PWM', COLORS.pwm)],
      axes: [timeAxis(), axis(0)],
    }, 2);

    make('pid', {
      ...base(),
      series: [
        {},
        { ...series('Error [cm]', COLORS.error), scale: 'cm' },
        series('P', COLORS.p),
        series('I', COLORS.i),
        series('D', COLORS.d),
      ],
      axes: [
        timeAxis(),
        axis(1, { scale: 'cm' }),
        axis(2, { side: 1, scale: 'y', grid: { show: false } }),
      ],
    }, 5);

    this.loop();
  }

  /** Agregar una muestra a las gráficas */
  pushSample(s: TelemetrySample): void {
    const b = this.buf;
    // Si el tiempo retrocede (seek, reset externo) se empieza de nuevo
    if (b.t.length && s.t < b.t[b.t.length - 1]) this.clear();

    b.t.push(s.t);
    b.height.push(s.height * 100);
    b.raw.push(s.raw !== undefined ? s.raw * 100 : null);
    b.setpoint.push(s.setpoint !== undefined ? s.setpoint * 100 : null);
    b.pwm.push(s.pwm);
    b.error.push(s.error !== undefined ? s.error * 100 : null);
    b.p.push(s.pidTerms?.p ?? null);
    b.i.push(s.pidTerms?.i ?? null);
    b.d.push(s.pidTerms?.d ?? null);

    // Ventana deslizante: descartar lo que queda fuera
    const tMin = s.t - WINDOW_S;
    let cut = 0;
    while (cut < b.t.length && b.t[cut] < tMin) cut++;
    if (cut > 0) {
      for (const key of Object.keys(b) as (keyof Buffers)[]) b[key].splice(0, cut);
    }
    this.dirty = true;
  }

  /** Cargar un bloque de muestras de una vez (tras un seek en reproducción) */
  pushMany(samples: TelemetrySample[]): void {
    this.clear();
    const tMin = samples.length ? samples[samples.length - 1].t - WINDOW_S : 0;
    for (const s of samples) if (s.t >= tMin) this.pushSample(s);
  }

  /** Limpiar todas las gráficas */
  clear(): void {
    for (const key of Object.keys(this.buf) as (keyof Buffers)[]) this.buf[key].length = 0;
    this.dirty = true;
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    for (const ro of this.observers) ro.disconnect();
    for (const c of Object.values(this.charts)) c.destroy();
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (!this.dirty || now - this.lastRedraw < REDRAW_MS) return;
    this.lastRedraw = now;
    this.dirty = false;
    this.redraw();
  };

  private redraw(): void {
    const b = this.buf;
    // Con 1 sola muestra (tras un reset) aún no hay curva que dibujar
    const empty = b.t.length < 2;
    this.root.classList.toggle('is-empty', empty);

    const tLast = b.t.length ? b.t[b.t.length - 1] : 0;
    const range = { min: Math.max(0, tLast - WINDOW_S), max: Math.max(WINDOW_S, tLast) };

    const hasPid = b.p.some((v) => v !== null) || b.error.some((v) => v !== null);
    // La tarjeta PID se oculta solo cuando hay datos sin PID (replay/serial/manual)
    this.cards.pid.hidden = !empty && !hasPid;

    // setData re-autoescala Y; luego se fija X a la ventana deslizante
    const data: [uPlot, uPlot.AlignedData][] = [
      [this.charts.height, [b.t, b.height, b.raw, b.setpoint] as uPlot.AlignedData],
      [this.charts.pwm, [b.t, b.pwm] as uPlot.AlignedData],
      [this.charts.pid, [b.t, b.error, b.p, b.i, b.d] as uPlot.AlignedData],
    ];
    for (const [chart, d] of data) {
      chart.batch(() => {
        chart.setData(d);
        chart.setScale('x', range);
      });
    }
  }
}
