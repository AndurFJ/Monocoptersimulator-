/**
 * materials.ts — Materiales reutilizables de Three.js
 * Colores y acabados fieles a la foto de referencia (spec.md §7)
 */

import * as THREE from 'three';

// ── Madera ───────────────────────────────────────────────────────

/** Material madera — marco, carro, base (café claro con veta) */
export const matWood = new THREE.MeshStandardMaterial({
  color: 0xc9a06a,
  roughness: 0.85,
  metalness: 0.0,
});

/** Material madera base — ligeramente más oscuro */
export const matWoodDark = new THREE.MeshStandardMaterial({
  color: 0xa88050,
  roughness: 0.9,
  metalness: 0.0,
});

// ── Metal ────────────────────────────────────────────────────────

/** Material acero pulido — varillas guía */
export const matSteel = new THREE.MeshStandardMaterial({
  color: 0xc8c8cc,
  roughness: 0.25,
  metalness: 0.85,
});

/** Material metal oscuro — resortes */
export const matSpring = new THREE.MeshStandardMaterial({
  color: 0x555555,
  roughness: 0.4,
  metalness: 0.7,
});

/** Material plata — bujes lineales, sensores ultrasónicos */
export const matSilver = new THREE.MeshStandardMaterial({
  color: 0xb0b0b5,
  roughness: 0.3,
  metalness: 0.8,
});

// ── Motor y hélice ───────────────────────────────────────────────

/** Material motor — cuerpo oscuro del motor brushless */
export const matMotorBody = new THREE.MeshStandardMaterial({
  color: 0x333333,
  roughness: 0.5,
  metalness: 0.6,
});

/** Material hélice — naranja brillante (spec: #ff5522) */
export const matPropeller = new THREE.MeshStandardMaterial({
  color: 0xff5522,
  roughness: 0.4,
  metalness: 0.1,
  side: THREE.DoubleSide,
});

/** Material campana del motor — plateado/dorado */
export const matMotorBell = new THREE.MeshStandardMaterial({
  color: 0xcc9933,
  roughness: 0.3,
  metalness: 0.75,
});

// ── Electrónica ──────────────────────────────────────────────────

/** Material ESC — metal oscuro perforado */
export const matESC = new THREE.MeshStandardMaterial({
  color: 0x888888,
  roughness: 0.5,
  metalness: 0.7,
});

/** Material PCB — verde oscuro */
export const matPCB = new THREE.MeshStandardMaterial({
  color: 0x1a5c2a,
  roughness: 0.7,
  metalness: 0.1,
});

/** Material batería — negro mate */
export const matBattery = new THREE.MeshStandardMaterial({
  color: 0x1a1a1a,
  roughness: 0.95,
  metalness: 0.0,
});

// ── Cables ───────────────────────────────────────────────────────

/** Material cable rojo */
export const matCableRed = new THREE.MeshStandardMaterial({
  color: 0xcc2222,
  roughness: 0.6,
  metalness: 0.1,
});

/** Material cable negro */
export const matCableBlack = new THREE.MeshStandardMaterial({
  color: 0x222222,
  roughness: 0.6,
  metalness: 0.1,
});

/** Material cable azul (señal) */
export const matCableBlue = new THREE.MeshStandardMaterial({
  color: 0x2255cc,
  roughness: 0.6,
  metalness: 0.1,
});

// ── Suelo / entorno ──────────────────────────────────────────────

/** Material piso del entorno */
export const matFloor = new THREE.MeshStandardMaterial({
  color: 0x2a2a30,
  roughness: 0.95,
  metalness: 0.0,
});

/** Material negro rubber — bases de resortes */
export const matRubber = new THREE.MeshStandardMaterial({
  color: 0x111111,
  roughness: 0.95,
  metalness: 0.0,
});
