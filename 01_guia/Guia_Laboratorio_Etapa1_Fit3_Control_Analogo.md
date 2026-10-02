# Guia_Laboratorio_Etapa1_Fit3_Control_Analogo

> **Documento convertido de:** `Guia_Laboratorio_Etapa1_Fit3_Control_Analogo.pdf`
> **Páginas:** 4
> **Fecha de conversión:** 2026-09-21 12:45

---

## Página 1

UNIVERSIDAD DEL MAGDALENA
FACULTAD DE INGENIERÍA — PROGRAMA DE INGENIERÍA ELECTRÓNICA
Asignatura: Control Análogo
Docente: Ing. Jordan Dallan Guillot Fula, PhD (c)
Actividad: Guía de Laboratorio — Proyecto (Etapa 1)
Perfil: PhD (c) Ingeniería Eléctrica y Electrónica
Ponderación: 75 / 500 Puntos (15% del curso)
Modalidad: Grupos de trabajo (máximo 2 a 3 estudiantes)
Hito 1 (Exposición Metodológica):
 G. Martes: 15 de Sep | G. Viernes: 18 de Sep

Hito 2 (Entrega Final y Banco):
 G. Martes: 22 de Sep | G. Viernes: 25 de Sep

GUÍA PEDAGÓGICA Y TÉCNICA — ETAPA 1:
CARACTERIZACIÓN EXPERIMENTAL Y MODELADO DINÁMICO DEL MONÓPTERO (TOWER COPTER)
MEDIANTE EL MÉTODO FIT 3 (SMITH & CORRIPIO)
1. OBJETIVOS DE APRENDIZAJE
1.1 Objetivo General:
Caracterizar experimentalmente la dinámica vertical del prototipo Monóptero (Tower Copter de 1 GDL) y obtener un modelo
continuo de Primer Orden con Tiempo Muerto (FOPDT) en torno a un punto de operación de sustentación, aplicando con rigor
matemático la técnica de dos puntos Fit 3 de Smith y Corripio.
1.2 Objetivos Específicos:
 Comprender la necesidad de la linealización local en sistemas aerodinámicos y determinar experimentalmente el punto de
sustentación en vacío (hovering) (ü0, y0).
 Adquirir la curva de reacción temporal ante un escalón de ancho de pulso (∆u) a un periodo de muestreo fijo y determinístico de
Ts = 50 ms.
 Calcular analíticamente la ganancia estática (K), la constante de tiempo equivalente (τ) y el tiempo muerto aparente (t0)
evaluando los instantes de 28.3% y 63.2% de la respuesta.
 Validar la precisión del modelo FOPDT simulado frente a la respuesta experimental real mediante el Porcentaje de Ajuste (Fit %
≥ 80%) y el error cuadrático medio (RMSE).
2. FUNDAMENTACIÓN CONCEPTUAL Y FÍSICA DE LA PLANTA
¿Por qué linealizar alrededor del punto de 'Hovering'?
La fuerza de empuje generada por la hélice no es lineal respecto a la señal de control: Ft ∝ ω2 ∝ u2(t). Además, mientras el empuje
sea inferior al peso del carro móvil (Ft < m·g), el carro permanece en reposo sobre la base (zona muerta). Para poder aplicar la
teoría de Control Lineal Continuo (Control Análogo), es imperativo establecer un punto de equilibrio mecánico (hovering) donde
el empuje compense exactamente el peso: Ft(ü) = m·g a una altura ÿ ≈ 20 cm. Las variables analizadas serán perturbaciones
incrementales: ∆u(t) = u(t) - ü y ∆y(t) = y(t) - ÿ.
¿Por qué aproximar un sistema físico con masa a un modelo FOPDT?
Físicamente, la planta responde a un sistema de 2.º orden (m · d2y/dt2 + B · dy/dt + mg = Ft). Sin embargo, en el punto de
operación, la fuerte fricción viscosa en las columnas guía y la respuesta aerodinámica hacen que un polo domine ampliamente
sobre el otro. En consecuencia, el sistema puede modelarse con excelente fidelidad como un Primer Orden con Tiempo Muerto
(FOPDT):
Gp(s) = ∆Y(s) / ∆U(s) = [ K · e-t0 s ] / [ τ s + 1 ]
El término e-t0 s captura el retardo físico real: el tiempo de respuesta del ESC, la aceleración angular de la hélice y la latencia de
muestreo/filtro del sensor VL53L0X.
Docente: Ing. Jordan Dallan Guillot Fula, PhD (c) | Programa de Ingeniería Electrónica — Santa Marta

