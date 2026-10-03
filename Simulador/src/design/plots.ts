/**
 * plots.ts — gráficas de la página de diseño con el mismo estilo que las del simulador.
 */

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export const C = {
  y: '#4f8cff',
  sp: '#fbbf24',
  u: '#ff6b35',
  zn: '#f87171',
  lambda: '#4f8cff',
  group: '#34d399',
  model: '#a78bfa',
  refined: '#34d399',
  fopdt: '#9498a8',
  axis: '#8a8fa3',
  grid: 'rgba(61, 66, 96, 0.45)',
  mark: 'rgba(232, 234, 240, 0.55)',
};

export interface SeriesSpec {
  label: string;
  color: string;
  dash?: number[];
  width?: number;
  scale?: string;
  points?: boolean;
}

export interface PlotSpec {
  series: SeriesSpec[];
  height: number;
  /** Ejes y: el primero a la izquierda, el segundo (si lo hay) a la derecha */
  yAxes: { scale: string; label: string; digits?: number }[];
  xLabel?: string;
  draw?: (u: uPlot) => void;
}

function axis(digits: number, extra: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: C.axis,
    grid: { stroke: C.grid, width: 1 },
    ticks: { show: false },
    font: '10px "JetBrains Mono", monospace',
    labelFont: '600 10px Inter, system-ui, sans-serif',
    size: 46,
    gap: 4,
    values: (_u, vals) => vals.map((v) => (v == null ? '' : v.toFixed(digits))),
    ...extra,
  };
}

/** Relleno de la caja de la gráfica [px] (la gráfica va en posición absoluta dentro) */
const PAD_X = 8;
const PAD_Y = 8;

export function makePlot(el: HTMLElement, spec: PlotSpec): uPlot {
  // Alto fijo y gráfica en posición absoluta: cambiar su ancho no cambia el de la caja
  // (si no, la caja crece, el ResizeObserver vuelve a ensanchar la gráfica… sin fin)
  el.style.height = `${spec.height + PAD_Y}px`;
  const widthOf = () => Math.max(200, Math.floor(el.clientWidth - PAD_X));
  const opts: uPlot.Options = {
    width: widthOf(),
    height: spec.height,
    scales: { x: { time: false } },
    legend: { show: false },
    cursor: { drag: { x: false, y: false }, points: { show: false } },
    padding: [10, 10, 0, 0],
    series: [
      {},
      ...spec.series.map((s): uPlot.Series => ({
        label: s.label,
        stroke: s.color,
        width: s.width ?? 1.6,
        dash: s.dash,
        scale: s.scale ?? spec.yAxes[0].scale,
        points: s.points ? { show: true, size: 3, fill: s.color, stroke: s.color } : { show: false },
        spanGaps: true,
      })),
    ],
    axes: [
      axis(1, { size: 34, label: spec.xLabel ?? 't [s]', labelSize: 14 }),
      ...spec.yAxes.map((a, i) => axis(a.digits ?? 0, {
        scale: a.scale, label: a.label, labelSize: 16, side: i === 0 ? 3 : 1, grid: { show: i === 0, stroke: C.grid, width: 1 },
      })),
    ],
    hooks: spec.draw ? { draw: [spec.draw] } : {},
  };
  const plot = new uPlot(opts, [[], ...spec.series.map(() => [])] as unknown as uPlot.AlignedData, el);
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = widthOf();
      if (w !== plot.width) plot.setSize({ width: w, height: spec.height });
    });
  }).observe(el);
  return plot;
}

/** Línea vertical punteada con etiqueta, en el valor x (unidades de datos) */
export function vline(u: uPlot, x: number, color: string, label?: string): void {
  const { ctx, bbox } = u;
  const px = u.valToPos(x, 'x', true);
  if (px < bbox.left || px > bbox.left + bbox.width) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, bbox.top);
  ctx.lineTo(px, bbox.top + bbox.height);
  ctx.stroke();
  if (label) {
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = `600 ${10 * devicePixelRatio}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, px, bbox.top + 12 * devicePixelRatio);
  }
  ctx.restore();
}

/** Línea horizontal punteada con etiqueta a la derecha */
export function hline(u: uPlot, y: number, color: string, label?: string, scale = 'y'): void {
  const { ctx, bbox } = u;
  const py = u.valToPos(y, scale, true);
  if (py < bbox.top || py > bbox.top + bbox.height) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bbox.left, py);
  ctx.lineTo(bbox.left + bbox.width, py);
  ctx.stroke();
  if (label) {
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = `${10 * devicePixelRatio}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(label, bbox.left + bbox.width - 4 * devicePixelRatio, py - 4 * devicePixelRatio);
  }
  ctx.restore();
}
