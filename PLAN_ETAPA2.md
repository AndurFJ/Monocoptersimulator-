# Plan de trabajo: Etapa 2 (segundo orden, PID y SCADA) + control remoto desde el teléfono

Basado en `01_guia/Guia_Laboratorio_Etapa2_SegundoOrden_PID_SCADA_1.pdf`. Hecho el 03/10/2026.

| Hito | Grupo Martes | Grupo Viernes | Puntos |
|---|---|---|---|
| Hito 1: exposición metodológica (10 min + 5 de preguntas) | 13 oct | 16 oct | 25 |
| Hito 2: banco, SCADA e informe | 20 oct | 23 oct | 50 |

**Idea central:** el simulador que ya tenemos se convierte en el **SCADA** (la guía permite
«una HMI web con Web Serial»). Ya trae la recreación 3D del banco, las gráficas, Web Serial y la
exportación de datos, así que cumple de entrada buena parte de R1–R9. El **control remoto del
teléfono** es un mando extra de ese mismo SCADA.

---

## Bloque 0: Control remoto desde el teléfono ✅ hecho (03/10)

Estado: funcionando en Simulación y probado en Chrome (página del PC + mando de 390 px). Pendiente
solo probarlo con un teléfono real y con la placa conectada (Serial/WiFi). Uso: `npm run remoto` y
escanear el QR de la tarjeta *Control remoto*. Detalle en `Simulador/README.md`.

### Cómo funciona

```
 Teléfono (control.html)  ──WebSocket──▶  servidor Vite en el PC (puente /remote)  ◀──WebSocket──  Página del PC (SCADA)
   solo manda INTENCIONES                    solo reenvía mensajes                     ÚNICA dueña del estado
   y dibuja el estado que recibe                                                       (simulación, PID, placa)
```

- **Una sola fuente de verdad: la página del PC.** El teléfono nunca decide nada por su cuenta:
  manda «quiero setpoint = 35 cm» y la página lo aplica con **los mismos setters del panel**
  (`appState.setSetpoint`, `setControlMode`, …). Así, lo que mueva el teléfono pasa por el mismo
  camino que el panel lateral: mismos límites, misma limitación de comandos a la placa y misma
  lógica anti-eco que ya existe en `main.ts`. Sin un segundo estado no puede haber desincronización.
- **Instantánea con número de versión.** La página manda al teléfono el estado completo
  (`rev`, modo, sp, y, u, Kc/Ti/Td, alarmas, enlace) cada vez que cambia y como mínimo a 10 Hz.
  El teléfono descarta instantáneas viejas (`rev` menor) y **no le pisa el valor al dedo**: mientras
  arrastras un control, ignora el eco de ese campo (lo mismo que `recentlyEdited()` hace hoy con la ESP32).
- **Confirmación.** Cada orden del teléfono lleva un número; la página responde «aplicado» o
  «rechazado: fuera de 10–70 cm». El teléfono muestra ✓ o el motivo.
- **Pérdida de enlace.** Si el teléfono se desconecta, el lazo **sigue con el último setpoint**
  (la misma regla de la guía, sección 4.1). Si se cae la página del PC, el teléfono bloquea sus
  controles y muestra «PC desconectado». Latido cada 500 ms en ambos sentidos.
- **Un solo mando a la vez.** Si se conectan dos teléfonos, el segundo entra como «solo ver»
  hasta que pulse «Tomar el mando». La parada (X) funciona siempre, desde cualquiera.
- **Emparejar.** El panel del PC muestra un **código QR** con la dirección
  (p. ej. `http://172.20.10.3:5173/control.html`) y un PIN de 4 dígitos para que nadie más en la
  red pueda mover el banco.
- **Funciona en todos los modos:** en Simulación mueve la simulación; en Serial/WiFi la página
  reenvía la orden a la placa como ya lo hace con el panel.

### Cómo se verá

