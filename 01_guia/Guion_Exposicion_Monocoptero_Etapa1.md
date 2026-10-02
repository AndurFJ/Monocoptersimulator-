# Guion_Exposicion_Monocoptero_Etapa1

> **Documento convertido de:** `Guion_Exposicion_Monocoptero_Etapa1.pdf`
> **Páginas:** 4
> **Fecha de conversión:** 2026-09-21 12:45

---

## Página 1

GUION DE EXPOSICIÓN
Identificación de Planta — Monocóptero — Etapa 1 (Fit 3, Smith & Corripio)
Andru Fonseca & Nayarith Ramírez — Control Análogo
DIAPOSITIVA 1 — Portada / Presentación del proyecto
Buenos días/tardes. Somos Andru Fonseca y Nayarith Ramírez, y hoy les presentamos la Etapa 1 de nuestro
proyecto de Control Análogo: la identificación de planta de un Monocóptero, usando el método Fit 3 de Smith y
Corripio para obtener un modelo de primer orden.
En esta etapa nuestro objetivo no es controlar aún el sistema, sino conocerlo: entender cómo se comporta para, en la
Etapa 2, poder diseñarle un controlador.
DIAPOSITIVA 2 — ¿Qué es un sistema de primer orden?
Un sistema de primer orden es un modelo matemático que describe cómo una variable pasa de un estado estable a
otro cuando se le aplica un cambio en la entrada. Su respuesta es una curva suave, sin oscilaciones, que sube y se
estabiliza.
Se representa con la función de transferencia FOPDT: G(s) = K·e^(−t₀s) / (τs+1).
Tres parámetros la definen: K, la ganancia estática, que indica cuánto cambia la salida por cada unidad de cambio en
la entrada; τ, la constante de tiempo, que indica qué tan rápido responde el sistema (63.2% del cambio total); y t₀, el
tiempo muerto, el retardo antes de que el sistema empiece a reaccionar.
DIAPOSITIVA 3 — Método Fit 3 – Smith & Corripio
Fit 3 es un método gráfico-numérico para hallar K, τ y t₀ de un sistema de primer orden a partir de datos
experimentales, sin necesidad de conocer las ecuaciones físicas internas de la planta. Solo se mide cómo responde el
sistema ante un escalón conocido en la entrada.
El procedimiento tiene cuatro pasos: primero se calcula ΔY y ΔU, es decir el cambio en la salida y en la entrada;
segundo, se calcula K como ΔY/ΔU; tercero, se ubican en la curva los instantes t₁ y t₂, cuando la salida alcanza el
28.3% y el 63.2% del cambio total; y cuarto, con esos tiempos se calculan τ = 1.5(t₂−t₁) y t₀ = t₂−τ.
DIAPOSITIVA 4 — Puntos clave del Fit 3: 28.3% y 63.2%
Estos dos porcentajes no son arbitrarios: son los puntos de la curva que, al despejar la ecuación exponencial de la
respuesta, permiten eliminar matemáticamente el tiempo muerto y obtener fórmulas directas para τ y t₀.
En la práctica, buscamos en la curva el tiempo t₁ donde la salida llega a y₀ + 0.283·ΔY, y el tiempo t₂ donde llega a
y₀ + 0.632·ΔY. Con esos dos tiempos resolvemos todo el modelo.
DIAPOSITIVA 5 — ¿Qué es nuestro monocóptero?
Nuestro monocóptero es un sistema físico con un solo motor brushless y una hélice, montado sobre una estructura de
madera con varillas de acero que le permiten moverse libremente en vertical.
El objetivo final es controlar su altura de forma automática, pero en esta Etapa 1 solo identificamos su
comportamiento dinámico: cómo reacciona ante un cambio de señal, para obtener su función de transferencia G(s).


---

## Página 2

