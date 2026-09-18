/**
 * CameraRig — cámara perspectiva + OrbitControls
 *
 * Posición inicial en 3/4 mostrando todo el marco (spec.md §7).
 * Incluye botón "Resetear cámara" en el HUD.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FRAME_HEIGHT_M } from '../physics/constants';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  // Posición y target iniciales (vista 3/4 del marco completo)
  private readonly initialPosition = new THREE.Vector3(0.6, 0.55, 0.8);
  private readonly initialTarget = new THREE.Vector3(0, FRAME_HEIGHT_M * 0.45, 0);

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 50);
    this.camera.position.copy(this.initialPosition);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.initialTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 3;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.update();
  }

  /** Resetear la cámara a la posición inicial (vista 3/4) */
  reset(): void {
    this.camera.position.copy(this.initialPosition);
    this.controls.target.copy(this.initialTarget);
    this.controls.update();
  }

  /** Actualizar aspect ratio al redimensionar */
  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Llamar cada frame para el damping de OrbitControls */
  update(): void {
    this.controls.update();
  }
}
