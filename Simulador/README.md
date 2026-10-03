# Monocoptersimulator-

Simulador 3D interactivo y plataforma de prueba para Monocóptero de 1 Grado de Libertad (1-GDL).

## 🚀 Características
- **Modelado 3D Fiel**: Banco de pruebas procedural con Three.js (estructura de madera, guías de acero, resortes, motor brushless, hélice naranja, ESC, batería LiPo, PCB y sensores).
- **Física de 1-GDL**: Dinámica de empuje, gravedad, amortiguamiento, fricción y colisión con resortes.
- **Control**: Modos manual y PID con ajuste interactivo de ganancias ($K_p, K_i, K_d$) y feedforward $u_0$.
- **Instrumentación**: Gráficas en tiempo real con uPlot y HUD con telemetría en vivo.
- **Reproducción**: Carga de ensayos reales desde Excel/CSV (columnas y unidades detectadas automáticamente).
- **Serial en vivo**: Lectura directa del microcontrolador con Web Serial (Chrome/Edge).
- **Mando desde el teléfono**: setpoint, AUTO/MANUAL, PWM, secuencia P2 y parada, sincronizado con la página del PC.

## 🛠️ Tecnologías
- **Vite + TypeScript**
- **Three.js** (Renderizado 3D y OrbitControls)
- **uPlot** (Visualización de datos en tiempo real)
- **Anime.js** (Transiciones de UI)
- **SheetJS** (Lectura de Excel/CSV)
- **Vitest** (Tests del modelo físico y los parsers)

## 💻 Ejecución local
```bash
npm install
npm run dev     # servidor de desarrollo (solo este PC)
npm run remoto  # igual, pero accesible desde el teléfono (mando remoto)
npm test        # tests
npm run build   # build de producción en dist/
```

## 🎮 Uso
- **Espacio**: iniciar/pausar · **R**: reiniciar.
- **Simulación**: elige PID (mueve la altura objetivo) o PWM manual.
- **Reproducción**: carga un `.xlsx`/`.csv` con columnas de tiempo, altura y PWM
  (p.ej. `Tiempo (ms)`, `Distancia (cm)`, `PWM`). Si la unidad de altura se detecta mal, fórzala en el selector.
- **Serial**: indica los baudios y el orden de columnas de cada línea (p.ej. `t, altura, pwm`).
  También se aceptan líneas con etiquetas: `h:12.3,pwm:1500`.

### 📱 Mando remoto desde el teléfono

1. En el PC: `npm run remoto` (la primera vez Windows pregunta por el firewall de Node.js: **Permitir**).
2. En el simulador, abre la tarjeta **Control remoto** del panel lateral.
3. Con el teléfono en la **misma red WiFi** (o con el PC conectado al punto de acceso del teléfono),
   escanea el código QR con la cámara. Si escribes la dirección a mano, el teléfono pide el PIN de 4 cifras.

Cómo se mantienen sincronizados: la página del PC es la única dueña del estado. El teléfono solo manda
órdenes ("setpoint = 35 cm") y la página las aplica con los mismos controles del panel lateral, así que
pasan por los mismos límites y el mismo envío a la placa. El teléfono dibuja lo que la página publica
(10 veces por segundo) y, mientras arrastras, muestra tu valor hasta que el PC lo confirma.

- **Lo que se ve en el PC**: el control que mueve el teléfono se ilumina con la etiqueta «📱 nombre»,
  el HUD muestra qué está haciendo y la marca del setpoint brilla en azul en la vista 3D.
- **Lo que se ve en el teléfono**: torre con el carro en la altura medida, marca del setpoint (se arrastra),
  zona de alarma > 80 cm, tendencia de 30 s, latencia del enlace y «🖥 PC» cuando algo cambió desde el PC.
- **Seguridad**: si el teléfono se desconecta, el lazo sigue con el último setpoint. La **PARADA** funciona
  siempre, aunque el teléfono sea «solo ver». Solo un teléfono tiene el mando; los demás pueden tomarlo.
  Para mover el setpoint o el PWM hay que agarrar la marca o el círculo: un toque suelto no salta de valor.
- La página del teléfono es `control.html`; el puente WebSocket (`/remote`) es un plugin de Vite
  (`server/remoteBridge.ts`), así que funciona con `npm run dev`, `npm run remoto` y `npm run preview`,
  pero **no** cuando la interfaz la sirve la ESP32.

### 📈 Exportar a PID Tuner (MATLAB)
Mientras la simulación o la conexión serial está en marcha se graba todo lo recibido. El botón
**⬇ Excel para PID Tuner** descarga un `.xlsx` con tres hojas:

- `PID_Tuner`: datos remuestreados a paso constante Ts (PID Tuner lo exige). Columnas `t_s`, `u_pwm`, `y_cm`, `u_norm`, `y_m`.
- `Datos_crudos`: las muestras tal como llegaron.
- `Info`: Ts, duración, jitter de las tramas y el código para importarlo:

```matlab
T = readtable('ensayo_serial_....xlsx', 'Sheet', 'PID_Tuner');
Ts = T.t_s(2) - T.t_s(1);
datos = iddata(T.y_cm, T.u_pwm, Ts);
pidTuner   % Plant > Identify New Plant > Import > datos
```

Cada conexión nueva, **Reiniciar** o cambiar de pestaña de modo empieza una grabación nueva.

Las constantes del banco y de la planta identificada están en `src/physics/constants.ts`.

## 🔌 Firmware (Arduino Uno y ESP32)

El firmware vive fuera de este repositorio, en `../04_firmware/` (ver `../04_firmware/PROTOCOLO.md`):

- `arduino_uno/monocoptero_uno/` — banco por USB (modo **Serial**).
- `esp32/monocoptero_esp32/` — USB + WiFi; sirve este simulador desde LittleFS en
  `http://monocoptero.local` (modo **WiFi**). Para actualizar la interfaz en la placa:
  `../04_firmware/esp32/scripts/deploy_frontend.ps1` y luego `pio run -t uploadfs`.

Ambos usan el mismo protocolo, el mismo filtro del HC-SR04 y el mismo PID que la simulación
(`src/physics/SensorFilter.ts`, `src/physics/PIDController.ts`), y envían la telemetría
`tiempo_ms,pwm_us,altura_cm,crudo_cm,setpoint_cm` cada 50 ms, también con el motor apagado.

### Simulación = banco

La simulación usa la **planta identificada** (`src/physics/IdentifiedPlant.ts`):
Gp(s) = 0.4302 e^(−0.1188 s)/(1.5719 s + 1) alrededor de (1762 µs, 13.45 cm), con el carro
apoyado en la base (≈ 11 cm) por debajo del PWM de despegue y tope a 100 cm. El sensor simulado
incluye ruido y ecos falsos del travesaño, y el failsafe actúa igual que en el firmware (85 cm).
Las ganancias del PID están en unidades del banco (µs/cm), así que valen tal cual en el prototipo.
