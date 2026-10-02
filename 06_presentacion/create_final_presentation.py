import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

def build_presentation():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Paleta de Colores IEEE / Academic Engineering
    C_BG = RGBColor(245, 247, 250)         # Fondo gris suave moderno (#F5F7FA)
    C_CARD_BG = RGBColor(255, 255, 255)    # Tarjetas blancas (#FFFFFF)
    C_CARD_BORDER = RGBColor(226, 232, 240)# Borde fino (#E2E8F0)
    C_PRIMARY = RGBColor(15, 37, 65)       # Navy Profundo (#0F2541)
    C_SECONDARY = RGBColor(2, 132, 199)    # Cyan Técnico (#0284C7)
    C_ACCENT_TEAL = RGBColor(13, 148, 136) # Teal Éxito (#0D9488)
    C_DARK = RGBColor(30, 41, 59)          # Texto principal (#1E293B)
    C_MUTED = RGBColor(100, 116, 139)      # Texto secundario (#64748B)
    C_ALERT = RGBColor(194, 65, 12)        # Alerta (#C2410C)
    C_CODE_BG = RGBColor(241, 245, 249)    # Gris código (#F1F5F9)

    FONT_HEAD = "Segoe UI"
    FONT_BODY = "Calibri"

    def apply_background(slide):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = C_BG
        bg.line.fill.background()
        return bg

    def add_card(slide, left, top, width, height, bg_color=C_CARD_BG, border_color=C_CARD_BORDER):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
        card.fill.solid()
        card.fill.fore_color.rgb = bg_color
        if border_color:
            card.line.color.rgb = border_color
            card.line.width = Pt(1)
        else:
            card.line.fill.background()
        return card

    def add_header(slide, eyebrow, title):
        top_bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(0.1))
        top_bar.fill.solid()
        top_bar.fill.fore_color.rgb = C_SECONDARY
        top_bar.line.fill.background()

        tb = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.7), Inches(1.1))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        p1 = tf.paragraphs[0]
        p1.text = eyebrow.upper()
        p1.font.name = FONT_HEAD
        p1.font.size = Pt(10)
        p1.font.bold = True
        p1.font.color.rgb = C_SECONDARY
        p1.space_after = Pt(3)

        p2 = tf.add_paragraph()
        p2.text = title
        p2.font.name = FONT_HEAD
        p2.font.size = Pt(22)
        p2.font.bold = True
        p2.font.color.rgb = C_PRIMARY

    def add_footer(slide, current_num, total_num=8):
        tb = slide.shapes.add_textbox(Inches(0.8), Inches(7.05), Inches(11.733), Inches(0.35))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0
        p = tf.paragraphs[0]
        p.text = "Control I — Universidad del Magdalena | Etapa 1: Caracterización y Modelado Dinámico"
        p.font.name = FONT_BODY
        p.font.size = Pt(9)
        p.font.color.rgb = C_MUTED

        num_box = slide.shapes.add_textbox(Inches(12.0), Inches(7.0), Inches(0.7), Inches(0.35))
        ntf = num_box.text_frame
        ntf.margin_left = ntf.margin_top = ntf.margin_right = ntf.margin_bottom = 0
        np = ntf.paragraphs[0]
        np.text = f"{current_num} / {total_num}"
        np.alignment = PP_ALIGN.RIGHT
        np.font.name = FONT_HEAD
        np.font.size = Pt(9)
        np.font.bold = True
        np.font.color.rgb = C_MUTED

    def set_speaker_notes(slide, notes_text):
        notes_slide = slide.notes_slide
        tf = notes_slide.notes_text_frame
        tf.text = notes_text

    # =========================================================================
    # SLIDE 1: PRESENTACIÓN DEL PROYECTO
    # =========================================================================
    s1 = prs.slides.add_slide(blank_layout)
    apply_background(s1)

    add_card(s1, Inches(0.8), Inches(0.8), Inches(11.733), Inches(5.9), C_CARD_BG, C_CARD_BORDER)
    hb = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(0.8), Inches(11.733), Inches(0.18))
    hb.fill.solid()
    hb.fill.fore_color.rgb = C_PRIMARY
    hb.line.fill.background()

    tb1 = s1.shapes.add_textbox(Inches(1.5), Inches(1.3), Inches(10.333), Inches(4.8))
    tf1 = tb1.text_frame
    tf1.word_wrap = True

    p = tf1.paragraphs[0]
    p.text = "UNIVERSIDAD DEL MAGDALENA • FACULTAD DE INGENIERÍA • CONTROL I"
    p.font.name = FONT_HEAD
    p.font.size = Pt(11)
    p.font.bold = True
    p.font.color.rgb = C_SECONDARY
    p.space_after = Pt(14)

    p = tf1.add_paragraph()
    p.text = "Caracterización Experimental y\nModelado Dinámico de un Monóptero"
    p.font.name = FONT_HEAD
    p.font.size = Pt(32)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(10)

    p = tf1.add_paragraph()
    p.text = "Identificación de Planta FOPDT en Lazo Abierto mediante el Método Fit 3 (Smith & Corripio)"
    p.font.name = FONT_HEAD
    p.font.size = Pt(15)
    p.font.color.rgb = C_MUTED
    p.space_after = Pt(26)

    pills = [
        ("OBJETIVO GENERAL", "Modelo FOPDT Continuo"),
        ("MÉTODO DE SÍNTESIS", "Fit 3 (Smith & Corripio)"),
        ("CRITERIO RÚBRICA", "Ajuste Fit ≥ 80%"),
        ("AJUSTE ALCANZADO", "Fit = 85.77% (Aprobado)")
    ]
    for i, (k, v) in enumerate(pills):
        px = Inches(1.5 + i * 2.6)
        py = Inches(4.6)
        add_card(s1, px, py, Inches(2.4), Inches(1.2), C_CODE_BG, C_CARD_BORDER)
        ptb = s1.shapes.add_textbox(px, py + Inches(0.15), Inches(2.4), Inches(0.9))
        ptf = ptb.text_frame
        ptf.margin_left = ptf.margin_right = ptf.margin_top = ptf.margin_bottom = 0
        pp1 = ptf.paragraphs[0]
        pp1.text = k
        pp1.alignment = PP_ALIGN.CENTER
        pp1.font.name = FONT_HEAD
        pp1.font.size = Pt(8.5)
        pp1.font.bold = True
        pp1.font.color.rgb = C_MUTED
        pp2 = ptf.add_paragraph()
        pp2.text = v
        pp2.alignment = PP_ALIGN.CENTER
        pp2.font.name = FONT_HEAD
        pp2.font.size = Pt(12)
        pp2.font.bold = True
        pp2.font.color.rgb = C_PRIMARY if i != 3 else C_ACCENT_TEAL

    add_footer(s1, 1)

    s1_notes = """GUION DEL EXPOSITOR - DIAPOSITIVA 1:
Buenos días, miembros del comité. En esta sustentación correspondiente a la Etapa 1 del proyecto, abordamos la modelación fenomenológica e identificación paramétrica de un monóptero vertical de un grado de libertad. El control de altura en plataformas sustentadas por empuje aerodinámico exige caracterizar rigurosamente la dinámica del actuador y la respuesta inercial de la planta antes de diseñar cualquier lazo cerrado.

Para este propósito, implementamos un protocolo de identificación en lazo abierto fundamentado en la técnica Fit 3 de Smith & Corripio. Nuestro objetivo no se limita a un ajuste empírico de curvas, sino a la formulación de una función de transferencia continua de primer orden con retardo que supere el umbral estricto del 80% de ajuste. Este modelo constituirá la base matemática para la sintonía del regulador en la Etapa 2."""
    set_speaker_notes(s1, s1_notes)

    # =========================================================================
    # SLIDE 2: ESTRUCTURA DEL PROYECTO / COMPONENTES
    # =========================================================================
    s2 = prs.slides.add_slide(blank_layout)
    apply_background(s2)
    add_header(s2, "Etapa 1 • Arquitectura de Hardware y Seguridad", "Estructura del Proyecto y Asignación de Componentes")

    add_card(s2, Inches(0.8), Inches(1.6), Inches(5.0), Inches(5.2))
    tb2 = s2.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(4.4), Inches(4.7))
    tf2 = tb2.text_frame
    tf2.word_wrap = True

    p = tf2.paragraphs[0]
    p.text = "Componentes y Especificaciones Técnicas"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(10)

    items_s2 = [
        ("Hardware Principal", "Motor brushless trifásico de sustentación, sensor ultrasónico de altura (precisión milimétrica), ESC de 30 A alimentado a 12V y microcontrolador Arduino."),
        ("Muestreo Determinístico", "Tiempo de muestreo constante Ts = 50 ms (fs = 20 Hz) para garantizar la fidelidad matemática de la dinámica transitoria sin jitter."),
        ("Seguridad (Failsafe)", "Condición crítica en firmware: si la cota física supera y(t) ≥ 85.0 cm, el PWM se reduce de inmediato a 1000 µs (apagado total) para proteger la torre de colisiones."),
        ("Rango de Operación", "Carrera mecánica total de 100 cm, con zona de prueba lineal confinada entre 10 cm y 85 cm.")
    ]
    for tit, desc in items_s2:
        p = tf2.add_paragraph()
        p.text = f"•  {tit}: "
        p.font.name = FONT_BODY
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        run = p.add_run()
        run.text = desc
        run.font.bold = False
        run.font.color.rgb = C_MUTED
        p.space_after = Pt(6)

    # Imagen del diagrama de conexiones
    add_card(s2, Inches(6.0), Inches(1.6), Inches(6.533), Inches(5.2))
    if os.path.exists('diagrama_conexiones.jpg'):
        s2.shapes.add_picture('diagrama_conexiones.jpg', Inches(6.2), Inches(1.8), width=Inches(6.133))
    
    cap_tb = s2.shapes.add_textbox(Inches(6.2), Inches(6.35), Inches(6.133), Inches(0.35))
    cap_tf = cap_tb.text_frame
    cap_p = cap_tf.paragraphs[0]
    cap_p.text = "Figura 1: Diagrama de conexionado eléctrico del banco Monóptero 1 GDL."
    cap_p.alignment = PP_ALIGN.CENTER
    cap_p.font.name = FONT_BODY
    cap_p.font.size = Pt(9.5)
    cap_p.font.italic = True
    cap_p.font.color.rgb = C_MUTED

    add_footer(s2, 2)

    s2_notes = """GUION DEL EXPOSITOR - DIAPOSITIVA 2:
La arquitectura electromecánica del banco consta de un carro portador guiado sobre varillas de baja fricción, accionado por un motor brushless y un variador ESC de 30 amperios alimentado a doce voltios regulados. La medición de cota vertical se adquiere mediante un sensor ultrasónico operando en el bus del microcontrolador.

En sistemas dinámicos continuos, la temporización de la toma de datos es crítica: fijamos un periodo de muestreo determinístico de cincuenta milisegundos mediante contadores de tiempo en microsegundos, evitando retardos acumulativos o 'jitter'. A su vez, establecimos por firmware un lazo de seguridad de máxima prioridad: si la altura detectada alcanza los ochenta y cinco centímetros, el ancho de pulso se colapsa instantáneamente a mil microsegundos, anulando el empuje para proteger la integridad estructural de la torre frente a colisiones con el tope mecánico."""
    set_speaker_notes(s2, s2_notes)

    # =========================================================================
    # SLIDE 3: FUNDAMENTACIÓN TEÓRICA (PRIMER ORDEN)
    # =========================================================================
    s3 = prs.slides.add_slide(blank_layout)
    apply_background(s3)
    add_header(s3, "Fundamentación Matemática", "Modelado Dinámico FOPDT y Principio de Polos Dominantes")

    add_card(s3, Inches(0.8), Inches(1.6), Inches(5.6), Inches(5.2))
    tb3_l = s3.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(5.0), Inches(4.7))
    tf3_l = tb3_l.text_frame
    tf3_l.word_wrap = True

    p = tf3_l.paragraphs[0]
    p.text = "Ecuación Estándar FOPDT"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(4)

    p = tf3_l.add_paragraph()
    p.text = "G_p(s) = (K · e^(-t0·s)) / (tau·s + 1)"
    p.font.name = "Consolas"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = C_SECONDARY
    p.space_after = Pt(12)

    p = tf3_l.add_paragraph()
    p.text = "Justificación Física de Reducción de Orden:"
    p.font.name = FONT_HEAD
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(4)

    p = tf3_l.add_paragraph()
    p.text = "m · y''(t) + B · y'(t) + m·g = F_t(t)"
    p.font.name = "Consolas"
    p.font.size = Pt(11)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(6)

    p = tf3_l.add_paragraph()
    p.text = "• Una planta inercial de 2.º orden se aproxima a 1.er orden debido a que la elevada fricción viscosa en las columnas de guiado (B >> m) y la aerodinámica generan un polo dominante.\n" \
             "• El polo rápido decae en milisegundos, quedando un único polo real que gobierna la envolvente transitoria."
    p.font.name = FONT_BODY
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_MUTED

    # Card Derecha: Principio de Control
    add_card(s3, Inches(6.6), Inches(1.6), Inches(5.933), Inches(5.2))
    tb3_r = s3.shapes.add_textbox(Inches(6.9), Inches(1.8), Inches(5.333), Inches(4.7))
    tf3_r = tb3_r.text_frame
    tf3_r.word_wrap = True

    p = tf3_r.paragraphs[0]
    p.text = "Principio de Control: Polos y Estabilidad"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(6)

    p = tf3_r.add_paragraph()
    p.text = "G(s) = N(s) / D(s)"
    p.font.name = "Consolas"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = C_SECONDARY
    p.space_after = Pt(10)

    p = tf3_r.add_paragraph()
    p.text = "Aporte Teórico Fundamental:"
    p.font.name = FONT_HEAD
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(4)

    c_points = [
        ("Raíces del Denominador (Polos)", "Las raíces de D(s) = 0 dictan el régimen transitorio y la estabilidad asintótica natural del sistema."),
        ("Comportamiento Aoscilatorio", "Al poseer un único polo real en el semiplano izquierdo (LHP), la respuesta al escalón es monótona creciente, estrictamente libre de sobreimpulsos o resonancias."),
        ("Parámetros FOPDT", "K: Ganancia estática (sensibilidad permanente).\ntau: Inercia temporal (velocidad de ascenso).\nt0: Retardo acumulado (latencia de actuador y sensor).")
    ]
    for t_c, d_c in c_points:
        p = tf3_r.add_paragraph()
        p.text = f"•  {t_c}: "
        p.font.name = FONT_BODY
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        run = p.add_run()
        run.text = d_c
        run.font.bold = False
        run.font.color.rgb = C_MUTED
        p.space_after = Pt(6)

    add_footer(s3, 3)

    s3_notes = """GUION DEL EXPOSITOR - DIAPOSITIVA 3:
Aunque la segunda ley de Newton modela el desplazamiento traslacional como un sistema de segundo orden debido a la masa inercial del conjunto, las fuerzas disipativas en este banco alteran sustancialmente la distribución de polos. La interacción aerodinámica de la hélice combinada con la fricción viscosa en las columnas de guiado introduce un coeficiente de amortiguamiento muy elevado.

Matemáticamente, esto separa ampliamente las dos raíces del polinomio característico: el polo rápido introduce un transitorio de orden casi imperceptible, dejando un único polo dominante en baja frecuencia. Por esta razón, la dinámica se proyecta rigurosamente sobre la forma estándar FOPDT. Recordemos que en control clásico, la posición de las raíces de D(s) en el semiplano complejo dicta la estabilidad natural del sistema: al carecer de polos conjugados complejos, no existirá oscilación en la respuesta natural."""
    set_speaker_notes(s3, s3_notes)

    # =========================================================================
    # SLIDE 4: IMPLEMENTACIÓN DEL MODELO Y LINEALIZACIÓN
    # =========================================================================
    s4 = prs.slides.add_slide(blank_layout)
    apply_background(s4)
    add_header(s4, "Fenomenología y Ajuste", "Linealización en Hovering y Ventaja del Método Fit 3")

    add_card(s4, Inches(0.8), Inches(1.6), Inches(5.2), Inches(5.2))
    tb4 = s4.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(4.6), Inches(4.7))
    tf4 = tb4.text_frame
    tf4.word_wrap = True

    p = tf4.paragraphs[0]
    p.text = "Linealización y Punto de Operación"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(6)

    s4_bullets = [
        ("No Linealidades Severas", "Empuje aerodinámico cuadrático respecto a la velocidad angular (Ft ∝ u^2) y zona muerta inicial (se requiere Ft ≥ m·g para vencer la gravedad)."),
        ("Punto de Operación (Hovering)", "Calibrado experimentalmente en u0 = 1762 µs, logrando altura estacionaria en y0 = 13.45 cm (evadiendo turbulencias del efecto suelo)."),
        ("Ventaja de Fit 3 (Smith & Corripio)", "Evalúa analíticamente los niveles de respuesta al 28.3% (t1) y 63.2% (t2). Evita la subjetividad y el ruido asociados al trazado manual de rectas tangentes en Fit 1."),
        ("Formulación Analítica", "tau = 1.5 · (t2 - t1)\nt0 = t2 - tau\nK = Delta_y / Delta_u")
    ]
    for tit, desc in s4_bullets:
        p = tf4.add_paragraph()
        p.text = f"•  {tit}: "
        p.font.name = FONT_BODY
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        run = p.add_run()
        run.text = desc
        run.font.bold = False
        run.font.color.rgb = C_MUTED
        p.space_after = Pt(6)

    # Card derecha con la gráfica de PWM
    add_card(s4, Inches(6.2), Inches(1.6), Inches(6.333), Inches(5.2))
    tb_pwm_t = s4.shapes.add_textbox(Inches(6.5), Inches(1.8), Inches(5.7), Inches(0.4))
    tf_pt = tb_pwm_t.text_frame
    p = tf_pt.paragraphs[0]
    p.text = "Señal de Excitación PWM (Hovering y Escalón)"
    p.font.name = FONT_HEAD
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY

    if os.path.exists('segundo grafico.png'):
        s4.shapes.add_picture('segundo grafico.png', Inches(6.4), Inches(2.35), width=Inches(5.933))

    tb_pwm_d = s4.shapes.add_textbox(Inches(6.5), Inches(4.9), Inches(5.7), Inches(1.7))
    tf_pd = tb_pwm_d.text_frame
    tf_pd.word_wrap = True
    p = tf_pd.paragraphs[0]
    p.text = "• Operación en Hovering: u0 = 1762 µs por 5 s (condición dy/dt ≈ 0).\n" \
             "• Inyección del Escalón: Salto de Delta_u = +50 µs alcanzando u_inf = 1812 µs.\n" \
             "• Variación controlada de solo 2.8% del rango ESC: garantiza validez de la aproximación lineal."
    p.font.name = FONT_BODY
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_MUTED

    add_footer(s4, 4)

    s4_notes = """GUION DEL EXPOSITOR - DIAPOSITIVA 4:
El monóptero presenta dos no linealidades severas: el empuje aerodinámico escala con el cuadrado de la velocidad del rotor, y existe una zona muerta mecánica donde cualquier comando por debajo del peso del carro no genera movimiento alguno. Para validar un modelo lineal invariante en el tiempo, es mandatorio linealizar en torno a un punto de operación estable.

Calibramos el estado de sustentación o 'hovering' en mil setecientos sesenta y dos microsegundos, situando el carro a trece punto cuarenta y cinco centímetros del suelo. Esta cota es intencional: aísla la dinámica de las recirculaciones turbulentas del efecto suelo. Para estimar la constante de tiempo y el retardo, seleccionamos Fit 3. Mientras que Fit 1 depende de la pendiente de una tangente trazada a criterio del operador —lo cual introduce un error analítico sustancial—, Fit 3 procesa numéricamente los tiempos exactos al veintiocho punto tres y sesenta y tres punto dos por ciento de la respuesta, garantizando repetibilidad matemática."""
    set_speaker_notes(s4, s4_notes)

    # =========================================================================
    # SLIDE 5: TOMA DE DATOS Y METODOLOGÍA
    # =========================================================================
    s5 = prs.slides.add_slide(blank_layout)
    apply_background(s5)
    add_header(s5, "Metodología Experimental", "Protocolo de Ensayo, Filtrado Digital y Respuesta Cinemática")

    add_card(s5, Inches(0.8), Inches(1.6), Inches(5.6), Inches(5.2))
    tb5_l = s5.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(5.0), Inches(4.7))
    tf5_l = tb5_l.text_frame
    tf5_l.word_wrap = True

    p = tf5_l.paragraphs[0]
    p.text = "Protocolo de Excitación y Estabilización"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(8)

    p_items_s5 = [
        ("Sustentación Previa (5 s)", "Se aseguró sustentación estable por 5 segundos verificando dy/dt ≈ 0 antes de perturbar el sistema."),
        ("Inyección del Escalón", "Se inyectó un escalón Delta_u = 50 µs, elevando el PWM de u0 = 1762 µs a u_inf = 1812 µs a periodo Ts = 50 ms."),
        ("Procesamiento Digital", "Aplicación de un filtro de mediana de orden 5 para rechazar valores atípicos (outliers) del sensor ultrasónico sin distorsionar la fase de la señal ni falsear el tiempo muerto."),
        ("Respuesta Física Obtenida", "El carro se estabilizó asintóticamente en y_inf = 34.96 cm, partiendo de y0 = 13.45 cm, registrando un salto neto Delta_y = 21.51 cm.")
    ]
    for tit, desc in p_items_s5:
        p = tf5_l.add_paragraph()
        p.text = f"•  {tit}: "
        p.font.name = FONT_BODY
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        run = p.add_run()
        run.text = desc
        run.font.bold = False
        run.font.color.rgb = C_MUTED
        p.space_after = Pt(6)

    # Card Derecha: Desglose de Cálculo Numérico
    add_card(s5, Inches(6.6), Inches(1.6), Inches(5.933), Inches(5.2))
    tb5_r = s5.shapes.add_textbox(Inches(6.9), Inches(1.8), Inches(5.333), Inches(4.7))
    tf5_r = tb5_r.text_frame
    tf5_r.word_wrap = True

    p = tf5_r.paragraphs[0]
    p.text = "Cálculo Numérico con Fit 3"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(8)

    calc_points = [
        ("Nivel 28.3% (t1)", "y(t1) = 13.45 + 0.283 · (21.51) = 19.54 cm\n--> t1 = 0.6427 s (interpolado con interp1)"),
        ("Nivel 63.2% (t2)", "y(t2) = 13.45 + 0.632 · (21.51) = 27.04 cm\n--> t2 = 1.6906 s (interpolado con interp1)"),
        ("Constante de Tiempo (tau)", "tau = 1.5 · (1.6906 - 0.6427) = 1.5719 s"),
        ("Retardo Aparente (t0)", "t0 = 1.6906 - 1.5719 = 0.1188 s"),
        ("Ganancia Estática (K)", "K = 21.51 cm / 50 µs = 0.4302 cm/µs")
    ]
    for tit, eq in calc_points:
        p = tf5_r.add_paragraph()
        p.text = tit
        p.font.name = FONT_HEAD
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_SECONDARY
        p = tf5_r.add_paragraph()
        p.text = eq
        p.font.name = "Consolas"
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(5)

    add_footer(s5, 5)

    s5_notes = """GUION DEL EXPOSITOR - DIAPOSITIVA 5:
El protocolo experimental exigió mantener la plataforma en flotación estacionaria durante cinco segundos continuos, confirmando que la derivada temporal de la cota fuese nula antes de perturbar el sistema. Transcurrido este lapso, inyectamos un escalón determinístico de cincuenta microsegundos, llevando la excitación a mil ochocientos doce microsegundos. Este incremento representa únicamente el dos punto ocho por ciento del rango operativo del ESC, asegurando que nos mantengamos estrictamente dentro de la ventana de linealización local.

En cuanto a la señal del sensor, las reflexiones acústicas dispersas generaban picos de ruido esporádicos. Si hubiésemos implementado un filtro pasabajas analógico o IIR, habríamos introducido un desfase artificial alterando la medición del tiempo muerto. Por ello, aplicamos un filtro digital de mediana de orden cinco: este elimina eficazmente los valores atípicos sin agregar retardo de fase. La planta respondió de manera monótona, alcanzando un régimen estacionario final en treinta y cuatro punto noventa y seis centímetros."""
    set_speaker_notes(s5, s5_notes)

    # =========================================================================
    # SLIDE 6: SIMULACIÓN EN SIMULINK
    # =========================================================================
    s6 = prs.slides.add_slide(blank_layout)
    apply_background(s6)
    add_header(s6, "Entorno Computacional", "Simulación en Simulink y Recomposición de Cota Absoluta")

    add_card(s6, Inches(0.8), Inches(1.6), Inches(5.4), Inches(5.2))
    tb6_l = s6.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(4.8), Inches(4.7))
    tf6_l = tb6_l.text_frame
    tf6_l.word_wrap = True

    p = tf6_l.paragraphs[0]
    p.text = "Diagrama de Bloques Estructurado"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(8)

    sim_bullets = [
        ("Variables Incrementales", "La simulación opera sobre variables de desviación respecto al hovering: Delta_u(t) y Delta_y(t)."),
        ("Bloque Step", "Aplica un salto unitario escalado de amplitud Delta_u = 50 µs en el instante de excitación."),
        ("Bloque Transfer Fcn", "Implementa la dinámica continua de primer orden: Numerador = [0.4302], Denominador = [1.5719  1]."),
        ("Bloque Transport Delay", "Introduce el retardo temporal puro t0 = 0.1188 s mediante buffer circular interno."),
        ("Bloque Sum (Recomposición)", "Suma la condición inicial de sustentación y0 = 13.45 cm para obtener la cota absoluta: y(t) = 13.45 + Delta_y(t).")
    ]
    for tit, desc in sim_bullets:
        p = tf6_l.add_paragraph()
        p.text = f"•  {tit}: "
        p.font.name = FONT_BODY
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        run = p.add_run()
        run.text = desc
        run.font.bold = False
        run.font.color.rgb = C_MUTED
        p.space_after = Pt(6)

    # Card Derecha: Placeholder visual de Simulink
    add_card(s6, Inches(6.4), Inches(1.6), Inches(6.133), Inches(5.2))
    tb6_r = s6.shapes.add_textbox(Inches(6.7), Inches(1.8), Inches(5.5), Inches(4.7))
    tf6_r = tb6_r.text_frame
    tf6_r.word_wrap = True

    p = tf6_r.paragraphs[0]
    p.text = "Arquitectura de Bloques en Cascada"
    p.font.name = FONT_HEAD
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(14)

    # Esquema visual en tarjeta
    diag_box = s6.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.8), Inches(2.5), Inches(5.3), Inches(2.8))
    diag_box.fill.solid()
    diag_box.fill.fore_color.rgb = C_CODE_BG
    diag_box.line.color.rgb = C_CARD_BORDER

    dtb = s6.shapes.add_textbox(Inches(6.9), Inches(2.6), Inches(5.1), Inches(2.6))
    dtf = dtb.text_frame
    dtf.word_wrap = True
    dp = dtf.paragraphs[0]
    dp.text = "[Insertar Imagen: Diagrama de bloques estructurado en Simulink]"
    dp.font.name = FONT_HEAD
    dp.font.size = Pt(11)
    dp.font.bold = True
    dp.font.color.rgb = C_SECONDARY
    dp.alignment = PP_ALIGN.CENTER
    dp.space_after = Pt(10)

    dp2 = dtf.add_paragraph()
    dp2.text = "Step (Δu=50) ──> [ 0.4302/(1.5719s+1) ] ──> [ e^(-0.1188s) ] ──> ( + ) ──> Scope y(t)\n" \
               "                                                                 ▲\n" \
               "                                            Constant (y0 = 13.45) ─┘"
    dp2.font.name = "Consolas"
    dp2.font.size = Pt(8.5)
    dp2.font.color.rgb = C_DARK

    cap_s6 = s6.shapes.add_textbox(Inches(6.7), Inches(5.6), Inches(5.5), Inches(1.0))
    tf_c6 = cap_s6.text_frame
    tf_c6.word_wrap = True
    p = tf_c6.paragraphs[0]
    p.text = "Validación Cruzada: La salida simulada reproduce analíticamente la ecuación diferencial, validando idéntica parametrización respecto a la función lsim() de MATLAB."
    p.font.name = FONT_BODY
    p.font.size = Pt(10)
    p.font.color.rgb = C_MUTED

    add_footer(s6, 6)

    s6_notes = """GUION DEL EXPOSITOR - DIAPOSITIVA 6:
En esta diapositiva observamos la implementación computacional del modelo en el entorno Simulink. La arquitectura está diseñada en variables de desviación: la señal de entrada al bloque de función de transferencia no es el pulso absoluto, sino el salto incremental de cincuenta microsegundos.

La dinámica se computa a través del bloque de primer orden parametrizado con la ganancia y la constante de tiempo identificadas, pasando por el bloque de retardo de transporte. Al final del esquema, introducimos un sumador que añade el sesgo inicial de trece punto cuarenta y cinco centímetros. Esta adición permite reconstruir la cota física absoluta y comparar, en el bloque Scope, la trayectoria simulada frente a la cinemática registrada en el ensayo físico real."""
    set_speaker_notes(s6, s6_notes)

    # =========================================================================
    # SLIDE 7: RESULTADOS EXPERIMENTALES
    # =========================================================================
    s7 = prs.slides.add_slide(blank_layout)
    apply_background(s7)
    add_header(s7, "Validación Experimental", "Parámetros Analíticos Identificados y Métricas de Ajuste")

    add_card(s7, Inches(0.8), Inches(1.6), Inches(5.2), Inches(5.2))
    tb7_t = s7.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(4.6), Inches(0.4))
    tf7_t = tb7_t.text_frame
    p = tf7_t.paragraphs[0]
    p.text = "Parámetros Oficiales del Modelo"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY

    # Tabla de parámetros
    rows, cols = 9, 3
    table_shape = s7.shapes.add_table(rows, cols, Inches(1.0), Inches(2.3), Inches(4.8), Inches(3.6))
    table = table_shape.table
    table.columns[0].width = Inches(1.2)
    table.columns[1].width = Inches(2.3)
    table.columns[2].width = Inches(1.3)

    t_data = [
        ("Parámetro", "Descripción", "Valor"),
        ("K", "Ganancia estática", "0.4302 cm/µs"),
        ("tau", "Constante de tiempo", "1.5719 s"),
        ("t0", "Tiempo muerto", "0.1188 s"),
        ("sp", "Polo dominante", "-0.6362 rad/s"),
        ("t0 / tau", "Índice controlabilidad", "0.0756"),
        ("Delta y", "Salto de altura", "+21.51 cm"),
        ("RMSE", "Error cuadrático", "0.7540 cm"),
        ("Fit %", "Ajuste global", "85.77 %")
    ]
    for r_idx, row in enumerate(t_data):
        for c_idx, val in enumerate(row):
            cell = table.cell(r_idx, c_idx)
            cell.text = val
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cp = cell.text_frame.paragraphs[0]
            cp.alignment = PP_ALIGN.CENTER if c_idx != 1 else PP_ALIGN.LEFT
            cp.font.name = FONT_HEAD if r_idx == 0 else FONT_BODY
            cp.font.size = Pt(9.5) if r_idx != 0 else Pt(10)
            if r_idx == 0:
                cp.font.bold = True
                cp.font.color.rgb = C_CARD_BG
                cell.fill.solid()
                cell.fill.fore_color.rgb = C_PRIMARY
            elif r_idx == 8: # Fit %
                cp.font.bold = True
                cp.font.color.rgb = C_ACCENT_TEAL
                cell.fill.solid()
                cell.fill.fore_color.rgb = C_CODE_BG
            else:
                cell.fill.solid()
                cell.fill.fore_color.rgb = C_CARD_BG if r_idx % 2 == 1 else C_CODE_BG

    tb_ft = s7.shapes.add_textbox(Inches(1.0), Inches(6.0), Inches(4.8), Inches(0.7))
    tff = tb_ft.text_frame
    p = tff.paragraphs[0]
    p.text = "G_p(s) = (0.4302 · e^(-0.1188·s)) / (1.5719·s + 1)"
    p.font.name = "Consolas"
    p.font.size = Pt(11)
    p.font.bold = True
    p.font.color.rgb = C_SECONDARY

    # Card Derecha: Gráfica Comparativa MATLAB
    add_card(s7, Inches(6.2), Inches(1.6), Inches(6.333), Inches(5.2))
    tb_g1_t = s7.shapes.add_textbox(Inches(6.5), Inches(1.8), Inches(5.7), Inches(0.4))
    tf_gt = tb_g1_t.text_frame
    p = tf_gt.paragraphs[0]
    p.text = "Respuesta Experimental Filtrada vs Modelo FOPDT"
    p.font.name = FONT_HEAD
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY

    if os.path.exists('Primer grafico.png'):
        s7.shapes.add_picture('Primer grafico.png', Inches(6.4), Inches(2.35), width=Inches(5.933))

    tb_g1_d = s7.shapes.add_textbox(Inches(6.5), Inches(4.7), Inches(5.7), Inches(1.9))
    tf_gd = tb_g1_d.text_frame
    tf_gd.word_wrap = True
    p = tf_gd.paragraphs[0]
    p.text = "• Ajuste Experimental Fit = 85.77% (Supera el 80% exigido por la rúbrica técnica).\n" \
             "• Error Cuadrático Medio RMSE = 0.7540 cm (< 8 mm de residuo dinámico promedio).\n" \
             "• Trayectoria Monótona y Estable: El modelo explica con alta fidelidad la sustentación sin oscilaciones parásitas."
    p.font.name = FONT_BODY
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_DARK

    add_footer(s7, 7)

    s7_notes = """GUION DEL EXPOSITOR - DIAPOSITIVA 7:
Los resultados experimentales arrojan una ganancia estática K de cero punto cuatro mil trescientos dos centímetros por microsegundo, lo que cuantifica la sensibilidad del empuje en régimen permanente. La constante de tiempo se ubicó en uno punto cincuenta y siete segundos, reflejando la inercia total del sistema mecánico y aerodinámico, mientras que el retardo aparente fue de ciento dieciocho milisegundos, atribuible a la latencia de muestreo del sensor, la inductancia del devanado y la respuesta del ESC.

Al confrontar la simulación analítica frente a la serie temporal experimental, obtenemos un error cuadrático medio de cero punto setenta y cinco centímetros —inferior a ocho milímetros a lo largo de toda la excursión transitoria—. Asimismo, el índice de ajuste porcentual Fit alcanzó un ochenta y cinco punto setenta y siete por ciento. Este valor supera con creces el umbral del ochenta por ciento fijado en la rúbrica de evaluación técnica, validando el modelo FOPDT para su uso en la etapa de control."""
    set_speaker_notes(s7, s7_notes)

    # =========================================================================
    # SLIDE 8: CONCLUSIONES Y PROYECCIÓN A CONTROL
    # =========================================================================
    s8 = prs.slides.add_slide(blank_layout)
    apply_background(s8)
    add_header(s8, "Síntesis y Trabajo Futuro", "Conclusiones Técnicas y Proyección al Lazo Cerrado (Etapa 2)")

    add_card(s8, Inches(0.8), Inches(1.6), Inches(5.8), Inches(5.2))
    tb8_l = s8.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(5.2), Inches(4.7))
    tf8_l = tb8_l.text_frame
    tf8_l.word_wrap = True

    p = tf8_l.paragraphs[0]
    p.text = "Conclusiones y Validación de Hipótesis"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(8)

    c_list = [
        ("Validación del Modelo", "El ajuste del 85.77% valida formalmente la hipótesis de linealización local y la existencia de un único polo dominante en s = -0.6362 rad/s en lazo abierto."),
        ("Relación de Controlabilidad", "t0 / tau = 0.1188 / 1.5719 = 0.0756 << 0.1. Al ser un retardo despreciable, la planta es altamente controlable mediante algoritmos clásicos sin riesgo de inestabilidad por desfase."),
        ("Proyección a la Etapa 2", "La función FOPDT obtenida permite ahora el cálculo analítico directo de reguladores continuos y discretos (Ziegler-Nichols, Cohen-Coon, IMC)."),
        ("Arquitectura PID Futura", "Gc(s) = Kp · (1 + 1/(Ti·s) + Td·s). Aportará ceros al lazo para amortiguar el ascenso y cancelará asintóticamente el error de régimen permanente provocado por la gravedad.")
    ]
    for tit, desc in c_list:
        p = tf8_l.add_paragraph()
        p.text = f"•  {tit}: "
        p.font.name = FONT_BODY
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        run = p.add_run()
        run.text = desc
        run.font.bold = False
        run.font.color.rgb = C_MUTED
        p.space_after = Pt(6)

    # Card Derecha: Gráfica de polos con sgrid
    add_card(s8, Inches(6.8), Inches(1.6), Inches(5.733), Inches(5.2))
    if os.path.exists('Polos en el plano complejo.png'):
        s8.shapes.add_picture('Polos en el plano complejo.png', Inches(7.0), Inches(1.8), width=Inches(5.333))

    tb8_cap = s8.shapes.add_textbox(Inches(7.0), Inches(6.25), Inches(5.333), Inches(0.35))
    tf8_c = tb8_cap.text_frame
    p = tf8_c.paragraphs[0]
    p.text = "Figura 3: Polo estable en LHP (s = -0.6362 rad/s) con rejilla sgrid en MATLAB."
    p.alignment = PP_ALIGN.CENTER
    p.font.name = FONT_BODY
    p.font.size = Pt(9.5)
    p.font.italic = True
    p.font.color.rgb = C_MUTED

    add_footer(s8, 8)

    s8_notes = """GUION DEL EXPOSITOR - DIAPOSITIVA 8:
Para concluir, la Etapa 1 cierra con dos certezas físicas fundamentales. Primero, el polo del sistema se sitúa en s = -0.6362 radianes por segundo sobre el eje real negativo, garantizando que la planta en lazo abierto es intrínsecamente estable y asintóticamente aperiódica. Segundo, la relación de controlabilidad t0 sobre tau es de apenas cero punto cero setenta y cinco; al ser un orden de magnitud inferior a cero punto uno, demuestra que el retardo de transporte no representará un obstáculo crítico de desfasamiento para el lazo cerrado.

Con los tres parámetros de la planta plenamente identificados, estamos habilitados para avanzar hacia la Etapa 2: el diseño analítico del lazo cerrado. Implementaremos un controlador PID digital donde la componente integral garantizará error nulo de seguimiento compensando el peso propio de la masa suspendida, mientras que las acciones proporcional y derivativa regularán la tasa de ascenso minimizando el sobreimpulso. Muchas gracias; quedamos atentos a las preguntas del jurado."""
    set_speaker_notes(s8, s8_notes)

    # Guardar presentación final
    output_filename = "Presentacion_Monoptero_IEEE.pptx"
    prs.save(output_filename)
    print(f"Presentación final guardada exitosamente en {output_filename}")
    
    # Intentar sobrescribir también Exposicion_Monoptero_Pro.pptx si está libre
    try:
        prs.save("Exposicion_Monoptero_Pro.pptx")
        print("También se actualizó Exposicion_Monoptero_Pro.pptx")
    except Exception as e:
        print(f"Nota sobre archivo alternativo: {e}")

if __name__ == "__main__":
    build_presentation()