**En el teléfono** (misma paleta oscura `#0f1117`, azul `#4f8cff`, naranja de la hélice
`#ff6b35`, números en JetBrains Mono, tarjetas con los mismos radios):

```
┌──────────────────────────────┐
│ ● Enlace OK   SIM    AUTO    │  ← estado del enlace y modo
├────────┬─────────────────────┤
│  100 ┐ │  y   34.2 cm        │
│ ░░░░ │ │  sp  35.0 cm        │
│  80 ─┤ │  u   1612 µs        │
│      │ │                     │
│  ▶━━ │ │   [ deslizador ]    │  ← torre mini: carro en la altura
│  ▓▓  │ │   [ vertical del ]  │    medida, marca del setpoint y
│      │ │   [  setpoint    ]  │    zona de alarma > 80 cm
│   0 ─┘ │  −5  −1   +1  +5    │
├────────┴─────────────────────┤
│  [ MANUAL | AUTO ]           │
│  PWM:  −25  −5   +5  +25     │  ← solo en MANUAL
│  Secuencia P2: 20→40→30→50 ▶ │
│ ┌──────────────────────────┐ │
│ │       ■  PARADA (X)      │ │  ← siempre visible, rojo
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

Vibración corta al confirmar en Android (en iPhone el navegador no deja vibrar). Pantalla
completa y sin zoom accidental al tocar dos veces.

**En la página del PC** se ve qué está tocando el teléfono:
- El control que se está moviendo en el panel lateral **se ilumina** con un borde azul que
  pulsa, una etiqueta «📱 Teléfono» y el valor animándose en vivo.
- En el HUD aparece un chip «📱 Control remoto · ajustando setpoint → 35 cm» que se apaga
  1.5 s después del último toque.
- En la vista 3D, la marca del setpoint brilla mientras el teléfono la mueve.
- Cada orden remota queda en el registro de eventos («14:32:05 📱 sp 30 → 35 cm»), útil para R7.

### Archivos que se crean o cambian

| Archivo | Qué hace |
|---|---|
| `Simulador/server/remoteBridge.ts` + `server/bridgeHub.ts` | Plugin de Vite: puente WebSocket en `/remote` (dev, remoto y preview); PIN, quién tiene el mando, última instantánea |
| `Simulador/control.html` + `src/remote/phone.ts` + `src/styles/phone.css` | Página del teléfono |
| `src/remote/RemoteHost.ts` | Lado PC: recibe intenciones, llama a los setters de `appState` y publica la instantánea |
| `src/remote/protocol.ts` | Tipos y validación de los mensajes, compartidos por teléfono, puente y PC |
| `src/core/SetpointProfile.ts` | Secuencia P2 (20 → 40 → 30 → 50 cm, 12 s), botón en la página y en el teléfono |
| `src/ui/RemotePanel.ts`, `ParamsPanel.ts`, `Hud.ts`, `SceneManager.ts`, `main.css`, `tokens.css` | Tarjeta con QR y PIN, resaltado «📱», chip del HUD, marca 3D azul, paleta compartida |
| `vite.config.ts`, `package.json` | Segunda página de entrada y script `npm run remoto` (`vite --host`) |
| `tests/remote.test.ts` | 15 tests: validación, PIN y bloqueo, mando único, herencia, parada siempre, secuencia P2 |

**Para usarlo:** `npm run remoto` en el PC → escanear el QR con el teléfono (mismo WiFi o
punto de acceso). Windows pedirá permitir Node en el firewall la primera vez.

**Criterio de terminado:** 10 min moviendo el setpoint desde el teléfono y el panel a la vez
sin que ninguno salte a un valor viejo; desconectar el WiFi del teléfono no cambia el setpoint;
PARADA desde el teléfono responde en menos de 200 ms.

---

## Bloque 1: Identificación del modelo de segundo orden (secciones 2–3)

**Estado (03/10):** 1.1 y 1.2 ✅ hechos en la página de diseño (`Simulador/diseno.html`, enlace «📐 Diseño del PID» en
el simulador). Verificado: reproduce la Tabla 1 (error < 0.001) y el ejemplo resuelto cifra por cifra.
Con el ensayo del 01/10 17:47 el banco sale **subamortiguado** (ζ ≈ 0.67 por Mp, 0.83 con ajuste fino; ωn ≈ 2.9 rad/s;
θ ≈ 0.20 s; Fit 92 %). Falta confirmarlo con los 3 ensayos nuevos (Δu +60 a +80 µs, carro quieto 3 s antes).

| # | Tarea | Dónde |
|---|---|---|
| 1.1 | **Analizador de tres puntos** en el simulador: a partir de un ensayo calcula t10, t50, t90, R, ζ (interpolando la Tabla 1), ωn, θ, K, polos, τ1/τ2, la clasificación (sub/crítico/sobre o «polo dominante» si R ≥ 2.70) y ke, B, kF con la masa del carro | `src/core/ThreePoint.ts` + tarjeta nueva |
| 1.2 | Tests con el **ejemplo resuelto de la guía** (R = 2.303 → ζ ≈ 1.21, ωn = 2.03, θ = 0.26 s) | `tests/threePoint.test.ts` |
| 1.3 | Ensayo de la guía: comando `R` (3 s en u0, 12 s en u0 + Δu, 12 s en u0), automatizado y exportado como `G#_datos_escalon2_1..3.csv` | simulador + firmware |
| 1.4 | MATLAB: escribir `so_identificacion.m` (tres puntos + verificación por Mp + ajuste por mínimos cuadrados + clasificación + `modelo_so.mat`) y lograr Fit ≥ 80 % en identificación y validación | `03_matlab/` |
| 1.5 | En el banco: **pesar el carro**, hovering a 15–25 cm, tres ensayos, cálculo a mano del ensayo 1 con la Tabla 1 | tú |
| 1.6 | La planta del simulador pasa a **SOPDT** (K, ζ, ωn, θ) con el modelo nuevo | `IdentifiedPlant.ts`, `constants.ts` |

