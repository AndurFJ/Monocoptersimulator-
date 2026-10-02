from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

# Crear presentación
prs = Presentation()

# Layouts comunes
TITLE_SLIDE_LAYOUT = prs.slide_layouts[0]
TITLE_AND_CONTENT_LAYOUT = prs.slide_layouts[1]
BLANK_LAYOUT = prs.slide_layouts[6]
PICTURE_WITH_CAPTION_LAYOUT = prs.slide_layouts[8]

def format_title(title_shape):
    title_shape.text_frame.paragraphs[0].font.name = 'Georgia'
    title_shape.text_frame.paragraphs[0].font.color.rgb = RGBColor(27, 58, 92) # #1b3a5c
    title_shape.text_frame.paragraphs[0].font.bold = True

def add_bullet(tf, text, level=0):
    p = tf.add_paragraph()
    p.text = text
    p.level = level
    p.font.name = 'Arial'
    p.font.size = Pt(16)

# =========================================================
# Diapositiva 1: Título
# =========================================================
slide = prs.slides.add_slide(TITLE_SLIDE_LAYOUT)
title = slide.shapes.title
subtitle = slide.placeholders[1]

title.text = "Exposición Técnica: Control de Monóptero"
format_title(title)
subtitle.text = "Diagrama de conexiones, Protocolo ESC, Muestreo y Fit 3\nUniversidad del Magdalena"

# =========================================================
# Diapositiva 2: Diagrama de Conexiones
# =========================================================
slide = prs.slides.add_slide(TITLE_AND_CONTENT_LAYOUT)
title = slide.shapes.title
title.text = "Diagrama de Conexiones"
format_title(title)

# Añadir viñetas
tf = slide.placeholders[1].text_frame
tf.text = "Arquitectura de hardware de la planta de 1 GDL:"
tf.paragraphs[0].font.name = 'Arial'
tf.paragraphs[0].font.size = Pt(18)
add_bullet(tf, "Arduino Uno/Mega como controlador central.")
add_bullet(tf, "Sensor ultrasónico HC-SR04 para medición de la altura.")
add_bullet(tf, "ESC de 30 A (pin D9) y Motor Brushless.")
add_bullet(tf, "Fuente DC 12V 5A con bus GND unificado.")

# Añadir imagen
left = Inches(4.5)
top = Inches(2.0)
height = Inches(4.5)
try:
    slide.shapes.add_picture('diagrama_conexiones.jpg', left, top, height=height)
except Exception as e:
    print(f"Error cargando diagrama: {e}")

# =========================================================
# Diapositiva 3: Protocolo de Armado del ESC
# =========================================================
slide = prs.slides.add_slide(TITLE_AND_CONTENT_LAYOUT)
title = slide.shapes.title
title.text = "Protocolo de Armado del ESC"
format_title(title)

tf = slide.placeholders[1].text_frame
tf.text = "El ESC requiere una secuencia de seguridad para calibrar el rango de PWM:"
tf.paragraphs[0].font.name = 'Arial'
tf.paragraphs[0].font.size = Pt(18)

add_bullet(tf, "1. Señal Inicial Mínima (1000 µs):")
add_bullet(tf, "El Arduino envía 1000 µs durante 2 segundos. El ESC inicializa y reconoce el umbral de throttle 0%.", level=1)

add_bullet(tf, "2. Señal Máxima (2000 µs):")
add_bullet(tf, "Se salta al máximo pulso durante 2 segundos. El ESC memoriza el throttle 100%.", level=1)

add_bullet(tf, "3. Confirmación (1000 µs):")
add_bullet(tf, "Se retorna a 1000 µs por 2 segundos. El ESC emite los pitidos de armado exitoso.", level=1)

add_bullet(tf, "Código de armado:", level=0)
add_bullet(tf, "esc.writeMicroseconds(1000); delay(2000);\nesc.writeMicroseconds(2000); delay(2000);\nesc.writeMicroseconds(1000); delay(2000);", level=1)

# =========================================================
# Diapositiva 4: Estrategia de Captura (Ts = 50 ms)
# =========================================================
slide = prs.slides.add_slide(TITLE_AND_CONTENT_LAYOUT)
title = slide.shapes.title
title.text = "Estrategia de Captura (Ts = 50 ms)"
format_title(title)

