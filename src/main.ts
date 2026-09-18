/**
 * main.ts — Entry point del Simulador 3D del Monocóptero
 *
 * Inicializa la estructura HTML del layout y monta la escena 3D.
 */

import './styles/main.css';
import { SceneManager } from './scene3d/SceneManager';

let sceneManager: SceneManager | null = null;

// ── Construir el layout HTML ────────────────────────────────────

function createLayout(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('No se encontró el elemento #app');

  app.innerHTML = `
    <!-- Panel 3D (izquierda, 60%) -->
    <div id="panel-3d">
      <div id="hud">
        <div>
          <span class="hud-label">Altura</span>
          <span class="hud-value" id="hud-height">0.000 m</span>
        </div>
        <div>
          <span class="hud-label">PWM</span>
          <span class="hud-value" id="hud-pwm">0</span>
        </div>
        <div>
          <span class="hud-label">Tiempo</span>
          <span class="hud-value" id="hud-time">0.0 s</span>
        </div>
        <div>
          <span class="hud-label">Modo</span>
          <span class="hud-value" id="hud-mode">Simulación</span>
        </div>
      </div>

      <!-- Botón resetear cámara -->
      <button id="btn-reset-camera" class="btn-hud" title="Resetear cámara">
        ⟲ Cámara
      </button>

      <!-- Placeholder — se reemplaza al montar la escena 3D -->
      <div class="placeholder-message" id="canvas-placeholder">
        <div class="icon">⚙</div>
        <div class="text">Cargando escena 3D…</div>
      </div>
    </div>

    <!-- Panel derecho (40%) -->
    <div id="panel-right">
      <!-- Parámetros (arriba) -->
      <div id="panel-params">
        <div class="panel-title">Parámetros de Control</div>
        <div class="placeholder-message" style="height: auto; padding: 2rem 0;">
          <div class="text">Controles — pendiente Fase 2</div>
        </div>
      </div>

      <!-- Gráficas (abajo) -->
      <div id="panel-charts">
        <div class="panel-title">Gráficas en Tiempo Real</div>
        <div class="placeholder-message" style="height: auto; padding: 2rem 0;">
          <div class="text">Gráficas — pendiente Fase 4</div>
        </div>
      </div>
    </div>
  `;
}

// ── Montar la escena 3D ─────────────────────────────────────────

function mount3DScene(): void {
  const container = document.getElementById('panel-3d');
  if (!container) return;

  sceneManager = new SceneManager(container);
  sceneManager.start();

  // Botón resetear cámara
  const btnReset = document.getElementById('btn-reset-camera');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      sceneManager?.resetCamera();
    });
  }

  console.log('[Simulador Monocóptero] Escena 3D montada y en ejecución');
}

// ── Inicialización ──────────────────────────────────────────────

function init(): void {
  createLayout();
  mount3DScene();
  console.log('[Simulador Monocóptero] Fase 1 — Escena 3D estática lista');
}

// Arrancar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