✅ **Decidido (03/10): Δu = +60 a +80 µs en vez de +150 µs.** Nuestro banco flota con
~1840–1870 µs y K ≈ 0.34 cm/µs: un escalón de +150 µs subiría el carro ≈ 50 cm, hasta la zona de
60–84 cm donde el HC-SR04 falla, y pasaría de los 2000 µs del ESC. Con +60 a +80 µs, y∞ ≈ 40–45 cm.
Se explica en el Hito 1.

## Bloque 2: Tres controladores PID y gemelo digital (sección 4)

**Estado (03/10):** 2.2, 2.3 y 2.4 ✅ hechos (página de diseño). El gemelo reproduce la tabla de la guía
(ZN 22.2 %, Lambda 5.0 %, mismos rangos de u), contando el retardo en muestras enteras como el gemelo del docente.
2.1: el PID ISA de la sección 4.4 ya existe (`src/control/isaPid.ts`) y es el que usa el gemelo; el simulador
principal lo adoptará junto con el firmware (bloque 4), para no separar simulación y banco.
**Cambio de recomendación: regla del grupo = AMIGO** (Åström–Hägglund, ref. [7]). SIMC con τc = θ da lo mismo
que Lambda con λ = θ si los polos son reales, y un PI sin derivada si son complejos.