DIAPOSITIVA 6 — Diagrama de conexiones eléctricas
Aquí se muestra cómo están conectados los componentes: el Arduino Uno controla el ESC mediante señal PWM, el
ESC alimenta el motor brushless, el sensor ultrasónico se conecta al Arduino para medir la altura, y una fuente DC
de 12V alimenta el ESC y el motor, compartiendo tierra con el Arduino.
DIAPOSITIVA 7 — Componentes del sistema
Recorramos brevemente cada componente. El Arduino Uno es el cerebro: genera el PWM hacia el ESC, lee el
sensor ultrasónico y envía los datos por USB a 115200 baudios, muestreando cada 50 ms.
El sensor ultrasónico HC-SR04 mide la altura, que es nuestra variable de salida y(t); trabaja a 40 kHz y su rango útil
es de 10 a 85 cm.
El motor brushless es el actuador: genera el empuje mediante la hélice, y su velocidad es proporcional al PWM que
recibe.
El ESC de 30A convierte la señal PWM en corriente trifásica para el motor, y se alimenta con los 12V de la fuente.
La estructura mecánica, de madera con varillas de acero, guía el desplazamiento vertical libre: el sensor va abajo y el
motor arriba.
Y la fuente DC de 12V y 5A alimenta el ESC y el motor, con tierra común con el Arduino.
DIAPOSITIVA 8 — Variables del sistema monocóptero
Nuestra entrada u(t) es la señal PWM en microsegundos: partimos de u₀ = 1762 µs, el punto de hovering o
estabilidad, y aplicamos un escalón hasta u∞ = 1812 µs, es decir ΔU = +50 µs.
Nuestra salida y(t) es la altura en centímetros, medida por el sensor: y₀ = 13.45 cm inicial, y∞ = 34.96 cm final, ΔY
= +21.51 cm.
Con estos datos y el método Fit 3 calculamos: K = 0.4302 cm/µs, τ = 1.5719 s, t₀ = 0.1188 s, y el polo del sistema sp
= −0.6362 rad/s.
DIAPOSITIVA 9 — El escalón: señal PWM aplicada
El escalón es un cambio brusco y sostenido en la entrada: subimos el PWM de 1762 a 1812 µs de forma instantánea.
El experimento tiene tres fases: hovering estable los primeros 5 segundos, el escalón entre los segundos 5 y 15, y
luego se apaga el motor.
Por seguridad, si la altura supera 85 cm el sistema se apaga automáticamente (failsafe).
Usamos un escalón pequeño, de solo 50 µs, para mantenernos dentro de la zona lineal de operación: lo
suficientemente grande para ver una respuesta clara, pero lo suficientemente pequeño para que el modelo lineal siga
siendo válido.
DIAPOSITIVA 10 — Flujo de adquisición de datos
El flujo de datos va así: el Arduino ejecuta el código, mide y envía los datos en formato CSV por el puerto serial
COM3 a 115200 baudios; Excel captura esos datos en tiempo real desde el puerto serial; y finalmente esos datos se
llevan a MATLAB, donde se procesan y se aplica el método Fit 3 para calcular los parámetros.
Los datos se transmiten como tres columnas: tiempo en milisegundos, PWM en microsegundos y altura en
centímetros. Se guardan como archivo .xlsx y luego MATLAB los lee con la función readmatrix().


---

## Página 3

