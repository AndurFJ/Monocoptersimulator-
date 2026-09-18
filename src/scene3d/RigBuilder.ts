/**
 * RigBuilder — construye la geometría 3D del banco de pruebas proceduralmente.
 *
 * Escala 1:1 (unidades Three.js = metros). Referencia: spec.md §7 + monocoptero-real.jpg
 *
 * Jerarquía:
 *   Rig (grupo raíz, estático)
 *     ├── Frame (marco de madera: postes + travesaños)
 *     ├── Rails (2 varillas de acero)
 *     ├── Springs (2 resortes en la base)
 *     ├── Base (tarima)
 *     ├── Sensors (2 ultrasónicos)
 *     ├── PCB (placa controladora)
 *     ├── Battery (LiPo)
 *     └── Carriage (grupo móvil en Y)
 *           ├── Platform (tabla)
 *           ├── Bushings (bujes lineales)
 *           ├── ESC (caja metálica)
 *           └── MotorAssembly (grupo que rota)
 *                 ├── MotorBody
 *                 ├── MotorBell
 *                 └── Propeller (2 palas)
 */

import * as THREE from 'three';
import {
  matWood, matWoodDark, matSteel, matSpring, matSilver,
  matMotorBody, matPropeller, matMotorBell,
  matESC, matPCB, matBattery, matRubber,
  matCableRed, matCableBlack, matCableBlue,
} from './materials';
import {
  FRAME_HEIGHT_M, FRAME_WIDTH_M, WOOD_THICKNESS_M, FRAME_DEPTH_M,
  RAIL_DIAMETER_M, RAIL_SEPARATION_M, SPRING_NATURAL_LENGTH_M,
} from '../physics/constants';

/** Resultado del builder: grupo raíz + referencias a las partes móviles */
export interface RigParts {
  rig: THREE.Group;
  carriage: THREE.Group;
  propeller: THREE.Group;
  springs: { left: THREE.Mesh; right: THREE.Mesh };
}

export class RigBuilder {

  build(): RigParts {
    const rig = new THREE.Group();
    rig.name = 'monocoptero-rig';

    // ── Base de madera ──────────────────────────────────────────
    const base = this.buildBase();
    rig.add(base);

    // ── Marco de madera ─────────────────────────────────────────
    const frame = this.buildFrame();
    rig.add(frame);

    // ── Varillas guía ───────────────────────────────────────────
    const rails = this.buildRails();
    rig.add(rails);

    // ── Resortes ────────────────────────────────────────────────
    const { group: springsGroup, leftSpring, rightSpring } = this.buildSprings();
    rig.add(springsGroup);

    // ── Sensores ultrasónicos ───────────────────────────────────
    const sensors = this.buildSensors();
    rig.add(sensors);

    // ── PCB controladora ────────────────────────────────────────
    const pcb = this.buildPCB();
    rig.add(pcb);

    // ── Batería LiPo ────────────────────────────────────────────
    const battery = this.buildBattery();
    rig.add(battery);

    // ── Carro (grupo móvil) ─────────────────────────────────────
    const { carriageGroup, propellerGroup } = this.buildCarriage();
    rig.add(carriageGroup);

    // ── Cables decorativos ──────────────────────────────────────
    const cables = this.buildCables(carriageGroup.position.y);
    rig.add(cables);

    // Centrar el rig para que la base esté en Y=0
    // El marco va de Y=0 (base) a Y=FRAME_HEIGHT_M (tope)

    return {
      rig,
      carriage: carriageGroup,
      propeller: propellerGroup,
      springs: { left: leftSpring, right: rightSpring },
    };
  }

  // ── Componentes individuales ────────────────────────────────────

  private buildBase(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'base';

    // Tarima principal
    const baseGeo = new THREE.BoxGeometry(FRAME_WIDTH_M + 0.06, 0.02, FRAME_DEPTH_M + 0.10);
    const baseMesh = new THREE.Mesh(baseGeo, matWoodDark);
    baseMesh.position.set(0, 0.01, 0);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    return group;
  }

