# Control I — Monocóptero (Tower Copter) de 1 GDL

Universidad del Magdalena · Control Análogo · Docente: Ing. Jordan Dallan Guillot Fula, PhD (c)

Modelo identificado (Fit 3, Smith & Corripio):

    Gp(s) = 0.4302 · e^(−0.1188 s) / (1.5719 s + 1)   [cm/µs]     Fit = 85.77 %, RMSE = 0.754 cm
    punto de operación: u0 = 1762 µs, y0 = 13.45 cm, escalón Δu = +50 µs, Ts = 50 ms

## Carpetas

| Carpeta | Contenido |
|---|---|
| `01_guia/` | Guía del laboratorio, guion de la exposición y plan del Hito 2 |
| `02_datos/` | Ensayo del escalón del 13/09/2026 (`.csv` y `.xlsx` originales) y ensayos con ESP32 del 01/10/2026 |
| `03_matlab/` | `IdentificacionFIT3.m`, `Polosmonocopter.m`, `ValidacionSimulink.m`, `ComparacionEnsayos.m`, `simulinkdelsistema.slx` y `figuras/` |
| `04_firmware/` | Firmware **Arduino Uno** y **ESP32** + protocolo (`PROTOCOLO.md`) |
| `05_informe_ieee/` | Informe IEEE del Hito 2 (`informe_ieee.tex` + `figuras/`) |
| `06_presentacion/` | `presentacion_hito2/` (presentación con el banco en 3D) y las presentaciones `.pptx` anteriores |
| `07_adquisicion_python/` | Servidor FastAPI de adquisición por COM3 (`server.py`) |
| `Simulador/` | Simulador 3D web (Vite + TypeScript + Three.js) |
| `_archivo/` | Versiones anteriores reemplazadas (no se usan) |

**Para retomar el trabajo con el prototipo armado: ver `PLAN_CONTINUACION.md`.**

## Uso rápido

- **MATLAB**: abrir `03_matlab/IdentificacionFIT3.m` y ejecutar (lee `02_datos/` solo). Después `Polosmonocopter.m`, `ValidacionSimulink.m` y `ComparacionEnsayos.m`. Cada script explica qué hace con `help NombreDelScript`.
- **Simulador**: `cd Simulador && npm install && npm run dev` (abrir en Chrome/Edge para el modo Serial). Con `npm run remoto` se puede manejar también desde el teléfono (tarjeta *Control remoto*, código QR).
- **Etapa 2 (segundo orden, PID y SCADA)**: plan de trabajo en `PLAN_ETAPA2.md`.
- **Firmware**: ver `04_firmware/PROTOCOLO.md`. Para el ESP32, copiar `04_firmware/esp32/config.h.example` como `04_firmware/esp32/monocoptero_esp32/config.h` y poner el nombre y la clave del WiFi (ese archivo no se sube al repositorio).
- **Informe**: subir `05_informe_ieee/` a Overleaf y compilar `informe_ieee.tex` (pdfLaTeX).
- **Presentación del Hito 2**: abrir `06_presentacion/presentacion_hito2/index.html` en Chrome o Edge (funciona sin internet). Flechas o clic para avanzar, `F` pantalla completa, `P` pausa el 3D.
- **Presentaciones anteriores**: los scripts `.py` se ejecutan desde `06_presentacion/`.