| # | Tarea | Dónde |
|---|---|---|
| 2.1 | PID en **forma ISA** (Kc, Ti, Td) idéntico a la sección 4.4: Euler hacia atrás, derivada sobre la medición, filtro N = 10, anti-windup condicional, u0 capturado al pasar a AUTO | `PIDController.ts` + tests |
| 2.2 | Calculadora de las tres reglas: **Ziegler–Nichols** (con el FOPDT de Fit 3), **Lambda** (λ = θ … 3θ) y **regla del grupo** (AMIGO recomendada; también SIMC y Cohen–Coon) | `src/control/tuning.ts` + página de diseño |
| 2.3 | **Gemelo digital**: simula muestra a muestra el algoritmo del firmware sobre la SOPDT con el perfil 20 → 40 → 30 → 50 cm (12 s por tramo), las tres reglas superpuestas | modo nuevo «Gemelo digital» |
| 2.4 | Tabla automática por regla: Mp, ts (2 %), IAE, \|e\| de los últimos 2 s y rango de u, con ✓/✗ frente a las especificaciones (Mp ≤ 10 %, ts ≤ 5 s, \|e\| ≤ 1 cm, sin saturar) | `StepMetrics.ts` ampliado |
| 2.5 | Escribir `pid_sintonia.m` (tres reglas + `stepinfo` + gemelo del firmware) y comprobar que coincide con el simulador y con el cálculo a mano | `03_matlab/` |

✅ **Decidido (03/10): saturación propia en vez de 1100–1800 µs.** Nuestro banco necesita
~1870 µs solo para flotar, así que con ese límite nunca despegaría. Rango de trabajo propuesto
1550–1980 µs (se ajusta con el u0 medido) y se justifica en el informe.

## Bloque 3: El simulador como SCADA (sección 5)

| Req. | Qué pide | Qué hay hoy | Qué falta |
|---|---|---|---|
| R1 | Puerto, indicador de enlace, pérdida de telemetría > 0.5 s | Web Serial y selector de puerto | Alarma a 0.5 s (hoy solo se mira a 1 s en el ensayo) |
| R2 | Torre 0–100 cm con el carro, marca del setpoint y zona de alarma | Banco en 3D con el carro | Sinóptico 2D con la zona > 80 cm (también en el teléfono) |
| R3 | y y sp en un eje, u en otro; ≥ 30 s a 20 Hz sin perder muestras | 3 gráficas, ventana de 30 s | Ajustar a «y + sp» y «u»; contador de muestras perdidas |
| R4 | Setpoint 10–70 cm validado, envía `S<cm>` | Deslizador de 12–80 cm | Rango 10–70 y protocolo nuevo |
| R5 | Editar Kc, Ti, Td y confirmar con `# CFG` | Kp/Ki/Kd sin confirmación | ISA + «✓ confirmado por la placa» |
| R6 | MANUAL/AUTO, PWM manual, PARADA (X) siempre visible, rearme (Z) | Manual/PID, PWM, parada | Botón de PARADA fijo en pantalla y rearme Z |
| R7 | Alarmas > 80 cm, PARADO, enlace perdido; registro con hora | Toasts sueltos | Panel de alarmas + registro de eventos con hora |
| R8 | CSV con hora del PC y los 5 campos | Excel para PID Tuner | Exportar `G#_registro_scada.csv` |
| R9* | Mp, ts y error del último cambio de setpoint | Tarjeta «Respuesta al escalón» | Añadir IAE y error final |

Además:
- **Protocolo nuevo** (`src/data/ScadaProtocol.ts` + tests): telemetría `t_ms,modo,sp_cm,y_cm,u_us`,
  mensajes `#`, comandos `S P I D A M + − > < U R X Z ?`. Se conserva el protocolo viejo para la ESP32.
- **Esperar «# Listo»** al conectar (el Arduino se reinicia ≈ 9 s al abrir el puerto) y avisar
  si se intenta reconectar con el motor encendido.
- **Prueba en vacío** guiada (lista de chequeo en pantalla): sin hélice o motor en 1000 µs.

## Bloque 4: Firmware (decidido: nuestra ESP32)

