/**
 * Constantes físicas del banco de pruebas — spec.md §6
 *
 * Todos los valores numéricos del modelo viven aquí como constantes
 * con nombre. NUNCA hardcodear dentro de MonocopterModel.ts.
 *
 * Los valores marcados "TODO: confirmar con hardware real" son
 * placeholders razonables que deben afinarse con datos del ensayo.
 */

// ── Geometría del marco ──────────────────────────────────────────

/** Altura total del marco de madera [m] (deja ~100 cm de carrera al carro) */
export const FRAME_HEIGHT_M = 1.15;

/** Ancho del marco [m] — TODO: confirmar con hardware real */
export const FRAME_WIDTH_M = 0.50;

/** Profundidad (grosor) del marco [m] */
export const FRAME_DEPTH_M = 0.04;

/** Grosor de los travesaños y postes de madera [m] */
export const WOOD_THICKNESS_M = 0.04;

/** Diámetro de las varillas guía de acero [m] */
export const RAIL_DIAMETER_M = 0.008;

/** Separación entre ejes de las varillas [m] — TODO: confirmar */
export const RAIL_SEPARATION_M = 0.15;

/**
 * Escala de altura [m]: lo que mide el HC-SR04 desde la base hasta el carro.
 * El banco tiene 100 cm de carrera; toda la app trabaja con esta escala.
 */
export const RAIL_TRAVEL_M = 1.0;

// ── Zonas de operación (dato del banco real, en fracción del recorrido) ──

/** 0–12 cm: zona muerta. El carro descansa en los resortes (el sensor lee ≈ 11 cm) */
export const DEAD_ZONE_FRACTION = 0.12;

/** 85–100 cm: zona inestable. Coincide con el failsafe del firmware (85 cm) */
export const UNSTABLE_ZONE_FRACTION = 0.85;

/** Techo de la zona muerta [m] */
export const DEAD_ZONE_TOP_M = DEAD_ZONE_FRACTION * RAIL_TRAVEL_M;

/** Inicio de la zona inestable [m] */
export const UNSTABLE_ZONE_START_M = UNSTABLE_ZONE_FRACTION * RAIL_TRAVEL_M;

/**
 * Efecto techo: al acercarse al travesaño superior la hélice empuja más.
 * Ganancia extra de empuje en el tope: F = F₀ · (1 + G·s²), s ∈ [0,1] a lo
 * largo de la zona inestable. Crece con la altura → desestabiliza. — TODO: calibrar
 */
export const CEILING_THRUST_GAIN = 1.2;

/** Fuerza de turbulencia (desviación típica) en el tope de la zona inestable [N] — TODO: calibrar */
export const CEILING_TURBULENCE_N = 0.8;

/** Constante de tiempo de la turbulencia (ruido filtrado) [s] */
export const TURBULENCE_TIME_CONSTANT_S = 0.08;

// ── Masa y dinámica ──────────────────────────────────────────────

/** Masa total del carro (plataforma + motor + ESC + sensores) [kg] — TODO: confirmar */
export const CARRIAGE_MASS_KG = 0.35;

/** Aceleración gravitatoria [m/s²] */
export const GRAVITY = 9.81;

/** Coeficiente de empuje: F = k_t · u² donde u ∈ [0,1] — TODO: calibrar con datos reales */
export const THRUST_COEFFICIENT = 8.0;

/** Coeficiente de amortiguamiento viscoso (fricción con el aire/varillas) [N·s/m] — TODO: confirmar */
export const DAMPING_COEFFICIENT = 0.5;

/** Fricción estática/coulomb del riel [N] — TODO: confirmar */
export const RAIL_FRICTION_N = 0.05;

/**
 * Constante de tiempo del conjunto ESC + motor [s]: el empuje no cambia al
 * instante, sigue al comando con un retardo de primer orden — TODO: medir
 */
export const MOTOR_TIME_CONSTANT_S = 0.08;

// ── Resortes ─────────────────────────────────────────────────────

/** Rigidez efectiva de los resortes [N/m] — TODO: confirmar (o medir: "se comprime X cm con Y kg") */
export const SPRING_STIFFNESS = 500.0;

/**
 * Altura donde los resortes empiezan a comprimirse [m]. Con el carro apoyado
 * (motor apagado) los resortes ceden ~1 cm y el sensor lee REST_HEIGHT_M.
 */
export const SPRING_ENGAGE_HEIGHT_M = 0.12;

/** Lectura del HC-SR04 con el carro apoyado en los resortes [m] (ensayo 13/09/2026) */
export const REST_HEIGHT_M = 0.11;

/** Longitud natural (no comprimida) de los resortes [m] */
export const SPRING_NATURAL_LENGTH_M = 0.08;

// ── Límites de recorrido ─────────────────────────────────────────

