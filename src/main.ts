/**
 * main.ts — Entry point del Simulador 3D del Monocóptero
 *
 * Construye el layout, crea las fuentes de datos y conecta todo
 * a través del AppState/EventBus:
 *
 *   fuente activa ──onSample──▶ appState.pushSample ──'telemetry'──▶ 3D, HUD, gráficas
 *   ParamsPanel ──setters──▶ appState ──eventos──▶ fuentes
 */

import './styles/main.css';
import { appState } from './core/AppState';
import { SceneManager } from './scene3d/SceneManager';
import { Hud } from './ui/Hud';
import { ParamsPanel } from './ui/ParamsPanel';
import { ChartsPanel } from './ui/ChartsPanel';
import { toast } from './ui/animations';
import { StepMetrics } from './core/StepMetrics';
import { Recorder } from './data/recording';
import { exportRecording } from './data/exportExcel';
import { SimulationSource } from './data/SimulationSource';
import { ReplaySource } from './data/ReplaySource';
import { SerialSource } from './data/SerialSource';
import type { DataMode, DataSource, SourceStatus } from './data/types';

// ── Construir el layout HTML ────────────────────────────────────

function createLayout(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('No se encontró el elemento #app');

  app.innerHTML = `
    <main id="viewport">
      <!-- Vista 3D -->
      <div id="panel-3d">
        <div id="hud"></div>

        <button id="btn-reset-camera" class="btn-hud" title="Volver a la vista inicial">
          ⟲ Cámara
        </button>
        <div class="viewport-hint">Arrastra para orbitar · rueda para zoom</div>

        <!-- Placeholder — se reemplaza al montar la escena 3D -->
        <div class="placeholder-message" id="canvas-placeholder">
          <div class="icon">⚙</div>
          <div class="text">Cargando escena 3D…</div>
        </div>
      </div>

      <!-- Gráficas (siempre visibles bajo la vista 3D) -->
      <section id="panel-charts" aria-label="Gráficas en tiempo real"></section>
    </main>

    <!-- Barra lateral de controles -->
    <aside id="sidebar" aria-label="Controles"></aside>

    <div id="toasts" aria-live="polite"></div>
  `;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`No se encontró #${id}`);
  return el;
}

// ── Inicialización ──────────────────────────────────────────────

