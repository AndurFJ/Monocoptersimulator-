# 📋 PLAN DE EJECUCIÓN — HITO 2: Entrega Final y Banco

**Asignatura:** Control Análogo  
**Docente:** Ing. Jordan Dallan Guillot Fula, PhD (c)  
**Universidad del Magdalena — Programa de Ingeniería Electrónica**  
**Fechas:** Martes 22 de Sep — Viernes 25 de Sep, 2026  
**Ponderación:** 50 / 500 puntos (10% del curso)  
**Duración estimada:** 3-4 días  

---

## 🎯 VISIÓN GENERAL DEL HITO

Demostración experimental en banco + Informe técnico IEEE + Datos CSV + Script MATLAB documentado.

| Entregable | Punto máx | Estado |
|---|---|---|
| **2.1 Protocolo Experimental y Datos** | 12.5 pts | 🔲 Pendiente |
| **2.2 Cálculo Analítico Fit 3** | 12.5 pts | 🔲 Pendiente |
| **2.3 Validación y Ajuste del Modelo** | 12.5 pts | 🔲 Pendiente |
| **2.4 Informe IEEE y Análisis Crítico** | 12.5 pts | 🔲 Pendiente |
| **TOTAL** | **50 pts** | |

---

## 📦 FASE 1 — Preparación del Banco Experimental (Día 1)

### Objetivo: Garantizar datos completos, limpios y determinísticos a Ts = 50 ms

#### 1.1 Verificación del hardware
- [ ] **Hélice libre:** Verificar que gire sin rozar la torre de 100 cm
- [ ] **Cableado HC-SR04:** TRIG→D7, ECHO→D6, VCC 5 V + GND común entre Arduino y fuente 12V
- [ ] **ESC armado:** Confirmar secuencia de pitidos (1000µs 2s → 2000µs 2s → 1000µs 2s)
- [ ] **Firmware cargado:** `04_firmware/ensayo_escalon_original/sketch_sep13a` (o `04_firmware/arduino_uno/monocoptero_uno`, comando `STEP`) con:
  - Pin ESC = 9, Trig = 7, Echo = 6
  - `U0 = 1762`, `DELTA_U = 50`, `TS_MS = 50`
  - Failsafe a 85 cm activo

#### 1.2 Búsqueda de Hovering (u₀, y₀)
- [ ] Incrementar PWM en pasos de **25 µs** hasta flotamiento estable en **y₀ ≈ 20 cm**
- [ ] Registrar **u₀** (PWM de equilibrio)
- [ ] Esperar **5 s** en régimen permanente antes de continuar
- [ ] Documentar en bitácora: `u0 = _____ µs`, `y0 = _____ cm`

#### 1.3 Captura del escalón
- [ ] Aplicar escalón **Δu = +50 µs** (amplitud final 1812 µs), el mismo del ensayo del 13/09
- [ ] Adquirir a **Ts = 50 ms** vía puerto serial
- [ ] Duración: **10-12 s** hasta régimen final y∞
- [ ] Exportar a `datos_escalon.csv` con formato: `t_ms, pwm_us, altura_cm`
- [ ] **Verificación:** Sin pérdida de muestras, carro estable, escalón en régimen permanente

#### 1.4 Script de adquisición verificado
El `server.py` ya está operativo:
```bash
python 07_adquisicion_python/server.py  # Puerto COM3, 115200 baud, WebSocket /ws
```
- [x] Datos base convertidos a CSV real: `02_datos/datos_escalon_20260913_193329.csv` (el `.csv` anterior era un Excel renombrado)

---

## 🧮 FASE 2 — Cálculo Analítico Fit 3 (Día 2)

### Objetivo: Obtener K, τ, t₀ con el script `IdentificacionFIT3.m`

#### 2.1 Ejecución del pipeline MATLAB
Archivo: `03_matlab/IdentificacionFIT3.m` (corregido: lee bien las columnas y genera figuras en `03_matlab/figuras/`)

```matlab
% Pipeline completo (ya implementado):
% 1. readmatrix → datos[:,1]/1000 = t(s), u(µs), y(cm)
% 2. medfilt1(y, 5) → filtrado ruido del HC-SR04
% 3. Rebase temporal relativo al escalón
% 4. u0, u_inf, delta_u, y0, y_inf, delta_y
% 5. K = delta_y / delta_u  [cm/us]
% 6. t1 = interp1(y,t,y0+0.283*delta_y), t2 = interp1(y,t,y0+0.632*delta_y)
% 7. tau = 1.5*(t2-t1), t0 = max(0, t2-tau)
% 8. Modelo FOPDT: Gp = K/(tau*s+1)*exp(-t0*s)
% 9. lsim + métricas: Fit% ≥ 80%, RMSE
```