/** Altura mínima absoluta del carro [m] (apoyado en resortes comprimidos) */
export const H_MIN = 0.0;

/** Altura máxima del carro [m] (tope superior del marco) */
export const H_MAX = RAIL_TRAVEL_M;

// ── Planta identificada (Fit 3, Smith & Corripio) ───────────────
// Gp(s) = K·e^(-t0·s)/(tau·s + 1), alrededor de (U0, Y0). Ver 03_matlab/IdentificacionFIT3.m

/** Ganancia estática [cm/µs] */
export const PLANT_K_CM_PER_US = 0.4302;

/** Constante de tiempo [s] */
export const PLANT_TAU_S = 1.5719;

/** Tiempo muerto [s] */
export const PLANT_DELAY_S = 0.1188;

/** PWM del punto de operación (hovering) [µs] */
export const PLANT_U0_US = 1762;

/** Altura del punto de operación [m] */
export const PLANT_Y0_M = 0.1345;

// ── Control PID (mismo algoritmo y unidades que el firmware) ────

/** Periodo de muestreo/control [s] — Ts = 50 ms, igual que el banco */
export const PID_DT = 0.05;

/** Ganancia proporcional [µs/cm] — SIMC con tau_c = 0.8 s sobre la planta identificada */
export const DEFAULT_KP = 4.0;

/** Ganancia integral [µs/(cm·s)] */
export const DEFAULT_KI = 2.5;

/** Ganancia derivativa [µs·s/cm] (sobre la medida, filtrada) */
export const DEFAULT_KD = 0.3;

/** Feedforward u₀ por defecto [µs]: PWM de equilibrio */
export const DEFAULT_U0_US = PLANT_U0_US;

// ── Ensayo de escalón en el banco (mismos tiempos que el firmware) ──

/** PWM con el que el carro flota quieto en ≈ 20 cm en el banco (01/10/2026) [µs] */
export const STEP_TEST_U0_US = 1840;

/** Escalón del firmware (DELTA_U_ESCALON) [µs] */
export const STEP_TEST_DELTA_US = 50;

/** Tramo en u₀ antes del salto (ESCALON_PREVIO_MS) [s] */
export const STEP_TEST_PRE_S = 5;

/** Duración total del escalón (ESCALON_TOTAL_MS) [s] */
export const STEP_TEST_TOTAL_S = 15;

/** Límites de la salida del PID [µs] */
export const PID_U_MIN = 1550;
export const PID_U_MAX = 1950;

/** Anti-windup: límite del término integral [µs] */
export const I_MAX = 250;

/** Peso de la derivada nueva en su filtro de primer orden */
export const D_FILTER = 0.3;

/** Rango permitido del setpoint [m] (fuera de él: zona muerta o failsafe) */
export const SETPOINT_MIN_M = 0.12;
export const SETPOINT_MAX_M = 0.80;

// ── Seguridad (igual que el firmware) ───────────────────────────

/** Altura de failsafe [m]: el firmware corta el motor */
export const FAILSAFE_M = 0.85;

/** Muestras seguidas por encima del límite para disparar el failsafe */
export const FAILSAFE_SAMPLES = 3;

// ── PWM ──────────────────────────────────────────────────────────

/** Valor mínimo de PWM — TODO: confirmar convención (µs 1000-2000 vs 0-255) */
export const PWM_MIN = 1000;

/** Valor máximo de PWM */
export const PWM_MAX = 2000;

// ── Sensor ultrasónico (HC-SR04 en la base, apuntando al carro) ─

/** Desviación estándar del ruido gaussiano del sensor [m] (ensayo real: ≈ 0.4 cm) */
export const SENSOR_NOISE_SIGMA_M = 0.004;

/** Rango mínimo del sensor HC-SR04 [m] */
export const SENSOR_RANGE_MIN_M = 0.02;

/** Rango máximo del sensor (acotado por h_max del sistema) [m] */
export const SENSOR_RANGE_MAX_M = H_MAX;

/** Probabilidad de que el eco rebote en el travesaño superior en vez del carro */
export const SENSOR_CROSSBAR_ECHO_PROB = 0.03;

/** Lectura típica cuando el eco viene del travesaño [m] */
export const SENSOR_CROSSBAR_M = 0.92;

/** Probabilidad de no recibir eco (timeout) */
export const SENSOR_ECHO_LOSS_PROB = 0.01;

/** Filtro del firmware: salto máximo creíble entre muestras [m] (2.4 m/s a 20 Hz) */
export const FILTER_MAX_JUMP_M = 0.12;

/** Filtro del firmware: lecturas coherentes para aceptar un salto real */
export const FILTER_CONFIRM_SAMPLES = 3;

/** Filtro del firmware: dispersión máxima de esas lecturas [m] */
export const FILTER_CONFIRM_SPREAD_M = 0.05;
