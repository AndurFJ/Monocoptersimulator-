/**
 * SceneManager — inicializa y gestiona la escena Three.js completa.
 *
 * Responsabilidades:
 * - Crear renderer, scene, iluminación
 * - Instanciar RigBuilder y CameraRig
 * - Gestionar el loop de render (requestAnimationFrame)
 * - Exponer métodos para actualizar el carro y la hélice
 * - Gestionar ResizeObserver para adaptar el canvas
 */

import * as THREE from 'three';
import { RigBuilder } from './RigBuilder';
import type { RigParts } from './RigBuilder';
import { CameraRig } from './CameraRig';
import { matFloor, matPropeller, matPropellerBlur } from './materials';
import {
  SPRING_NATURAL_LENGTH_M, SPRING_ENGAGE_HEIGHT_M, MOTOR_TIME_CONSTANT_S,
  H_MIN, H_MAX,
} from '../physics/constants';
import { normalizePwm } from '../physics/MonocopterModel';
import { SPRING_BASE_Y, CARRIAGE_BOTTOM_OFFSET, carriageYForHeight } from './geometry';

/** Mitad del alto de las tapas de goma de los resortes */
const SPRING_CAP_HALF = 0.007;

/** Constante de tiempo del suavizado visual del carro [s] */
const SMOOTHING_TAU = 0.03;

/**
 * Velocidad de giro que se dibuja [rad/s]. Un brushless real gira a miles de
 * RPM, imposible de mostrar a 60 fps (aliasing); por encima de esto se
 * desvanecen las palas y aparece el disco de barrido.
 */
const MAX_VISUAL_SPIN = 32;