#### 2.2 Resultados esperados (referencia)
Usando `Polosmonocopter.m` como guía:
- K ≈ 0.4302 cm/µs
- τ ≈ 1.5719 s
- t₀ ≈ 0.1188 s

#### 2.3 Entregables 2.2
- [ ] Script `IdentificacionFIT3.m` documentado con comentarios
- [ ] Tabla de resultados: `K`, `τ`, `t₀`, `Fit%`, `RMSE`
- [ ] Gráfica comparativa experimental vs modelo FOPDT
- [ ] Verificar **Fit% ≥ 80%** (criterio de aceptación)

---

## 📊 FASE 3 — Validación y Simulación (Día 2-3)

### Objetivo: Validar el modelo FOPDT con simulación y análisis de estabilidad

#### 3.1 Mapa de polos (`Polosmonocopter.m`)
- [ ] Ejecutar `Polosmonocopter.m` para verificar estabilidad
- [ ] Confirmar polo en s = -1/τ ≈ -0.636 rad/s (estable, semieje izquierdo)
- [ ] Capturar pantalla del `pzmap` con `sgrid` para incluir en el informe

#### 3.2 Simulink
- [ ] Verificar `simulinkdelsistema.slx` reproduce la respuesta FOPDT
- [ ] Comparar con resultados MATLAB
- [ ] Capturar simulaciones para el informe

#### 3.3 Simulador 3D (opcional pero valioso)
El simulador en `Simulador/` (Vite + Three.js) puede usarse para:
- [ ] Visualizar la respuesta del modelo en 3D
- [ ] Comparar datos reales vs simulación en tiempo real
- [ ] Validar adicionalmente el modelo FOPDT

#### 3.4 Entregables 2.3
- [ ] Comparativa gráfica: experimental + modelo FOPDT + Simulink
- [ ] Análisis de residuos (errores entre modelo y experimento)
- [ ] Tabla resumen de métricas: `Fit%`, `RMSE`, `Max error`

---

## 📝 FASE 4 — Informe IEEE y Análisis Crítico (Día 3-4)

### Objetivo: Redactar informe técnico bajo formato IEEE con análisis profundo

#### 4.1 Estructura del informe IEEE

```
1.  Portada y encabezado
    - Título: "Identificación Dinámica del Monóptero Tower Copter
       mediante el Método Fit 3 (Smith & Corripio)"
    - Autor(es), fecha, curso, universidad

2.  Resumen (Abstract)
    - Objetivo, método, resultados clave (K, τ, t₀, Fit%)

3.  Introducción
    - Contexto del monocóptero 1-GDL
    - Justificación de linealización en hovering
    - Motivación del método Fit 3

4.  Fundamentos Teóricos
    - 4.1 Dinámica del sistema: Ft ∝ ω² ∝ u²(t)
    - 4.2 Modelo FOPDT: Gp(s) = K·e^(-t₀s)/(τs+1)
    - 4.3 Método Fit 3 (Smith & Corripio)
    - 4.4 Deducción de fórmulas (28.3%, 63.2%)

5.  Metodología Experimental
    - 5.1 Descripción del banco experimental
    - 5.2 Protocolo de armado del ESC
    - 5.3 Estrategia de captura a Ts = 50 ms
    - 5.4 Protocolo de seguridad

6.  Resultados y Análisis
    - 6.1 Obtención de u₀ y y₀
    - 6.2 Curva de respuesta al escalón
    - 6.3 Cálculo de K, τ, t₀
    - 6.4 Comparativa experimental vs modelo
    - 6.5 Análisis de errores y residuos

7.  Discusión y Análisis Crítico
    - 7.1 Limitaciones del modelo FOPDT
    - 7.2 Fuentes de error (ruido y ecos espurios del HC-SR04, inercia, fricción)
    - 7.3 Comparación con modelos alternativos (Fit 1, Fit 2)
    - 7.4 Implicaciones para el diseño de controladores PID

8.  Conclusiones
    - Síntesis de hallazgos y lecciones aprendidas

9.  Referencias

10. Apéndices
    - A: Código MATLAB documentado
    - B: Datos CSV completos
    - C: Fotografías del banco experimental
    - D: Código del firmware Arduino
```