Página 1 de 4


---

## Página 2

3. DEDUCCIÓN PASO A PASO DEL MÉTODO FIT 3 (SMITH & CORRIPIO)
A diferencia del método clásico de la tangente (Fit 1), que es susceptible al ruido y la apreciación visual del estudiante al trazar la
pendiente en la inflexión, Fit 3 se basa estrictamente en la solución analítica temporal:
y(t) = y0 + K ∆u · [ 1 - e-(t - t0)/τ ] ⇒ Fracción normalizada: F(t) = [ y(t) - y0 ] / ∆y = 1 - e-(t - t0)/τ
Smith y Corripio demostraron que evaluando dos niveles estratégicos de la respuesta:
 Nivel 1 (28.3% del salto total ∆y): 1 - e-(t1 - t0)/τ = 0.283 ⇒ ln(0.717) ≈ -1/3 ⇒ t1 - t0 = τ / 3
 Nivel 2 (63.2% del salto total ∆y): 1 - e-(t2 - t0)/τ = 0.632 ⇒ ln(0.368) ≈ -1.0 ⇒ t2 - t0 = τ
Restando ambas ecuaciones algebraicas se elimina el retardo t0 y se obtienen las fórmulas definitivas de cálculo:
FÓRMULAS DE CÁLCULO DIRECTO FIT 3 (SMITH & CORRIPIO):
1. Ganancia Estática: K = ∆y / ∆u = ( y∞ - y0 ) / ( u∞ - u0 )   [cm / μs]
2. Constante de Tiempo: τ = 1.5 · ( t2 - t1 ) = 1.5 · ( t63.2% - t28.3% )   [s]
3. Tiempo Muerto Aparente: t0 = t2 - τ = t63.2% - τ   [s] (verificar que t0 ≥ 0)
¡ATENCIÓN ESTUDIANTE — EVITE ESTE ERROR COMÚN DE CÁLCULO!
Los instantes t1 y t2 corresponden al tiempo transcurrido desde el momento exacto en que se aplicó el escalón (tstep), NO al tiempo
absoluto de reloj de Arduino (millis). Si el escalón se aplicó en tstep = 2.4 s y el 28.3% se alcanza a los 3.1 s, entonces t1 = 3.1 - 2.4 = 0.7
s. Utilice siempre tiempo relativo referenciado a t = 0 en el escalón.
4. ESPECIFICACIONES DEL BANCO EXPERIMENTAL Y REGLAS DE SEGURIDAD
 Altura Mínima de la Torre (100 cm): Todas las estructuras de ensayo deben garantizar una cota vertical de mínimo 100 cm de
altura libre. Esto asegura suficiente carrera dinámica para transitorios y estabilización.
 Límites de Operación Segura:
- Zona de reposo y despegue: 0 a 10 cm.
- Punto de sustentación recomendado (y0): 20 cm (evita vórtices del efecto suelo).
- Escalón máximo admisible: ∆u ≤ +150 μs (amplitud final entre 40 cm y 60 cm).
- Failsafe por firmware: Si la altura supera 85 cm, el microcontrolador corta de inmediato el PWM a 1000 μs, dejando 15 cm de
margen de seguridad mecánico.
 Ciclo Térmico del ESC (30 A): No operar la planta en prueba continua por más de 10 minutos seguidos para evitar
sobrecalentamiento del ESC de potencia.
5. METODOLOGÍA EXPERIMENTAL Y LISTA DE CHEQUEO DEL ESTUDIANTE
Fase de Trabajo
Acción Requerida y Criterio de Calidad
Estado
1. Antes de Conectar
 Verificar que la hélice gire libremente sin rozar la torre de 100 cm.
 Inspeccionar cableado I2C (VL53L0X) y masa común (GND) entre Arduino y fuente 12V.
[ ] Listo
2. Armado del ESC
 Cargar firmware. Conectar fuente de 12V. Escuchar los pitidos de confirmación del ESC tras recibir
la secuencia: 1000 μs (2s) → 2000 μs (2s) → 1000 μs (2s).
[ ] Listo
3. Búsqueda de Hovering
 Incrementar PWM en pasos de 25 μs hasta que el carro flote de forma estable en y0 ≈ 20 cm.
 Registrar u0 y esperar 5 segundos en régimen permanente.
