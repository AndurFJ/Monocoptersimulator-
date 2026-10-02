# Presentación: Caracterización Experimental y Modelado Dinámico de un Monóptero

---

## Diapositiva 1: Presentación del Proyecto
* **Título:** Caracterización Experimental y Modelado Dinámico de un Monóptero (Tower Copter de 1 GDL)
* **Asignatura:** Control I
* **Institución:** Universidad del Magdalena
* **Objetivo General:** Modelar la dinámica vertical del monóptero alrededor de un punto de sustentación (hovering), linealizando el sistema y obteniendo una función de transferencia continua de Primer Orden con Tiempo Muerto (FOPDT).
* **Meta de Calidad:** Lograr un ajuste experimental Fit % $\geq$ 80%.

---

## Diapositiva 2: Estructura del Proyecto y Componentes
* **Arquitectura de la Planta:** Sistema mecánico vertical de 1 Grado de Libertad (1 GDL) guiado por columnas con carrera útil de 100 cm.
* **Componentes de Hardware:**
  * **Actuador:** Motor Brushless de alta eficiencia con hélice de sustentación.
  * **Etapa de Potencia:** ESC (Electronic Speed Controller) de 30 A alimentado a 12 V.
  * **Sensor de Salida:** Sensor ultrasónico HC-SR04 en la base, apuntando al carro, para medir la altura $y(t)$.
  * **Controlador y Adquisición:** Microcontrolador Arduino con muestreo determinístico y comunicación serial.
  * **Alimentación y Masa:** Fuente regulada de 12 V y bus de masa común (GND compartido).
* **Límites de Seguridad y Failsafe:**
  * Zona muerta mecánica: 0 a 12 cm (el carro apoyado en los resortes lee ≈ 11 cm).
  * Margen libre: 100 cm de altura total.
  * Failsafe por firmware: Corte inmediato de PWM a 1000 $\mu$s si la altura supera 85 cm.

---

## Diapositiva 3: Fundamentación Teórica: Sistemas de Primer Orden
* **¿Qué es un Sistema de Primer Orden?:** Sistema cuya dinámica está gobernada por una ecuación diferencial de 1.er grado y presenta un único polo real en el denominador de su función de transferencia.
* **Forma Estándar FOPDT:**
  $$G_p(s) = \frac{\Delta Y(s)}{\Delta U(s)} = \frac{K \cdot e^{-t_0 s}}{\tau s + 1}$$
* **Parámetros del Modelo:**
  * **Ganancia Estática ($K$):** Sensibilidad de la planta ante cambios en la señal de control ($\Delta y / \Delta u$).
  * **Constante de Tiempo ($\tau$):** Inercia del sistema; tiempo requerido para alcanzar el 63.2% de la respuesta total.
  * **Tiempo Muerto Aparente ($t_0$):** Demoras físicas acumuladas (latencia de sensor, procesamiento y aceleración del motor).
* **Propiedades Dinámicas:** Respuesta aperiódica, asintóticamente estable y puramente exponencial (sin oscilaciones ni sobreimpulsos).

---

## Diapositiva 4: Implementación del Modelo de Primer Orden al Monóptero
* **¿Por qué aproximar un sistema con masa (2.º Orden) a Primer Orden?:**
  * La ecuación física es $m \frac{d^2y}{dt^2} + B \frac{dy}{dt} + mg = F_t$.
  * La alta fricción viscosa de las varillas guía y la aerodinámica hacen que **un polo domine ampliamente sobre el otro**.
* **Necesidad de Linealización en Hovering:**
  * La fuerza de empuje es cuadrática no lineal: $F_t \propto \omega^2 \propto u^2(t)$.
  * Se establece un punto de equilibrio mecánico donde $F_t = m \cdot g$ en $y_0 \approx 20\text{ cm}$ para trabajar con variables incrementales ($\Delta u, \Delta y$) y evadir el efecto suelo (turbulencias a ras de base).
* **Formulación del Método Fit 3 (Smith & Corripio):**
  * Solución analítica temporal: $F(t) = 1 - e^{-(t - t_0)/\tau}$
  * Nivel 28.3% ($t_1$): $t_1 - t_0 = \tau / 3$
  * Nivel 63.2% ($t_2$): $t_2 - t_0 = \tau$
  * Ecuaciones directas: $\tau = 1.5(t_2 - t_1)$ | $t_0 = t_2 - \tau$ | $K = \frac{\Delta y}{\Delta u}$

---

