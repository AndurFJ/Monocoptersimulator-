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

/** Altura total del marco de madera [m] (dato confirmado por el usuario) */
export const FRAME_HEIGHT_M = 1.0;

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

/** Recorrido útil del carro sobre las varillas [m] — TODO: confirmar */
export const RAIL_TRAVEL_M = 0.75;

// ── Zonas de operación (dato del banco real, en fracción del recorrido) ──

/** 0–10 %: zona muerta. El carro descansa sobre los resortes y no se puede controlar */
export const DEAD_ZONE_FRACTION = 0.10;

/** 85–100 %: zona inestable. Cerca del travesaño superior el carro no se mantiene */
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
 * Altura donde los resortes empiezan a comprimirse [m]. Coincide con el techo
 * de la zona muerta: por debajo el carro está apoyado y no responde al control.
 */
export const SPRING_ENGAGE_HEIGHT_M = DEAD_ZONE_TOP_M;

/** Longitud natural (no comprimida) de los resortes [m] */
export const SPRING_NATURAL_LENGTH_M = 0.08;

// ── Límites de recorrido ─────────────────────────────────────────

/** Altura mínima absoluta del carro [m] (apoyado en resortes comprimidos) */
export const H_MIN = 0.0;

/** Altura máxima del carro [m] (tope superior del marco) */
export const H_MAX = RAIL_TRAVEL_M;

// ── Control PID ──────────────────────────────────────────────────

/** Periodo de muestreo/control [s] — 50 Hz = 20 ms (default razonable, confirmar) */
export const PID_DT = 0.02;

/** Ganancia proporcional por defecto — TODO: confirmar con firmware real */
export const DEFAULT_KP = 2.0;

/** Ganancia integral por defecto — TODO: confirmar */
export const DEFAULT_KI = 0.5;

/** Ganancia derivativa por defecto — TODO: confirmar */
export const DEFAULT_KD = 0.8;

/** Límite de anti-windup para el término integral */
export const I_MAX = 1.0;

// ── PWM ──────────────────────────────────────────────────────────

/** Valor mínimo de PWM — TODO: confirmar convención (µs 1000-2000 vs 0-255) */
export const PWM_MIN = 1000;

/** Valor máximo de PWM */
export const PWM_MAX = 2000;

// ── Sensor ultrasónico simulado ──────────────────────────────────

/** Desviación estándar del ruido gaussiano del sensor [m] */
export const SENSOR_NOISE_SIGMA_M = 0.003;

/** Rango mínimo del sensor HC-SR04 [m] */
export const SENSOR_RANGE_MIN_M = 0.02;

/** Rango máximo del sensor (acotado por h_max del sistema) [m] */
export const SENSOR_RANGE_MAX_M = H_MAX;