[ ] Listo
4. Captura de Escalón
 Aplicar escalón ∆u = +150 μs. Adquirir a Ts = 50 ms por puerto serial.
 Mantener la captura durante 10-12 segundos hasta régimen final y∞.
 Exportar a datos\_escalon.csv.
[ ] Listo
5. Análisis en MATLAB
 Filtrar señal (mediana N=5). Interpolar t1 (28.3%) y t2 (63.2%).
 Calcular K, τ, t0. Simular en Simulink y verificar Fit % ≥ 80%.
[ ] Listo
UNIVERSIDAD DEL MAGDALENA | Control Análogo — Guía de Laboratorio (Etapa 1)
Docente: Ing. Jordan Dallan Guillot Fula, PhD (c) | Programa de Ingeniería Electrónica — Santa Marta

Página 2 de 4


---

## Página 3

6. SCRIPT DE PROCESAMIENTO EN MATLAB (fit3_identificacion.m)
% =========================================================================
% UNIVERSIDAD DEL MAGDALENA - CONTROL ANÁLOGO - IDENTIFICACIÓN FIT 3
% Docente: Ing. Jordan Dallan Guillot Fula, PhD (c)
% =========================================================================
clear; clc; close all;
datos = readmatrix('datos\_escalon.csv');
t\_raw = datos(:, 1) / 1000;  u\_raw = datos(:, 2);  y\_raw = datos(:, 3);
y\_filt = medfilt1(y\_raw, 5); % Filtro de mediana para suprimir ruido VL53L0X
% 1. Rebase temporal relativo al instante del escalón (t\_step = 0)
idx\_step = find(diff(u\_raw) > 10, 1, 'first') + 1;
t0\_step = t\_raw(idx\_step);
t = t\_raw(idx\_step:end) - t0\_step;  u = u\_raw(idx\_step:end);  y = y\_filt(idx\_step:end);
% 2. Parámetros de equilibrio inicial y régimen estacionario final
u0 = mean(u\_raw(1:idx\_step-1));  u\_inf = mean(u(end-40:end));  delta\_u = u\_inf - u0;
y0 = mean(y(1:5));              y\_inf = mean(y(end-40:end));  delta\_y = y\_inf - y0;
K = delta\_y / delta\_u; % Ganancia estática del proceso [cm / us]
% 3. Aplicación del Método Fit 3 (Smith & Corripio)
y\_283 = y0 + 0.283 \* delta\_y;   y\_632 = y0 + 0.632 \* delta\_y;
t1 = interp1(y, t, y\_283, 'linear');
t2 = interp1(y, t, y\_632, 'linear');
tau = 1.5 \* (t2 - t1);          t0\_dead = max(0, t2 - tau);
% 4. Modelo FOPDT Continuo y Evaluación de Bondad de Ajuste
s = tf('s');
Gp = (K / (tau \* s + 1)) \* exp(-t0\_dead \* s);
[y\_mod, ~] = lsim(K / (tau\*s + 1), delta\_u \* (t >= t0\_dead), t);
y\_mod = y0 + y\_mod;
rmse = sqrt(mean((y - y\_mod).^2));
fit\_pct = (1 - (norm(y - y\_mod) / norm(y - mean(y)))) \* 100;
fprintf('--- RESULTADOS IDENTIFICACIÓN FIT 3 (SMITH & CORRIPIO) ---\\n');
fprintf('K: %.4f cm/us | tau: %.4f s | t0: %.4f s | Fit: %.2f%% | RMSE: %.4f cm\n', K, tau, t0_dead, fit_pct, rmse);

