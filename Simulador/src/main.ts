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
import { StepSequence, trimStepTest } from './core/StepSequence';
import type { StepUpdate } from './core/StepSequence';
import { Recorder } from './data/recording';
import { exportRecording } from './data/exportExcel';
import { SimulationSource } from './data/SimulationSource';
import { ReplaySource } from './data/ReplaySource';
import { SerialSource } from './data/SerialSource';
import { WifiSource } from './data/WifiSource';
import type { DataMode, DataSource, SourceStatus, EspStatus, TelemetrySample } from './data/types';

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
  const wifi = new WifiSource();
  const sources: Record<DataMode, DataSource> = {
    simulacion: simulation,
    reproduccion: replay,
    serial,
    wifi,
  };
  const active = (): DataSource => sources[appState.mode];

  // Escanear puertos USB ya autorizados para poder autoconsectar sin selector
  void serial.scanForSavedPort();

  // UI
  const hud = new Hud(byId('hud'));
  const charts = new ChartsPanel(byId('panel-charts'));
  const recorder = new Recorder();
  const params = new ParamsPanel(byId('sidebar'), {
    state: appState,
    replay,
    serial,
    wifi,
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
    onStepTest: (u0) => startStepTest(u0),
    onStepTestCancel: () => cancelStepTest('parada pedida por el usuario.'),
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
  let stepTest: StepSequence | null = null;
  let lastLive: { s: TelemetrySample; at: number } | null = null;

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
    // 3D, HUD y gráficas muestran lo que mide el sensor (altura filtrada igual que
    // en el firmware), en la misma escala de 0–100 cm del banco.
    scene.setTelemetry(s.height, s.pwm, s.setpoint);
    hud.update(s);
    charts.pushSample(s);
    if (s.failsafe) {
      failsafeActive = true;
      hud.setStatus('failsafe');
    }
    // En Serial/WiFi el panel refleja la telemetría en vivo del prototipo
    if (appState.mode === 'wifi' || appState.mode === 'serial') {
      params.setEspLive(s.height, s.pwm, s.raw);
      lastLive = { s, at: performance.now() };
      if (stepTest?.active) applyStepUpdate(stepTest.push(s.t, s.height * 100, s.pwm));
    }
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
    if (appState.mode === 'simulacion' || appState.mode === 'wifi' || appState.mode === 'serial') {
      scene.setSetpoint(appState.controlMode === 'pid' ? appState.setpoint : null);
    }
  };

  // ── Comandos al prototipo (WiFi o USB) ──
  // La placa aplica el comando y devuelve su estado a todos los dispositivos.
  // Mientras se aplica ese estado en la UI (applyingRemote) NO se reenvía nada:
  // antes cada eco se volvía a mandar como comando y reiniciaba el PID.
  let applyingRemote = false;
  const sendLiveNow = (cmd: object): void => {
    if (appState.mode === 'wifi' && wifi.connected) wifi.sendCommand(cmd);
    else if (appState.mode === 'serial' && serial.connected) serial.sendCommand(cmd);
  };
  const sendLive = (cmd: object): void => {
    if (!applyingRemote) sendLiveNow(cmd);
  };
  // Sliders: como mucho un comando cada 100 ms por tipo, siempre con el último valor
  // (un arrastre mandaba decenas de comandos y la ESP32 perdía los importantes).
  const pendingCmds = new Map<string, object>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const sendLiveLatest = (key: string, cmd: object): void => {
    if (applyingRemote) return;
    pendingCmds.set(key, cmd);
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      for (const c of pendingCmds.values()) sendLiveNow(c);
      pendingCmds.clear();
    }, 100);
  };
  // Instante del último cambio local por parámetro: el eco del firmware no pisa
  // lo que el usuario está moviendo en ese momento.
  const localEdit: Record<string, number> = {};
  const touched = (key: string) => {
    if (!applyingRemote) localEdit[key] = performance.now();
  };
  const recentlyEdited = (key: string) => performance.now() - (localEdit[key] ?? -1e9) < 800;

  appState.bus.on('setpoint-change', (v) => {
    simulation.setpoint = v;
    showSimSetpoint();
    touched('setpoint');
    sendLiveLatest('setpoint', { type: 'cmd', action: 'set_setpoint', value: v });
  });
  appState.bus.on('control-mode-change', (m) => {
    simulation.setControlMode(m);
    if (m === 'manual') simulation.clearFailsafe();
    showSimSetpoint();
    // Cambiar de pestaña NO arranca el motor del prototipo: el PID se inicia
    // con "Ir ▲" / "Iniciar PID" y el manual al mover el PWM.
  });
  appState.bus.on('pid-change', ({ kp, ki, kd }) => {
    simulation.setGains(kp, ki, kd);
    touched('gains');
    sendLive({ type: 'cmd', action: 'set_pid', kp, ki, kd });
  });
  appState.bus.on('feedforward-change', (u0) => {
    simulation.setFeedforward(u0);
    touched('u0');
    sendLive({ type: 'cmd', action: 'set_u0', value: u0 });
  });
  appState.bus.on('manual-pwm-change', (v) => {
    simulation.manualPwm = v;
    simulation.clearFailsafe();
    cancelStepTest('moviste el PWM manual.', false);
    sendLiveLatest('pwm', { type: 'cmd', action: 'set_pwm', value: v });
  });
  appState.bus.on('pid-go', () => {
    cancelStepTest('se inició el PID.', false);
    if (appState.controlMode !== 'pid') appState.setControlMode('pid');
    if (appState.mode === 'simulacion') {
      simulation.clearFailsafe();
      if (!appState.running) appState.setRunning(true);
      return;
    }
    const liveConnected = (appState.mode === 'wifi' && wifi.connected) || (appState.mode === 'serial' && serial.connected);
    if (!liveConnected) {
      appState.reportStatus({ level: 'info', message: 'Conecta primero con el prototipo (🔌 Conectar).' });
      if (!appState.running) appState.setRunning(true);
      return;
    }
    // Setpoint primero; START solo si el PID no estaba ya corriendo (START reinicia el integral)
    sendLiveNow({ type: 'cmd', action: 'set_setpoint', value: appState.setpoint });
    if (lastEsp.control_mode !== 'pid') sendLiveNow({ type: 'cmd', action: 'start' });
  });

  // Sincronizar con el estado que reporta la placa (WiFi o USB): solo se aplica lo
  // que CAMBIÓ en la placa desde el último estado (otro dispositivo lo movió), y
  // nunca algo que el usuario está editando aquí mismo.
  let failsafeActive = false;
  let lastEsp: EspStatus = {};
  const syncEsp = (esp: EspStatus, via: 'wifi' | 'serial'): void => {
    params.setEspStatus(esp);
    if (esp.failsafe !== undefined) failsafeActive = esp.failsafe;
    if (esp.failsafe) cancelStepTest('la ESP32 activó el failsafe.');
    if (failsafeActive) hud.setStatus('failsafe');
    else updateHudStatus(lastMetrics?.settled ?? false);
    if (appState.mode !== via) return;

    const changed = <K extends keyof EspStatus>(k: K) => esp[k] !== undefined && esp[k] !== lastEsp[k];
    applyingRemote = true;
    try {
      if (changed('setpoint_cm') && !recentlyEdited('setpoint')) appState.setSetpoint(esp.setpoint_cm! / 100);
      if ((changed('kp') || changed('ki') || changed('kd')) && !recentlyEdited('gains')
        && esp.kp !== undefined && esp.ki !== undefined && esp.kd !== undefined) {
        appState.setPIDGains(esp.kp, esp.ki, esp.kd);
      }
      if (changed('u0') && !recentlyEdited('u0')) appState.setFeedforward(esp.u0!);
      if (changed('control_mode') && (esp.control_mode === 'pid' || esp.control_mode === 'manual')) {
        appState.setControlMode(esp.control_mode);
      }
    } finally {
      applyingRemote = false;
    }
    lastEsp = { ...lastEsp, ...esp };
  };
  wifi.onEspStatus((esp) => syncEsp(esp, 'wifi'));
  serial.onEspStatus((esp) => syncEsp(esp, 'serial'));

  // ── Ensayo de escalón automático en el banco ──
  const applyStepUpdate = (u: StepUpdate): void => {
    const seq = stepTest;
    if (!seq) return;
    for (const c of u.commands) sendLiveNow(c);
    if (u.phaseChanged) {
      const { u0, deltaU, stableWindowS } = seq.cfg;
      if (seq.phase === 'despegue') {
        appState.reportStatus({ level: 'info', message: `Ensayo: despegando con una rampa desde ${u0 + seq.cfg.rampOffsetUs} µs…` });
      } else if (seq.phase === 'estabilizando') {
        appState.reportStatus({ level: 'info', message: `Ensayo: flotando en ${u0} µs hasta quedar quieto ${stableWindowS} s.` });
      } else if (seq.phase === 'escalon') {
        appState.reportStatus({ level: 'info', message: `Ensayo: quieto ✓ — escalón ${u0} → ${u0 + deltaU} µs en curso.` });
      } else if (seq.phase === 'abortado') {
        appState.reportStatus({ level: 'warning', message: `Ensayo cancelado: ${seq.reason}` });
      } else if (seq.phase === 'listo') {
        void exportStepTest(seq);
      }
    }
    params.showStepTest({ phase: seq.phase, text: seq.describe() });
  };

  const exportStepTest = async (seq: StepSequence): Promise<void> => {
    const data = trimStepTest(recorder.samples, seq.stepStartT);
    try {
      const name = await exportRecording(data, 'escalon');
      appState.reportStatus({
        level: 'success',
        message: `Ensayo listo: descargado ${name} (${data.length} muestras). Muévelo a 02_datos.`,
      });
    } catch (err) {
      appState.reportStatus({ level: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const startStepTest = (u0: number): void => {
    if (stepTest?.active) return;
    const live = (appState.mode === 'wifi' && wifi.connected) || (appState.mode === 'serial' && serial.connected);
    if (!live) {
      appState.reportStatus({ level: 'info', message: 'Conecta primero con el prototipo (🔌 Conectar).' });
      return;
    }
    if (failsafeActive) {
      appState.reportStatus({ level: 'warning', message: 'Rearma el failsafe antes de iniciar el ensayo.' });
      return;
    }
    if (!lastLive || performance.now() - lastLive.at > 1000) {
      appState.reportStatus({ level: 'warning', message: 'No está llegando telemetría del prototipo.' });
      return;
    }
    stepTest = new StepSequence({ u0 });
    applyStepUpdate(stepTest.start(lastLive.s.t, lastLive.s.height * 100));
  };

  /** Cancelar el ensayo; sin apagar el motor cuando el usuario toma el control (PWM manual o PID) */
  const cancelStepTest = (reason: string, stopMotor = true): void => {
    if (!stepTest?.active) return;
    const u = stepTest.abort(reason);
    applyStepUpdate(stopMotor ? u : { ...u, commands: [] });
  };

  // Estado de la conexión WiFi → indicador del panel y HUD.
  let wifiConnState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  wifi.onConnectionState((s) => {
    wifiConnState = s;
    params.setWifiState(s);
    updateHudStatus(lastMetrics?.settled ?? false);
  });

  const updateHudStatus = (settled = false) => {
    if (failsafeActive) hud.setStatus('failsafe');
    else if (!appState.running) hud.setStatus('paused');
    else if (appState.mode === 'wifi') hud.setStatus(wifiConnState === 'connected' ? 'live' : 'connecting');
    else if (appState.mode === 'serial') hud.setStatus('live');
    else hud.setStatus(settled ? 'settled' : 'running');
  };

  const resetActive = () => {
    failsafeActive = false;
    lastEsp = {};
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
      // Serial: indicador simple. WiFi: lo gobierna el callback de estado
      // de conexión (conectando → conectado → reintento silencioso).
      if (source === serial) params.setSerialConnected(serial.connected);
    } else {
      cancelStepTest('se cerró la conexión con el prototipo.');
      await source.stop();
      if (source === serial) params.setSerialConnected(false);
      if (source === wifi) params.setWifiConnected(false);
      if ((source === serial || source === wifi) && recorder.count > 1) {
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
    cancelStepTest('se cambió de modo.');
    // Detener todas las fuentes que no sean la nueva
    for (const [m, source] of Object.entries(sources)) {
      if (m !== mode) await source.stop();
    }
    params.setSerialConnected(false);
    params.setWifiConnected(false);
    appState.setRunning(false);
    hud.setMode(mode);
    resetActive();
    if (mode !== 'simulacion') {
      scene.snapTo(simulation.model.state.height);
      scene.setSetpoint(null);
    }
    // Autoconexión: USB si hay puerto ESP32 autorizado; WiFi siempre puede.
    if (mode === 'serial' && serial.autoConnect && serial.hasSavedPort()) {
      appState.setRunning(true);
    }
    if (mode === 'wifi' && wifi.autoConnect) {
      appState.setRunning(true);
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