DIAPOSITIVA 11 — Código Arduino – estructura general
El código del Arduino tiene cuatro partes. Primero la configuración inicial: el ESC en el pin D9, el sensor con TRIG
en D7 y ECHO en D6, el punto de hovering en 1762 µs, el escalón de +50 µs y un muestreo de 50 ms.
Segundo, la calibración del ESC: se hace una secuencia de 1000 a 2000 y de vuelta a 1000 µs, con 2 segundos de
espera entre pasos, para que el ESC reconozca sus límites; esto se hace solo al encender.
Tercero, la lectura del sensor: se envía un pulso TRIG de 10 µs, se mide la duración del ECHO y se calcula la
distancia con la fórmula (duración × 0.0343)/2.
Y cuarto, la ejecución de la prueba: inicia al enviar '1' por serial, corre la fase de hovering, luego el escalón, imprime
tiempo-PWM-altura en CSV, y tiene el failsafe a 85 cm.
DIAPOSITIVA 12 — Procesamiento en MATLAB – algoritmo Fit 3
En MATLAB seguimos cinco pasos: primero importamos los datos del CSV; segundo, filtramos el ruido del sensor
con un filtro de mediana; tercero, detectamos automáticamente el instante del escalón buscando el cambio brusco en
el PWM; cuarto, calculamos los parámetros K, τ y t₀ con las fórmulas del Fit 3 que ya explicamos; y quinto,
validamos el modelo comparando la respuesta simulada contra la experimental, calculando el RMSE y el porcentaje
de ajuste.
DIAPOSITIVA 13 — Comportamiento experimental
En la gráfica se observa que durante los primeros 5 segundos el sistema permanece estable alrededor de 13.45 cm.
Al aplicar el escalón, la altura sube gradualmente hasta estabilizarse cerca de 35 cm.
Este es el comportamiento típico de un sistema de primer orden: hay algo de ruido propio del sensor, pero no se
observan oscilaciones, lo cual confirma que el modelo FOPDT es adecuado.
DIAPOSITIVA 14 — Resultados y validación
Para validar el modelo usamos dos métricas: el RMSE, que dio 0.7540 cm, un error cuadrático medio bajo; y el
porcentaje de ajuste (Fit %), que dio 85.77%, superando el mínimo requerido del 80%. Esto confirma que nuestro
modelo representa fielmente el comportamiento real del sistema.
DIAPOSITIVA 15 — Función de transferencia del sistema
La función de transferencia final obtenida es G(s) = 0.4302 · e^(−0.1188s) / (1.5719s + 1).
Esto significa que por cada microsegundo que aumenta el PWM, la altura sube 0.4302 cm en régimen permanente;
que el sistema alcanza el 63.2% de su respuesta final en aproximadamente 1.57 segundos; y que tarda cerca de 0.12
segundos en empezar a reaccionar al cambio de PWM.
DIAPOSITIVA 16 — Comparación: experimental vs. modelo Fit 3
En esta gráfica comparamos ambas curvas: la línea azul sólida son los datos experimentales filtrados, la línea roja
punteada es el modelo FOPDT calculado con Fit 3, los puntos verdes marcan el 28.3% y 63.2% usados para hallar t₁
y t₂, y la línea gris punteada indica el valor final en régimen permanente, 34.96 cm. Como se ve, el modelo se ajusta
muy bien a los datos reales.


---

## Página 4

DIAPOSITIVA 17 — Mapa de polos – plano complejo
El plano complejo nos permite ubicar el polo del sistema, que determina su estabilidad y velocidad de respuesta.
Nuestro polo es sp = −1/τ = −0.6362 rad/s.
Al estar en el semiplano izquierdo, con parte real negativa, confirmamos que el sistema es estable; al no tener parte
imaginaria, confirmamos que no hay oscilaciones; y entre más lejos esté del eje imaginario, más rápido responde el
sistema.
DIAPOSITIVA 18 — Simulación en Simulink
Armamos el modelo en Simulink con cinco bloques: un Step que aplica el escalón de 50 µs en t=0; un bloque
Transfer Fcn con G(s) = 0.4302/(1.5719s+1); un Transport Delay de 0.1188 s para el tiempo muerto; una suma con
constante para agregar el valor inicial y₀ = 13.45 cm; y un Scope para visualizar la respuesta.
Al comparar la simulación con lo experimental, ambas curvas tienen la misma forma de primer orden sin
oscilaciones, parten del mismo valor inicial cercano a 13.45 cm, llegan a un valor final muy similar (34.96 cm
experimental contra 35 cm simulado), y tienen prácticamente la misma velocidad de respuesta, con τ ≈ 1.57 s. Esto
confirma que la simulación reproduce fielmente el comportamiento real de la planta.
DIAPOSITIVA 19 — Conclusiones
En conclusión, logramos identificar la dinámica del monocóptero como un sistema de primer orden con tiempo
muerto (FOPDT), usando el método Fit 3 de Smith y Corripio, con un ajuste del 85.77%, por encima del 80%
requerido.
Obtuvimos el modelo matemático G(s) = 0.4302·e^(−0.1188s) / (1.5719s + 1), que describe con precisión cómo
responde el sistema a los cambios de PWM.
Confirmamos que el sistema es estable, con su polo en s = −0.6362 rad/s en el semiplano izquierdo, y sin
oscilaciones en su zona lineal de operación.
Y validamos todo esto con la simulación en Simulink, que reprodujo fielmente el comportamiento experimental.
Con este modelo G(s) ya identificado, en la Etapa 2 podremos diseñar un controlador, como un PID, que regule
automáticamente la altura del monocóptero a un valor deseado, cerrando el lazo de control.
DIAPOSITIVA 20 — Cierre
Muchas gracias por su atención. Fuimos Andru Fonseca y Nayarith Ramírez, presentando la identificación de planta
del Monocóptero en su Etapa 1. Quedamos atentos a sus preguntas.


---