% 5. Graficación Comparativa
figure('Color', [1 1 1]);
plot(t, y, 'b-', 'LineWidth', 1.5, 'DisplayName', 'Respuesta Experimental Filtrada'); hold on;
plot(t, y\_mod, 'r--', 'LineWidth', 2, 'DisplayName', sprintf('Modelo FOPDT Fit 3 (Fit: %.1f%%)', fit\_pct));
yline(y\_283, 'k:', 'DisplayName', 'Nivel 28.3%'); yline(y\_632, 'm:', 'DisplayName', 'Nivel 63.2%');
xline(t1, 'k--', sprintf('t1 = %.2f s', t1)); xline(t2, 'm--', sprintf('t2 = %.2f s', t2));
grid on; xlabel('Tiempo Relativo [s]'); ylabel('Altura [cm]');
title('Identificación Dinámica del Monóptero — Método Fit 3'); legend('Location', 'Southeast');
7. CRONOGRAMA, HITOS EVALUATIVOS Y FECHAS DE ENTREGA
La Etapa 1 tiene una ponderación global de 75 / 500 puntos (15% del curso) y consta de dos entregas obligatorias:
Hito Evaluativo
Grupo Martes
Grupo Viernes
Ponderació
n
Alcance y Entregables
Hito 1: Exposición de
Abordaje Metodológico
15 de Sep de 2026
18 de Sep de 2026
25.0 pts
(33.3%)
Exposición técnica oral (10 min exposición + 5
min preguntas): diagrama de conexiones,
protocolo de armado del ESC, estrategia de
captura a Ts = 50 ms y formulación de Fit 3.
Hito 2: Entrega Final y Banco
22 de Sep de 2026
25 de Sep de 2026
50.0 pts
(66.7%)
Demostración experimental en banco ante el
docente + Informe técnico bajo formato IEEE +
Datos CSV y script de MATLAB documentado.
UNIVERSIDAD DEL MAGDALENA | Control Análogo — Guía de Laboratorio (Etapa 1)
Docente: Ing. Jordan Dallan Guillot Fula, PhD (c) | Programa de Ingeniería Electrónica — Santa Marta

Página 3 de 4


---

## Página 4

8. RÚBRICA DE EVALUACIÓN ANALÍTICA POR COMPETENCIAS (75 PUNTOS)
Dimensión / Criterio
Insuficiente
Aceptable
Sobresaliente
Puntos
Hito 1: Sustentación Oral
y Metodología
Planificación incoherente;
desconocimiento de las
ecuaciones Fit 3; omisión de
normas de seguridad.
(0.0 - 14.9 pts)
Presentación aceptable con
dudas menores en el
manejo del tiempo relativo o
en el filtrado digital.
(15.0 - 20.9 pts)
Dominio conceptual sobresaliente;
sustentación impecable del
protocolo experimental, seguridad y
método Fit 3.
(21.0 - 25.0 pts)
25.0 pts
Hito 2.1: Protocolo
Experimental y Datos
Pérdida de muestras;
atascamiento del carro;
escalón aplicado fuera de
régimen permanente.
(0.0 - 7.4 pts)
Datos completos a Ts = 50
ms; filtrado básico con ligero
ruido residual.
(7.5 - 10.4 pts)
Adquisición determinística limpia a
Ts = 50 ms; estados inicial y final
rigurosamente estables.
(10.5 - 12.5 pts)
12.5 pts
Hito 2.2: Cálculo Analítico
Fit 3
Cálculo erróneo de los
puntos fraccionales o de las
constantes K, τ, t0.
(0.0 - 7.4 pts)
Cálculo correcto con
discrepancias menores en
la interpolación lineal de t1 y
t2.
(7.5 - 10.4 pts)
Deducción matemática impecable;
cálculo exacto de K, τ, t0 en script
MATLAB documentado.
(10.5 - 12.5 pts)
12.5 pts
Hito 2.3: Validación y
Ajuste del Modelo
Sin simulación comparativa
o porcentaje de ajuste
deficiente (Fit < 65%).
(0.0 - 7.4 pts)
Gráficas superpuestas pero
sin cuantificación formal de
RMSE o Fit %.
(7.5 - 10.4 pts)
Superposición gráfica clara; ajuste
sobresaliente (Fit ≥ 80%) y análisis
riguroso de residuos.
(10.5 - 12.5 pts)
12.5 pts
Hito 2.4: Informe IEEE y
Análisis Crítico
Informe incompleto; omisión
de respuestas al
cuestionario técnico.
(0.0 - 7.4 pts)
Formato IEEE con
respuestas aceptables pero
discusión física superficial.
(7.5 - 10.4 pts)
Informe técnico impecable en IEEE;
análisis físico profundo y
justificación rigurosa del modelo.
(10.5 - 12.5 pts)
12.5 pts
UNIVERSIDAD DEL MAGDALENA | Control Análogo — Guía de Laboratorio (Etapa 1)
Docente: Ing. Jordan Dallan Guillot Fula, PhD (c) | Programa de Ingeniería Electrónica — Santa Marta

Página 4 de 4


---