tf = slide.placeholders[1].text_frame
tf.text = "Muestreo determinístico para evitar jitter:"
tf.paragraphs[0].font.name = 'Arial'
tf.paragraphs[0].font.size = Pt(18)

add_bullet(tf, "Período de muestreo (Ts) = 50 ms (20 Hz):")
add_bullet(tf, "Garantiza suficiente resolución temporal para la dinámica del monóptero sin saturar el bus Serial.", level=1)

add_bullet(tf, "Cumplimiento del Teorema de Nyquist:")
add_bullet(tf, "La frecuencia de corte del sistema es f_c ≈ 0.1 Hz. Al muestrear a 20 Hz, fs >> 2*f_c, evitando aliasing.", level=1)

add_bullet(tf, "Implementación no bloqueante (millis()):")
add_bullet(tf, "if (t_actual - t_previo >= 50) { t_previo = t_actual; ... }", level=1)
add_bullet(tf, "Asegura ciclos exactos a diferencia de la función delay().", level=1)

# Añadir imagen del PWM
left = Inches(5.0)
top = Inches(4.5)
width = Inches(4.5)
try:
    slide.shapes.add_picture('segundo grafico.png', left, top, width=width)
except Exception as e:
    print(f"Error cargando grafico pwm: {e}")

# =========================================================
# Diapositiva 5: Formulación Fit 3
# =========================================================
slide = prs.slides.add_slide(TITLE_AND_CONTENT_LAYOUT)
title = slide.shapes.title
title.text = "Formulación del Método Fit 3"
format_title(title)

tf = slide.placeholders[1].text_frame
tf.text = "Identificación de Smith & Corripio:"
tf.paragraphs[0].font.name = 'Arial'
tf.paragraphs[0].font.size = Pt(18)

add_bullet(tf, "Se asume un modelo FOPDT: G(s) = K * exp(-t0*s) / (tau*s + 1)")
add_bullet(tf, "En lugar de trazar una recta tangente (Fit 1), Fit 3 busca dos puntos exactos de la respuesta temporal al escalón:")
add_bullet(tf, "t1: tiempo en que la salida alcanza el 28.3% de su excursión total.", level=1)
add_bullet(tf, "t2: tiempo en que la salida alcanza el 63.2% de su excursión total.", level=1)

add_bullet(tf, "Cálculo analítico exacto:")
add_bullet(tf, "tau = 1.5 * (t2 - t1)", level=1)
add_bullet(tf, "t0 = t2 - tau", level=1)
add_bullet(tf, "K = delta_Y / delta_U", level=1)

add_bullet(tf, "Ventaja: Elimina la subjetividad del operador al trazar líneas gráficas. La interpolación en MATLAB lo hace determinístico.")

# =========================================================
# Diapositiva 6: Resultados y Estabilidad
# =========================================================
slide = prs.slides.add_slide(TITLE_AND_CONTENT_LAYOUT)
title = slide.shapes.title
title.text = "Validación y Análisis de Estabilidad"
format_title(title)

tf = slide.placeholders[1].text_frame
tf.text = "Curva del Modelo vs Planta Real:"
tf.paragraphs[0].font.name = 'Arial'
tf.paragraphs[0].font.size = Pt(18)

left1 = Inches(0.5)
top1 = Inches(2.0)
width1 = Inches(4.5)

left2 = Inches(5.5)
top2 = Inches(2.0)
width2 = Inches(4.0)

try:
    slide.shapes.add_picture('Primer grafico.png', left1, top1, width=width1)
    slide.shapes.add_picture('Polos en el plano complejo.png', left2, top2, width=width2)
except Exception as e:
    print(f"Error cargando imagenes de validacion: {e}")

p = tf.add_paragraph()
p.text = "\n\n\n\n\n\n\n\n\n- Fit Alcanzado: 85.77% (Supera meta del 80%).\n- Polo LHP estable en s = -0.6362 rad/s."
p.font.size = Pt(16)

# Guardar
prs.save('Exposicion_Monoptero.pptx')
print("Presentacion Exposicion_Monoptero.pptx generada con exito.")