#### 4.2 Preguntas técnicas del cuestionario (prepararse)
Tener respuestas preparadas para:
- ¿Por qué linealizar en el punto de hovering?
- ¿Por qué aproximar como FOPDT y no de 2.° orden?
- ¿Qué significa físico cada parámetro (K, τ, t₀)?
- ¿Cómo afecta el ruido del HC-SR04 a la identificación?
- ¿Qué mejora ofrecería un filtrado mayor (N=5 vs N=11)?
- ¿Cómo se relaciona el modelo FOPDT con el diseño PID posterior?

#### 4.3 Entregables 2.4
- [ ] Informe IEEE completo en formato PDF
- [ ] Código MATLAB comentado (`IdentificacionFIT3.m`, `Polosmonocopter.m`)
- [ ] Datos CSV (`datos_escalon.csv`)
- [ ] Fotografías del montaje experimental
- [ ] Firmware Arduino (`sketch_sep13a.ino`) documentado

---

## 🗓️ CRONOGRAMA DETALLADO

| Día | Fase | Actividades | Entregable |
|---|---|---|---|
| **Día 1** (22 Sep) | Fase 1 | Verificación hardware, hovering, captura escalón | `datos_escalon.csv`, bitácora |
| **Día 2** (23 Sep) | Fase 2 | Ejecución Fit 3, cálculo K, τ, t₀ | `IdentificacionFIT3.m`, resultados |
| **Día 2-3** | Fase 3 | Mapa de polos, Simulink, validación | Gráficas comparativas |
| **Día 3-4** (24-25 Sep) | Fase 4 | Redacción informe IEEE, análisis crítico | Informe completo PDF |

---

## 🧰 RECURSOS EXISTENTES DEL PROYECTO

| Archivo | Uso |
|---|---|
| `sketch_sep13a.ino` | Firmware Arduino (ESC, ultrasónico, Ts=50ms) |
| `server.py` | Backend FastAPI: COM3 → WebSocket → Excel |
| `IdentificacionFIT3.m` | Script pipeline Fit 3 (listo, solo adaptar datos) |
| `Polosmonocopter.m` | Mapa de polos con `pzmap` + `sgrid` |
| `simulinkdelsistema.slx` | Modelo Simulink para validación |
| `datos_serial_20260913_193329.csv` | Datos previos capturados (base para ajustar) |
| `Simulador/` | Simulador 3D Three.js + física 1-GDL |
| `generate_pptx.py` | Generador de presentaciones |
| `Presentacion_Monoptero_IEEE.pptx` | Plantilla de presentación IEEE |

---

## ✅ CHECKLIST DE VERIFICACIÓN FINAL

### Antes de la entrega (25 Sep):
- [ ] Datos CSV sin pérdida de muestras
- [ ] Fit% ≥ 80% en el modelo FOPDT
- [ ] RMSE cuantificado y bajo
- [ ] Mapa de polos muestra sistema estable
- [ ] Código MATLAB documentado y funcional
- [ ] Informe IEEE completo (formato correcto)
- [ ] Preguntas técnicas preparadas
- [ ] Fotografías del banco incluidas
- [ ] Firmware funcional y documentado
- [ ] Demo en banco lista para el docente

---

## 📁 ESTRUCTURA FINAL DE ENTREGA

```
guia/
├── PLAN_HITO2.md          ← Este plan
├── datos_escalon.csv        ← Datos del escalón
├── IdentificacionFIT3.m     ← Script Fit 3
├── Polosmonocopter.m        ← Mapa de polos
├── Informe_IEEE_Hito2.pdf   ← Informe final
├── datos_serial_20260913_193329.csv  ← Datos base
├── sketch_sep13a.ino        ← Firmware
└── Presentacion_Hito2.pptx  ← Presentación oral
```

---

## 🎓 NOTAS FINALES

**Criterios de éxito para Sobresaliente (10.5-12.5 pts por entregable):**
1. **Dominio conceptual** de la linealización y el modelo FOPDT
2. **Cálculo exacto** de K, τ, t₀ con el script MATLAB
3. **Ajuste sobresaliente** (Fit ≥ 80%) y análisis riguroso de residuos
4. **Informe técnico impecable** en formato IEEE con discusión física profunda

> **Nota:** El método Fit 3 evita el error común de usar tiempo absoluto de Arduino (`millis()`) en lugar de tiempo relativo referenciado al instante del escalón (t_step). Siempre usar `t = t_raw - t_step`.