  private buildFrame(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'frame';

    const hw = FRAME_WIDTH_M / 2; // media anchura
    const t = WOOD_THICKNESS_M;
    const d = FRAME_DEPTH_M;
    const h = FRAME_HEIGHT_M;

    // Poste izquierdo
    const postGeo = new THREE.BoxGeometry(t, h, d);
    const postL = new THREE.Mesh(postGeo, matWood);
    postL.position.set(-hw + t / 2, h / 2 + 0.02, 0);
    postL.castShadow = true;
    postL.receiveShadow = true;
    group.add(postL);

    // Poste derecho
    const postR = new THREE.Mesh(postGeo, matWood);
    postR.position.set(hw - t / 2, h / 2 + 0.02, 0);
    postR.castShadow = true;
    postR.receiveShadow = true;
    group.add(postR);

    // Travesaño superior
    const crossGeo = new THREE.BoxGeometry(FRAME_WIDTH_M, t, d);
    const crossTop = new THREE.Mesh(crossGeo, matWood);
    crossTop.position.set(0, h + 0.02 - t / 2, 0);
    crossTop.castShadow = true;
    crossTop.receiveShadow = true;
    group.add(crossTop);

    // Travesaño inferior (justo encima de la base)
    const crossBot = new THREE.Mesh(crossGeo, matWood);
    crossBot.position.set(0, 0.02 + t / 2, 0);
    crossBot.castShadow = true;
    crossBot.receiveShadow = true;
    group.add(crossBot);

    return group;
  }

  private buildRails(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'rails';

    const railRadius = RAIL_DIAMETER_M / 2;
    // Las varillas van desde el travesaño inferior hasta el superior
    const railHeight = FRAME_HEIGHT_M - WOOD_THICKNESS_M * 2;
    const railGeo = new THREE.CylinderGeometry(railRadius, railRadius, railHeight, 16);

    const railY = 0.02 + WOOD_THICKNESS_M + railHeight / 2;

    // Varilla izquierda
    const railL = new THREE.Mesh(railGeo, matSteel);
    railL.position.set(-RAIL_SEPARATION_M / 2, railY, 0);
    railL.castShadow = true;
    group.add(railL);

    // Varilla derecha
    const railR = new THREE.Mesh(railGeo, matSteel);
    railR.position.set(RAIL_SEPARATION_M / 2, railY, 0);
    railR.castShadow = true;
    group.add(railR);

    return group;
  }

  private buildSprings(): { group: THREE.Group; leftSpring: THREE.Mesh; rightSpring: THREE.Mesh } {
    const group = new THREE.Group();
    group.name = 'springs';

    const springY = 0.02 + WOOD_THICKNESS_M + SPRING_NATURAL_LENGTH_M / 2;

    const leftSpring = this.createSpringMesh();
    leftSpring.position.set(-RAIL_SEPARATION_M / 2, springY, 0);
    group.add(leftSpring);

    const rightSpring = this.createSpringMesh();
    rightSpring.position.set(RAIL_SEPARATION_M / 2, springY, 0);
    group.add(rightSpring);

    // Bases negras de los resortes (rubber caps)
    const capGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.015, 12);

    const capLBot = new THREE.Mesh(capGeo, matRubber);
    capLBot.position.set(-RAIL_SEPARATION_M / 2, 0.02 + WOOD_THICKNESS_M + 0.007, 0);
    group.add(capLBot);

    const capRBot = new THREE.Mesh(capGeo, matRubber);
    capRBot.position.set(RAIL_SEPARATION_M / 2, 0.02 + WOOD_THICKNESS_M + 0.007, 0);
    group.add(capRBot);

    const capLTop = new THREE.Mesh(capGeo, matRubber);
    capLTop.position.set(-RAIL_SEPARATION_M / 2, 0.02 + WOOD_THICKNESS_M + SPRING_NATURAL_LENGTH_M - 0.007, 0);
    group.add(capLTop);

    const capRTop = new THREE.Mesh(capGeo, matRubber);
    capRTop.position.set(RAIL_SEPARATION_M / 2, 0.02 + WOOD_THICKNESS_M + SPRING_NATURAL_LENGTH_M - 0.007, 0);
    group.add(capRTop);