/** Amplitud máxima de la vibración del carro a plena potencia [m] */
const VIBRATION_AMPLITUDE = 0.0006;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraRig: CameraRig;
  private rigParts: RigParts;
  private resizeObserver: ResizeObserver;
  private animFrameId = 0;
  private running = false;
  private readonly clock = new THREE.Timer();

  // Último estado recibido y estado mostrado (suavizado)
  private targetHeight = SPRING_ENGAGE_HEIGHT_M;
  private targetPwm = 0;
  private shownHeight = SPRING_ENGAGE_HEIGHT_M;
  /** Velocidad del rotor mostrada ∈ [0,1] (sigue al PWM con la inercia del motor) */
  private rotorSpeed = 0;
  private setpointShown: number | null = null;

  constructor(container: HTMLElement) {
    // ── Renderer ──────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.setClearColor(0x12141a);

    // Insertar el canvas en el contenedor (reemplazar placeholder)
    const placeholder = container.querySelector('#canvas-placeholder');
    if (placeholder) placeholder.remove();
    container.appendChild(this.renderer.domElement);

    // Tamaño inicial
    const { clientWidth: w, clientHeight: h } = container;
    this.renderer.setSize(w, h);

    // ── Scene ─────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x12141a, 3, 8);

    // ── Iluminación ───────────────────────────────────────────
    this.setupLights();

    // ── Suelo ─────────────────────────────────────────────────
    this.setupFloor();

    // ── Construir el rig ──────────────────────────────────────
    const builder = new RigBuilder();
    this.rigParts = builder.build();
    this.scene.add(this.rigParts.rig);

    // ── Cámara ────────────────────────────────────────────────
    this.cameraRig = new CameraRig(this.renderer.domElement, w, h);

    this.update(this.shownHeight, 0, 0);

    // ── ResizeObserver ─────────────────────────────────────────
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this.renderer.setSize(width, height);
          this.cameraRig.resize(width, height);
        }
      }
    });
    this.resizeObserver.observe(container);
  }

  private setupLights(): void {
    // Luz hemisférica (ambiente suave: cielo azulado, suelo cálido)
    const hemiLight = new THREE.HemisphereLight(0x8899bb, 0x443322, 0.6);
    hemiLight.position.set(0, 5, 0);
    this.scene.add(hemiLight);

    // Luz direccional principal (con sombras)
    const dirLight = new THREE.DirectionalLight(0xffeedd, 1.8);
    dirLight.position.set(2, 3, 2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 10;
    dirLight.shadow.camera.left = -1.5;
    dirLight.shadow.camera.right = 1.5;
    dirLight.shadow.camera.top = 2;
    dirLight.shadow.camera.bottom = -0.5;
    dirLight.shadow.bias = -0.002;
    this.scene.add(dirLight);

    // Luz de relleno (más suave, desde el otro lado)
    const fillLight = new THREE.DirectionalLight(0xaabbcc, 0.4);
    fillLight.position.set(-1, 2, -1);
    this.scene.add(fillLight);

    // Punto de luz cálido para dar volumen a la madera
    const warmPoint = new THREE.PointLight(0xffaa55, 0.3, 4);
    warmPoint.position.set(0.5, 0.3, 0.5);
    this.scene.add(warmPoint);
  }

  private setupFloor(): void {
    const floorGeo = new THREE.PlaneGeometry(6, 6);
    const floor = new THREE.Mesh(floorGeo, matFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Grid sutil como referencia
    const grid = new THREE.GridHelper(4, 40, 0x333344, 0x222233);
    grid.position.y = 0.001;
    this.scene.add(grid);
  }

  // ── API pública ─────────────────────────────────────────────────

  /** Registrar la última telemetría; el loop de render la aplica suavizada */
  setTelemetry(height: number, pwm: number, setpoint?: number): void {
    this.targetHeight = height;
    this.targetPwm = pwm;
    this.setSetpoint(setpoint ?? null);
  }

  /** Mostrar (o esconder con null) el marcador de altura objetivo */
  setSetpoint(setpoint: number | null): void {
    const sp = setpoint === null ? null : Math.max(H_MIN, Math.min(setpoint, H_MAX));
    if (sp === this.setpointShown) return;
    this.setpointShown = sp;
    const { setpointMarker, setSetpointLabel } = this.rigParts;
    setpointMarker.visible = sp !== null;
    if (sp === null) return;
    setpointMarker.position.y = carriageYForHeight(sp);
    setSetpointLabel(`${(sp * 100).toFixed(1)} cm`);
  }

  /** Mover el carro a una altura sin suavizado (p.ej. tras un reset) */
  snapTo(height: number, pwm = 0): void {
    this.setTelemetry(height, pwm);
    this.shownHeight = height;
    this.rotorSpeed = normalizePwm(pwm);
    this.update(height, pwm, 0);
  }

  /** Actualizar posición del carro y velocidad de la hélice */
  update(height: number, pwm: number, dt: number): void {
    const h = Math.max(H_MIN, Math.min(height, H_MAX));
    const carriageY = carriageYForHeight(h);
    const { carriage, propeller, propellerBlur } = this.rigParts;

    // El rotor acelera/frena con la inercia del motor (acepta PWM en µs o 0-255)
    if (dt > 0) {
      const k = 1 - Math.exp(-dt / MOTOR_TIME_CONSTANT_S);
      this.rotorSpeed += (normalizePwm(pwm) - this.rotorSpeed) * k;
    }
    const speed = this.rotorSpeed;

    // Hélice: giro visible a baja velocidad; a alta, palas difusas + disco de barrido
    propeller.rotation.y -= Math.min(speed * 400, MAX_VISUAL_SPIN) * dt;
    const blur = smoothstep(0.05, 0.35, speed);
    matPropeller.opacity = 1 - 0.8 * blur;
    matPropeller.depthWrite = blur < 0.5;
    matPropellerBlur.opacity = 0.45 * blur;
    propellerBlur.visible = blur > 0.01;

    // Vibración del motor transmitida al carro
    const amp = VIBRATION_AMPLITUDE * speed;
    carriage.position.set((Math.random() - 0.5) * amp, carriageY + (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    carriage.rotation.z = (Math.random() - 0.5) * amp * 2;

    // Comprimir visualmente los resortes cuando el carro baja de su punto de contacto
    this.updateSprings(carriageY - CARRIAGE_BOTTOM_OFFSET);
  }

  /** Los resortes van del travesaño hasta el carro (o su longitud natural si no hay contacto) */
  private updateSprings(carriageBottomY: number): void {
    const length = Math.max(0.2 * SPRING_NATURAL_LENGTH_M, Math.min(SPRING_NATURAL_LENGTH_M, carriageBottomY - SPRING_BASE_Y));
    const { springs, springCaps } = this.rigParts;
    for (const spring of [springs.left, springs.right]) {
      spring.scale.y = length / SPRING_NATURAL_LENGTH_M;
      spring.position.y = SPRING_BASE_Y + length / 2;
    }
    for (const cap of [springCaps.left, springCaps.right]) {
      cap.position.y = SPRING_BASE_Y + length - SPRING_CAP_HALF;
    }
  }

  /** Arrancar el loop de render */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  /** Loop de render con requestAnimationFrame */
  private loop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.1);

    // Suavizado exponencial: la física va a 50 Hz y el monitor a 60+ Hz
    const alpha = 1 - Math.exp(-dt / SMOOTHING_TAU);
    this.shownHeight += (this.targetHeight - this.shownHeight) * alpha;
    this.update(this.shownHeight, this.targetPwm, dt);

    this.cameraRig.update();
    this.renderer.render(this.scene, this.cameraRig.camera);
  };

  /** Detener el loop y liberar recursos */
  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }

  /** Resetear la cámara a la vista 3/4 inicial */
  resetCamera(): void {
    this.cameraRig.reset();
  }
}