## Diapositiva 5: Metodología Experimental y Toma de Datos
* **Protocolo de Ensayo:**
  1. Calibración del ESC con secuencia de seguridad: 1000 $\mu$s (2 s) $\rightarrow$ 2000 $\mu$s (2 s) $\rightarrow$ 1000 $\mu$s (2 s).
  2. Búsqueda de sustentación estable durante 5 segundos continuos ($\frac{dy}{dt} \approx 0$).
  3. Disparo de escalón determinístico $\Delta u = +50\ \mu\text{s}$ con muestreo constante $T_s = 50\text{ ms}$.
  4. Registro serial continuo por 10 segundos y guardado en archivo `datos_escalon.csv`.
* **Procesamiento de Señal en MATLAB:**
  * Filtrado digital: Filtro de mediana (`medfilt1`, orden 5) para eliminar ruido ultrasónico sin distorsionar la fase.
  * Rebase temporal: Sincronización estricta en tiempo relativo ($t = 0\text{ s}$ en el momento del escalón).

---

## Diapositiva 6: Simulación del Sistema (MATLAB y Simulink)
* **Implementación del Diagrama en Simulink:**
  * Bloque **Step:** Escalón aplicado en $t = 1\text{ s}$ con valor inicial 0 y valor final $\Delta u = 50\ \mu\text{s}$.
  * Bloque **Transfer Fcn:** Ganancia $K = 0.4302$, Denominador $[1.5719\ \ 1]$.
  * Bloque **Transport Delay:** Retardo aparente $t_0 = 0.1188\text{ s}$.
  * Bloque **Add / Sum:** Suma del incremento dinámico con la constante de sustentación ($y_0 = 13.45\text{ cm}$).
  * Bloque **Scope:** Visualización de la altura total en régimen transitorio y permanente.

> [!NOTE]
> **[IMAGEN 1: Diagrama de bloques completo implementado en Simulink]**
> 
> **[IMAGEN 2: Curva de respuesta temporal en el Scope (elevación de 13.45 cm a 34.96 cm)]**

---

## Diapositiva 7: Resultados Experimentales y Validación del Modelo

* **Tabla de Variables y Resultados:**

| Símbolo | Descripción | Valor | Unidad |
| :---: | :--- | :---: | :---: |
| $u_0$ | Señal de control en hovering inicial | 1762.00 | $\mu$s |
| $y_0$ | Altura inicial en hovering | 13.45 | cm |
| $u_\infty$ | Señal de control en régimen final | 1812.00 | $\mu$s |
| $y_\infty$ | Altura final en régimen permanente | 34.96 | cm |
| $\Delta u$ | Salto incremental (escalón) | +50.00 | $\mu$s |
| $\Delta y$ | Variación total de altura | +21.51 | cm |
| $K$ | Ganancia Estática | 0.4302 | cm/$\mu$s |
| $\tau$ | Constante de Tiempo | 1.5719 | s |
| $t_0$ | Retardo de Transporte | 0.1188 | s |
| $s$ | Polo Dominante en Lazo Abierto | -0.6362 | rad/s |
| RMSE | Raíz del error cuadrático medio | 0.7540 | cm |
| Fit % | Porcentaje de Ajuste | 85.77 | % |

* **Modelo Identificado (FOPDT):**
  $$G_p(s) = \frac{0.4302 \cdot e^{-0.1188 s}}{1.5719 s + 1}$$

> [!NOTE]
> **[IMAGEN 3: Curva experimental filtrada vs. Modelo FOPDT simulado con niveles 28.3% y 63.2%]**
> 
> **[IMAGEN 4: Imagen de MATLAB con la simulación de la posición del polo de nuestro sistema (Re(s) = -0.6362)]**

---

## Diapositiva 8: Conclusiones y Proyección a la Etapa 2
* **Validación Experimental:** El método Fit 3 de Smith & Corripio permitió caracterizar fielmente la dinámica vertical del monóptero, alcanzando un ajuste del 85.77% y validando la hipótesis del polo dominante.
* **Robustez Operativa:** El protocolo de adquisición a 50 ms y el filtro de mediana mitigaron exitosamente el ruido del sensor manteniendo la sincronía temporal del retardo real.
* **Base para Control en Lazo Cerrado (Etapa 2):** Con los parámetros cuantitativos consolidados ($K$, $\tau$, $t_0$), se cuenta con el modelo formal necesario para calcular analíticamente las constantes del controlador PID ($K_p$, $T_i$, $T_d$) e implementar el lazo cerrado en Arduino.