function init(): void {
  createLayout();

  // Escena 3D
  const scene = new SceneManager(byId('panel-3d'));
  scene.start();
  byId('btn-reset-camera').addEventListener('click', () => scene.resetCamera());

  // Fuentes de datos
  const simulation = new SimulationSource();
  const replay = new ReplaySource();
  const serial = new SerialSource();
  const sources: Record<DataMode, DataSource> = {
    simulacion: simulation,
    reproduccion: replay,
    serial,
  };
  const active = (): DataSource => sources[appState.mode];

  // UI
  const hud = new Hud(byId('hud'));
  const charts = new ChartsPanel(byId('panel-charts'));
  const recorder = new Recorder();
  const params = new ParamsPanel(byId('sidebar'), {
    state: appState,
    replay,
    serial,
    onExportRecording: async () => {
      try {
        const name = await exportRecording(recorder.samples, appState.mode);
        appState.reportStatus({ level: 'success', message: `Descargado ${name} (${recorder.count} muestras).` });
      } catch (err) {
        appState.reportStatus({ level: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    },
    onClearRecording: () => {
      recorder.clear();
      refreshRecording();
    },
  });
  const refreshRecording = () => params.setRecording({
    count: recorder.count,
    duration: recorder.duration,
    recording: appState.running,
    full: recorder.full,
  });
  const metrics = new StepMetrics();
  let lastMetrics: ReturnType<StepMetrics['push']> = null;
  const toasts = byId('toasts');

  // ── Fuentes → bus ──
  for (const source of Object.values(sources)) {
    source.onSample((s) => {
      // Una fuente pausada/no activa no debe pintar (p.ej. la última trama serial en vuelo)
      if (source === active()) appState.pushSample(s);
    });
    source.onStatus((status: SourceStatus) => {
      if (source !== active()) return;
      appState.reportStatus(status);
      if (status.stopped) appState.setRunning(false);
    });
  }

  // ── Bus → consumidores ──
  appState.bus.on('telemetry', (s) => {
    // El 3D muestra la posición real; HUD y gráficas, lo que mide el sensor
    scene.setTelemetry(s.heightTrue ?? s.height, s.pwm, s.setpoint);
    hud.update(s);
    charts.pushSample(s);
    // Se graba solo en marcha (no la muestra que emite un reset) y nunca la reproducción
    if (appState.running && appState.mode !== 'reproduccion') recorder.push(s);

    lastMetrics = metrics.push(s);
    params.showMetrics(lastMetrics);
    updateHudStatus(lastMetrics?.settled ?? false);
  });

  appState.bus.on('status', (s) => toast(toasts, s));

  // ── Controles → fuentes ──
  const syncSimulation = () => {
    simulation.setpoint = appState.setpoint;
    simulation.setGains(appState.kp, appState.ki, appState.kd);
    simulation.setFeedforward(appState.feedforward);
    simulation.setControlMode(appState.controlMode);
    simulation.manualPwm = appState.manualPwm;
  };
  syncSimulation();
  // El marcador 3D se mueve al instante, aunque la simulación esté pausada
  const showSimSetpoint = () => {
    if (appState.mode === 'simulacion') {
      scene.setSetpoint(appState.controlMode === 'pid' ? appState.setpoint : null);
    }
  };
  appState.bus.on('setpoint-change', (v) => {
    simulation.setpoint = v;
    showSimSetpoint();
  });
  appState.bus.on('control-mode-change', showSimSetpoint);
  appState.bus.on('pid-change', ({ kp, ki, kd }) => simulation.setGains(kp, ki, kd));
  appState.bus.on('feedforward-change', (u0) => simulation.setFeedforward(u0));
  appState.bus.on('control-mode-change', (m) => simulation.setControlMode(m));
  appState.bus.on('manual-pwm-change', (v) => { simulation.manualPwm = v; });

  const updateHudStatus = (settled = false) => {
    if (!appState.running) hud.setStatus('paused');
    else if (appState.mode === 'serial') hud.setStatus('live');
    else hud.setStatus(settled ? 'settled' : 'running');
  };

  const resetActive = () => {
    recorder.clear();
    metrics.reset();
    lastMetrics = null;
    params.showMetrics(null);
    charts.clear();
    hud.clear();
    active().reset();
    hud.flush();
  };

  appState.bus.on('running-change', async (running) => {
    updateHudStatus(lastMetrics?.settled ?? false);
    params.showMetrics(lastMetrics);
    const source = active();
    if (running) {
      await source.start();
      if (source === serial) params.setSerialConnected(serial.connected);
    } else {
      await source.stop();
      if (source === serial) params.setSerialConnected(false);
      if (source === serial && recorder.count > 1) {
        appState.reportStatus({
          level: 'info',
          message: `Grabación lista: ${recorder.count} muestras. Descárgala en «Excel para PID Tuner».`,
        });
      }
    }
    refreshRecording();
  });

  appState.bus.on('reset', () => resetActive());

  appState.bus.on('mode-change', async (mode) => {
    // Detener todas las fuentes que no sean la nueva
    for (const [m, source] of Object.entries(sources)) {
      if (m !== mode) await source.stop();
    }
    params.setSerialConnected(false);
    appState.setRunning(false);
    hud.setMode(mode);
    resetActive();
    if (mode !== 'simulacion') {
      scene.snapTo(simulation.model.state.height);
      scene.setSetpoint(null);
    }
  });

  // Progreso de la reproducción (barato: solo actualiza un slider)
  setInterval(() => {
    if (appState.mode === 'reproduccion' && replay.loaded) params.setReplayProgress(replay.progress);
    else refreshRecording();
  }, 200);

  // Tras un seek, redibujar la historia hasta ese instante
  byId('sidebar').addEventListener('input', (e) => {
    if ((e.target as HTMLElement).dataset.input === 'seek') charts.pushMany(replay.samplesUntilNow());
  });

  // Estado inicial
  hud.setMode(appState.mode);
  resetActive();
  scene.snapTo(simulation.model.state.height);

  // Atajos de teclado: espacio = iniciar/pausar, R = reiniciar
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      appState.setRunning(!appState.running);
    } else if (e.key === 'r' || e.key === 'R') {
      appState.requestReset();
    }
  });

  console.log('[Simulador Monocóptero] Listo');
}

// Arrancar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