No tenemos los archivos del docente, así que los escribimos siguiendo la guía:
- **`04_firmware/esp32/monocoptero_esp32/`**: se le añade el protocolo de la guía (comandos de
  una letra `S P I D A M + − > < U R X Z ?`, telemetría `t_ms,modo,sp_cm,y_cm,u_us`, mensajes `#`,
  modos 0 MANUAL / 1 ENSAYO / 2 AUTO / 3 PARADO) y el PID ISA de la sección 4.4. Se mantienen el
  WiFi, el filtro del sensor, el failsafe de 85 cm y el temporizador de 16 bits del ESC.
- **`03_matlab/captura_ensayo.m`, `so_identificacion.m`, `pid_sintonia.m`**: escritos por nosotros
  con lo que pide la sección 7 (el gemelo de `pid_sintonia.m` y el del simulador deben dar lo mismo).

## Bloque 5: Lazo cerrado en el banco (sección 6)

| Prueba | Ayuda del SCADA |
|---|---|
| P1 Transferencia MANUAL → AUTO en sp = 20 cm | Indicador «sin salto»: Δy y Δu en el instante del cambio |
| P2 Seguimiento 20 → 40 → 30 → 50, 12 s por tramo, orden Lambda → grupo → ZN | Botón «Secuencia P2» (también en el teléfono) + tabla automática por regla |
| P3 Robustez +5–10 g sin reajustar | Guardar el resultado de P2 y comparar ΔMp y Δts |
| P4 PARADA en AUTO a 30 cm y rearme | Alarma registrada con hora; rearme sin recargar la página |
| P5 Gemelo frente a real | Cargar el CSV de P2 y superponer la simulación del mismo perfil |

## Bloque 6: Entregables

- **Hito 1:** diapositivas en `06_presentacion/presentacion_etapa2/` (mismo estilo que la del
  Hito 2 anterior): modelo SO, tres puntos, caso de amortiguamiento, tres reglas calculadas a mano,
  gemelo digital, plataforma SCADA con capturas reales (incluido el teléfono) y plan P1–P5.
- **Hito 2:** `G#_informe_etapa2.pdf` (IEEE, máx. 6 páginas, a partir de `05_informe_ieee/informe_pid_ieee.tex`)
  con el cuestionario de 7 preguntas, `G#_datos_escalon2_1..3.csv`, `G#_registro_scada.csv`,
  scripts comentados y el código del SCADA (el repositorio).

---

## Cronograma (grupo Viernes)

| Fechas | Trabajo |
|---|---|
| 3–5 oct | **Bloque 0** (control remoto) + protocolo nuevo |
| 6–8 oct | Bloques 1.1–1.2 y 2 (tres puntos, PID ISA, tres reglas, gemelo digital) + SCADA R1–R8 + firmware ESP32 |
| 9–11 oct | Banco: pesar el carro, hovering, 3 ensayos, identificación SOPDT; scripts MATLAB |
| 12–15 oct | Cálculos a mano, tabla del gemelo con el modelo real, presentación del Hito 1 |
| **16 oct (vie)** | **Hito 1** |
| 17–20 oct | Prueba en vacío, lazo cerrado P1–P5 con las tres reglas |
| 21–22 oct | Informe IEEE, cuestionario, figuras gemelo vs. real |
| **23 oct (vie)** | **Hito 2** |

## Riesgos

| Riesgo | Plan |
|---|---|
| El HC-SR04 falla entre 60 y 84 cm y P2 llega a 50 cm | Revisar el haz antes del 17 oct; si sigue, limitar el setpoint a 55 cm y explicarlo |
| La guía asume u0 ≈ 1400 µs y saturación en 1800 µs | Límites propios justificados (bloques 1 y 2) |
| No tenemos los archivos del docente (`.ino`, `.m`) | Los escribimos nosotros (bloque 4); si el docente los comparte después, comparamos |
| Firewall de Windows o WiFi de la universidad bloquean el teléfono | Usar el punto de acceso del propio teléfono (como ahora, 172.20.10.x) |