    return { group, leftSpring, rightSpring };
  }

  /** Genera un resorte helicoidal usando TubeGeometry sobre una curva paramétrica */
  private createSpringMesh(): THREE.Mesh {
    const coils = 8;
    const springHeight = SPRING_NATURAL_LENGTH_M;
    const radius = 0.010; // radio de la hélice
    const wireRadius = 0.0015; // grosor del alambre

    // Generar puntos de la hélice
    const points: THREE.Vector3[] = [];
    const segments = coils * 24;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * coils * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        (t - 0.5) * springHeight,
        Math.sin(angle) * radius,
      ));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, segments, wireRadius, 6, false);
    const mesh = new THREE.Mesh(tubeGeo, matSpring);
    mesh.castShadow = true;
    return mesh;
  }

  private buildSensors(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'sensors';

    // 2 sensores ultrasónicos tipo HC-SR04 en la base
    const sensorGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.012, 12);
    const sensorY = 0.02 + WOOD_THICKNESS_M + 0.006;

    // Sensor izquierdo — al lado del riel izquierdo
    const s1 = new THREE.Mesh(sensorGeo, matSilver);
    s1.position.set(-0.04, sensorY, 0.02);
    group.add(s1);

    // Sensor derecho — un poco separado
    const s2 = new THREE.Mesh(sensorGeo, matSilver);
    s2.position.set(-0.02, sensorY, 0.02);
    group.add(s2);

    return group;
  }

  private buildPCB(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'pcb';

    // Placa controladora pequeña en la base
    const pcbGeo = new THREE.BoxGeometry(0.04, 0.008, 0.03);
    const pcbMesh = new THREE.Mesh(pcbGeo, matPCB);
    pcbMesh.position.set(0.02, 0.02 + WOOD_THICKNESS_M + 0.004, 0.025);
    pcbMesh.castShadow = true;
    group.add(pcbMesh);

    // Pequeños componentes sobre el PCB
    const compGeo = new THREE.BoxGeometry(0.008, 0.006, 0.008);
    const comp1 = new THREE.Mesh(compGeo, matMotorBody);
    comp1.position.set(0.015, 0.02 + WOOD_THICKNESS_M + 0.011, 0.025);
    group.add(comp1);

    const comp2 = new THREE.Mesh(compGeo, matMotorBody);
    comp2.position.set(0.03, 0.02 + WOOD_THICKNESS_M + 0.011, 0.025);
    group.add(comp2);

    return group;
  }

  private buildBattery(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'battery';

    // Batería LiPo envuelta en cinta negra, sujeta al poste derecho
    const battGeo = new THREE.BoxGeometry(0.035, 0.14, 0.03);
    const battMesh = new THREE.Mesh(battGeo, matBattery);
    const postX = FRAME_WIDTH_M / 2 - WOOD_THICKNESS_M / 2;
    battMesh.position.set(postX + 0.02, 0.30, 0);
    battMesh.castShadow = true;
    group.add(battMesh);

    // Cables de la batería (rojo y negro saliendo de arriba)
    const cableGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.06, 6);

    const cableR = new THREE.Mesh(cableGeo, matCableRed);
    cableR.position.set(postX + 0.015, 0.40, -0.005);
    cableR.rotation.z = 0.3;
    group.add(cableR);

    const cableB = new THREE.Mesh(cableGeo, matCableBlack);
    cableB.position.set(postX + 0.025, 0.40, 0.005);
    cableB.rotation.z = -0.2;
    group.add(cableB);

    return group;
  }

  private buildCarriage(): { carriageGroup: THREE.Group; propellerGroup: THREE.Group } {
    const carriageGroup = new THREE.Group();
    carriageGroup.name = 'carriage';

    // Posición inicial del carro — justo arriba de los resortes
    const initialY = 0.02 + WOOD_THICKNESS_M + SPRING_NATURAL_LENGTH_M + 0.01;
    carriageGroup.position.y = initialY;

    // ── Plataforma (tabla del carro) ─────────────────────────
    const platformGeo = new THREE.BoxGeometry(0.22, 0.012, 0.08);
    const platform = new THREE.Mesh(platformGeo, matWood);
    platform.position.set(0, 0, 0);
    platform.castShadow = true;
    platform.receiveShadow = true;
    carriageGroup.add(platform);

    // ── Bujes lineales (cilindros plateados en las varillas) ─
    const bushingGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.025, 12);

    const bushL = new THREE.Mesh(bushingGeo, matSilver);
    bushL.position.set(-RAIL_SEPARATION_M / 2, 0.005, 0);
    carriageGroup.add(bushL);

    const bushR = new THREE.Mesh(bushingGeo, matSilver);
    bushR.position.set(RAIL_SEPARATION_M / 2, 0.005, 0);
    carriageGroup.add(bushR);

    // ── ESC (caja metálica perforada debajo del motor) ───────
    const escGeo = new THREE.BoxGeometry(0.07, 0.035, 0.06);
    const esc = new THREE.Mesh(escGeo, matESC);
    esc.position.set(0, -0.030, 0);
    esc.castShadow = true;
    carriageGroup.add(esc);

    // Ranuras del ESC (simulan la rejilla de ventilación)
    for (let i = -2; i <= 2; i++) {
      const slotGeo = new THREE.BoxGeometry(0.05, 0.002, 0.062);
      const slot = new THREE.Mesh(slotGeo, matMotorBody);
      slot.position.set(0, -0.030 + i * 0.007, 0);
      carriageGroup.add(slot);
    }

    // ── Motor brushless + hélice ─────────────────────────────
    const propellerGroup = new THREE.Group();
    propellerGroup.name = 'propeller-assembly';

    // Cuerpo del motor (cilindro oscuro)
    const motorBodyGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.020, 16);
    const motorBody = new THREE.Mesh(motorBodyGeo, matMotorBody);
    motorBody.position.set(0, 0.016, 0);
    propellerGroup.add(motorBody);

    // Campana del motor (parte superior, dorada/naranja)
    const bellGeo = new THREE.CylinderGeometry(0.016, 0.014, 0.012, 16);
    const bell = new THREE.Mesh(bellGeo, matMotorBell);
    bell.position.set(0, 0.028, 0);
    bell.castShadow = true;
    propellerGroup.add(bell);

    // Eje del motor (varilla fina arriba)
    const shaftGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.015, 8);
    const shaft = new THREE.Mesh(shaftGeo, matSteel);
    shaft.position.set(0, 0.041, 0);
    propellerGroup.add(shaft);

    // Hélice bipala — 2 palas naranjas
    const bladeLength = 0.065;
    const bladeWidth = 0.015;
    const bladeThickness = 0.003;
    const bladeGeo = new THREE.BoxGeometry(bladeLength, bladeThickness, bladeWidth);

    // Pala 1
    const blade1 = new THREE.Mesh(bladeGeo, matPropeller);
    blade1.position.set(bladeLength / 2 + 0.003, 0.045, 0);
    blade1.rotation.z = 0.15; // ligera inclinación
    blade1.castShadow = true;
    propellerGroup.add(blade1);

    // Pala 2 (opuesta)
    const blade2 = new THREE.Mesh(bladeGeo, matPropeller);
    blade2.position.set(-bladeLength / 2 - 0.003, 0.045, 0);
    blade2.rotation.z = -0.15;
    blade2.castShadow = true;
    propellerGroup.add(blade2);

    // Hub central de la hélice
    const hubGeo = new THREE.CylinderGeometry(0.006, 0.005, 0.008, 12);
    const hub = new THREE.Mesh(hubGeo, matSilver);
    hub.position.set(0, 0.045, 0);
    propellerGroup.add(hub);

    // Spinner (cono en la punta)
    const spinnerGeo = new THREE.ConeGeometry(0.005, 0.010, 12);
    const spinner = new THREE.Mesh(spinnerGeo, matSilver);
    spinner.position.set(0, 0.052, 0);
    propellerGroup.add(spinner);

    carriageGroup.add(propellerGroup);

    // ── Cables del carro al ESC/motor ────────────────────────
    const cableGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.05, 6);

    const cable1 = new THREE.Mesh(cableGeo, matCableRed);
    cable1.position.set(0.02, -0.005, 0.02);
    cable1.rotation.z = 0.5;
    carriageGroup.add(cable1);

    const cable2 = new THREE.Mesh(cableGeo, matCableBlack);
    cable2.position.set(-0.02, -0.005, 0.02);
    cable2.rotation.z = -0.5;
    carriageGroup.add(cable2);

    return { carriageGroup, propellerGroup };
  }

  /** Cables decorativos que van del carro hacia la base */
  private buildCables(carriageY: number): THREE.Group {
    const group = new THREE.Group();
    group.name = 'cables';

    const cableGeo = new THREE.CylinderGeometry(0.0015, 0.0015, carriageY - 0.06, 6);

    const c1 = new THREE.Mesh(cableGeo, matCableBlue);
    c1.position.set(0.05, (carriageY - 0.06) / 2 + 0.06, 0.015);
    group.add(c1);

    const c2 = new THREE.Mesh(cableGeo, matCableRed);
    c2.position.set(0.055, (carriageY - 0.06) / 2 + 0.06, 0.018);
    group.add(c2);

    const c3 = new THREE.Mesh(cableGeo, matCableBlack);
    c3.position.set(0.045, (carriageY - 0.06) / 2 + 0.06, 0.012);
    group.add(c3);

    return group;
  }
}
