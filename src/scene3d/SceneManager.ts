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
import { matFloor } from './materials';
import {
  WOOD_THICKNESS_M, SPRING_NATURAL_LENGTH_M,
  H_MAX, PWM_MIN, PWM_MAX,
} from '../physics/constants';

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraRig: CameraRig;
  private rigParts: RigParts;
  private resizeObserver: ResizeObserver;
  private animFrameId = 0;
  private running = false;

  // Posición base del carro (Y cuando height=0)
  private readonly carriageBaseY: number;

  // Velocidad angular máxima de la hélice (rad/s) a PWM máximo
  private readonly maxAngularSpeed = 120; // ~1146 RPM visual (suficiente para verse rápido)

  constructor(container: HTMLElement) {
    // ── Renderer ──────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    // Calcular posición base del carro
    this.carriageBaseY = 0.02 + WOOD_THICKNESS_M + SPRING_NATURAL_LENGTH_M + 0.01;

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

  /** Actualizar posición del carro y velocidad de la hélice */
  update(height: number, pwm: number, dt: number): void {
    // Mover el carro según la altura (mapear height → posición Y en la escena)
    const targetY = this.carriageBaseY + Math.max(0, Math.min(height, H_MAX));
    this.rigParts.carriage.position.y = targetY;

    // Rotar la hélice según el PWM
    const normalizedPwm = Math.max(0, Math.min(1, (pwm - PWM_MIN) / (PWM_MAX - PWM_MIN)));
    const angularSpeed = normalizedPwm * this.maxAngularSpeed;
    this.rigParts.propeller.rotation.y += angularSpeed * dt;

    // Comprimir visualmente los resortes cuando el carro está cerca del fondo
    this.updateSprings(height);
  }

  /** Actualizar compresión visual de los resortes */
  private updateSprings(height: number): void {
    const compressionFactor = Math.max(0.3, Math.min(1, height / 0.08 + 0.3));
    this.rigParts.springs.left.scale.y = compressionFactor;
    this.rigParts.springs.right.scale.y = compressionFactor;
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
