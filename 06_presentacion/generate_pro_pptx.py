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

    # Paleta de Colores
    C_BG = RGBColor(245, 247, 250)         # Fondo gris suave moderno
    C_CARD_BG = RGBColor(255, 255, 255)    # Tarjetas blancas
    C_CARD_BORDER = RGBColor(226, 232, 240)# Bordes sutiles
    C_PRIMARY = RGBColor(15, 37, 65)       # Azul Marino Profundo (Navy)
    C_SECONDARY = RGBColor(2, 132, 199)    # Cyan / Azul Técnico
    C_ACCENT_TEAL = RGBColor(13, 148, 136) # Teal / Éxito
    C_DARK = RGBColor(30, 41, 59)          # Texto principal oscuro
    C_MUTED = RGBColor(100, 116, 139)      # Texto secundario gris
    C_ALERT = RGBColor(194, 65, 12)        # Naranja alerta
    C_CODE_BG = RGBColor(241, 245, 249)    # Fondo de código

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
        # Top banner line
        top_bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(0.1))
        top_bar.fill.solid()
        top_bar.fill.fore_color.rgb = C_SECONDARY
        top_bar.line.fill.background()

        # Eyebrow + Title box
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

        # Slide Number Pill
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

    # =========================================================================
    # SLIDE 1: PORTADA EJECUTIVA
    # =========================================================================
    s1 = prs.slides.add_slide(blank_layout)
    apply_background(s1)

    # Hero card principal
    add_card(s1, Inches(0.8), Inches(0.8), Inches(11.733), Inches(5.9), C_CARD_BG, C_CARD_BORDER)

    # Borde superior decorativo del card
    hb = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(0.8), Inches(11.733), Inches(0.18))
    hb.fill.solid()
    hb.fill.fore_color.rgb = C_PRIMARY
    hb.line.fill.background()

    # Contenido de la portada
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

    # Métricas clave en pastillas (KPI Badges)
    pills = [
        ("MUESTREO TS", "50 ms (20 Hz)"),
        ("MÉTODO FIT 3", "Smith & Corripio"),
        ("AJUSTE (FIT %)", "85.77%"),
        ("POLO DOMINANTE", "-0.6362 rad/s")
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
        pp2.font.size = Pt(13)
        pp2.font.bold = True
        pp2.font.color.rgb = C_PRIMARY

    add_footer(s1, 1)

    # =========================================================================
    # SLIDE 2: ARQUITECTURA Y DIAGRAMA DE CONEXIONES
    # =========================================================================
    s2 = prs.slides.add_slide(blank_layout)
    apply_background(s2)
    add_header(s2, "Etapa 1 • Arquitectura de Hardware", "Diagrama Esquemático y Distribución de Señales")

    # Columna Izquierda: Especificaciones técnicas
    add_card(s2, Inches(0.8), Inches(1.6), Inches(4.8), Inches(5.2))
    tb2_left = s2.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(4.2), Inches(4.7))
    tf2 = tb2_left.text_frame
    tf2.word_wrap = True

    p = tf2.paragraphs[0]
    p.text = "Asignación de Pines y Potencia"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(10)

    specs = [
        ("Controlador Arduino", "Muestreo determinístico a Ts = 50 ms por ciclo no bloqueante."),
        ("Pin D9 (PWM ESC)", "Salida de pulsos para ESC (1000 a 2000 µs, 50 Hz)."),
        ("Pin D7 (TRIG) & D6 (ECHO)", "Sensor ultrasónico HC-SR04 (en la base, apuntando al carro)."),
        ("Etapa de Potencia 12V 5A", "Fuente conmutada dedicada con bus de GND compartido."),
        ("Failsafe por Firmware", "Corte inmediato si y(t) > 85 cm para evitar colisiones.")
    ]
    for title_s, desc_s in specs:
        p = tf2.add_paragraph()
        p.text = f"•  {title_s}: "
        p.font.name = FONT_BODY
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        run = p.add_run()
        run.text = desc_s
        run.font.bold = False
        run.font.color.rgb = C_MUTED
        p.space_after = Pt(6)

    # Columna Derecha: Imagen del Diagrama
    add_card(s2, Inches(5.8), Inches(1.6), Inches(6.733), Inches(5.2))
    s2.shapes.add_picture('diagrama_conexiones.jpg', Inches(6.0), Inches(1.8), width=Inches(6.333))
    
    cap_tb = s2.shapes.add_textbox(Inches(6.0), Inches(6.35), Inches(6.333), Inches(0.35))
    cap_tf = cap_tb.text_frame
    cap_p = cap_tf.paragraphs[0]
    cap_p.text = "Figura 1: Esquema de conexionado eléctrico del sistema Monóptero 1 GDL."
    cap_p.alignment = PP_ALIGN.CENTER
    cap_p.font.name = FONT_BODY
    cap_p.font.size = Pt(9.5)
    cap_p.font.italic = True
    cap_p.font.color.rgb = C_MUTED

    add_footer(s2, 2)

    # =========================================================================
    # SLIDE 3: PROTOCOLO DE ARMADO DEL ESC
    # =========================================================================
    s3 = prs.slides.add_slide(blank_layout)
    apply_background(s3)
    add_header(s3, "Seguridad y Calibración del Actuador", "Protocolo de Armado y Rango de Operación del ESC")

    # 3 Fases en Tarjetas
    fases = [
        ("FASE 1: CALIBRACIÓN INFERIOR", "1000 µs", "2.0 Segundos", 
         "El Arduino inicializa enviando pulso mínimo. El ESC sincroniza su referencia de velocidad cero (Throttle 0%) y valida señal estable."),
        ("FASE 2: CALIBRACIÓN SUPERIOR", "2000 µs", "2.0 Segundos", 
         "Salto programado al ancho de pulso máximo. El firmware del ESC registra la cota de 100% de potencia para linealizar el mapa de empuje."),
        ("FASE 3: ARMADO Y LISTO", "1000 µs", "2.0 Segundos", 
         "Retorno a reposo. El ESC emite la confirmación acústica ('beeps'). El rotor queda habilitado para maniobras seguras sin arranques intempestivos.")
    ]

    for i, (tit, val, dur, desc) in enumerate(fases):
        fx = Inches(0.8 + i * 4.0)
        fy = Inches(1.6)
        card = add_card(s3, fx, fy, Inches(3.733), Inches(3.5))

        tb = s3.shapes.add_textbox(fx + Inches(0.2), fy + Inches(0.2), Inches(3.333), Inches(3.1))
        tf = tb.text_frame
        tf.word_wrap = True

        p = tf.paragraphs[0]
        p.text = tit
        p.font.name = FONT_HEAD
        p.font.size = Pt(9.5)
        p.font.bold = True
        p.font.color.rgb = C_SECONDARY
        p.space_after = Pt(4)

        p = tf.add_paragraph()
        p.text = val
        p.font.name = FONT_HEAD
        p.font.size = Pt(20)
        p.font.bold = True
        p.font.color.rgb = C_PRIMARY

        p = tf.add_paragraph()
        p.text = f"Duración: {dur}"
        p.font.name = FONT_BODY
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = C_ACCENT_TEAL
        p.space_after = Pt(10)

        p = tf.add_paragraph()
        p.text = desc
        p.font.name = FONT_BODY
        p.font.size = Pt(10.5)
        p.font.color.rgb = C_MUTED

    # Card Inferior: Código de Arduino
    add_card(s3, Inches(0.8), Inches(5.3), Inches(11.733), Inches(1.5), C_CODE_BG)
    tb_code = s3.shapes.add_textbox(Inches(1.1), Inches(5.4), Inches(11.133), Inches(1.2))
    tfc = tb_code.text_frame
    tfc.word_wrap = True
    p = tfc.paragraphs[0]
    p.text = "// Implementación real en Arduino (setup)"
    p.font.name = "Consolas"
    p.font.size = Pt(9.5)
    p.font.color.rgb = C_MUTED
    p = tfc.add_paragraph()
    p.text = "esc.attach(PIN_ESC); esc.writeMicroseconds(1000); delay(2000);\n" \
             "esc.writeMicroseconds(2000); delay(2000);\n" \
             "esc.writeMicroseconds(1000); delay(2000); // ESC armado y listo"
    p.font.name = "Consolas"
    p.font.size = Pt(10)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY

    add_footer(s3, 3)

    # =========================================================================
    # SLIDE 4: ESTRATEGIA DE CAPTURA TS = 50 MS
    # =========================================================================
    s4 = prs.slides.add_slide(blank_layout)
    apply_background(s4)
    add_header(s4, "Adquisición de Datos y Muestreo", "Estrategia Determinística a Ts = 50 ms (20 Hz)")

    # Columna Izquierda: Teoría del muestreo y Nyquist
    add_card(s4, Inches(0.8), Inches(1.6), Inches(5.2), Inches(5.2))
    tb4 = s4.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(4.6), Inches(4.7))
    tf4 = tb4.text_frame
    tf4.word_wrap = True

    p = tf4.paragraphs[0]
    p.text = "Muestreo Libre de Jitter con millis()"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(8)

    p = tf4.add_paragraph()
    p.text = "• No-Bloqueante: A diferencia de delay(), el temporizado con millis() permite medir distancias y transmitir por serial sin retrasar el siguiente ciclo de muestreo."
    p.font.name = FONT_BODY
    p.font.size = Pt(11)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(8)

    p = tf4.add_paragraph()
    p.text = "• Teorema de Nyquist-Shannon: El monóptero posee constante de tiempo tau = 1.57 s, con frecuencia de corte fc ≈ 0.10 Hz. La tasa de muestreo fs = 20 Hz supera con holgura el límite (fs >> 2 fc), eliminando aliasing."
    p.font.name = FONT_BODY
    p.font.size = Pt(11)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(8)

    p = tf4.add_paragraph()
    p.text = "• Formato Serial CSV: tiempo_ms,pwm_us,altura_cm transmitido a 115200 baudios, compatible para importación en MATLAB y Dashboard web."
    p.font.name = FONT_BODY
    p.font.size = Pt(11)
    p.font.color.rgb = C_DARK

    # Columna Derecha: Gráfica del PWM
    add_card(s4, Inches(6.2), Inches(1.6), Inches(6.333), Inches(5.2))
    tb_pwm_t = s4.shapes.add_textbox(Inches(6.5), Inches(1.8), Inches(5.7), Inches(0.4))
    tf_pt = tb_pwm_t.text_frame
    p = tf_pt.paragraphs[0]
    p.text = "Señal de Control Aplicada (Hovering → Escalón)"
    p.font.name = FONT_HEAD
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY

    s4.shapes.add_picture('segundo grafico.png', Inches(6.4), Inches(2.35), width=Inches(5.933))

    tb_pwm_desc = s4.shapes.add_textbox(Inches(6.5), Inches(4.8), Inches(5.7), Inches(1.8))
    tf_pd = tb_pwm_desc.text_frame
    tf_pd.word_wrap = True
    p = tf_pd.paragraphs[0]
    p.text = "Fase 1 (0–5 s): Hovering estacionario en u0 = 1762 µs (dy/dt = 0).\n" \
             "Fase 2 (5–15 s): Escalón de +50 µs alcanzando u_final = 1812 µs.\n" \
             "Fase 3 (> 15 s): Parada de seguridad automática a 1000 µs."
    p.font.name = FONT_BODY
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_MUTED

    add_footer(s4, 4)

    # =========================================================================
    # SLIDE 5: FORMULACIÓN FIT 3
    # =========================================================================
    s5 = prs.slides.add_slide(blank_layout)
    apply_background(s5)
    add_header(s5, "Identificación en Lazo Abierto", "Método Fit 3 de Smith & Corripio para Modelos FOPDT")

    # Card Izquierda: Fundamento y Tiempos
    add_card(s5, Inches(0.8), Inches(1.6), Inches(5.6), Inches(5.2))
    tb5_l = s5.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(5.0), Inches(4.7))
    tf5_l = tb5_l.text_frame
    tf5_l.word_wrap = True

    p = tf5_l.paragraphs[0]
    p.text = "Estructura del Modelo FOPDT"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(6)

    p = tf5_l.add_paragraph()
    p.text = "G_p(s) = (K · e^(-t0·s)) / (tau·s + 1)"
    p.font.name = "Consolas"
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = C_SECONDARY
    p.space_after = Pt(10)

    p = tf5_l.add_paragraph()
    p.text = "Puntos de Corte de Smith & Corripio:"
    p.font.name = FONT_HEAD
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(6)

    p = tf5_l.add_paragraph()
    p.text = "• Nivel 28.3% (t1): Instante donde y(t) alcanza el 28.3% del cambio de altura. Se cumple analíticamente: t1 - t0 = tau / 3."
    p.font.name = FONT_BODY
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(6)

    p = tf5_l.add_paragraph()
    p.text = "• Nivel 63.2% (t2): Instante donde alcanza el 63.2% del escalón total. Se cumple analíticamente: t2 - t0 = tau."
    p.font.name = FONT_BODY
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_DARK
    p.space_after = Pt(10)

    p = tf5_l.add_paragraph()
    p.text = "Ventaja Metodológica de Fit 3:"
    p.font.name = FONT_HEAD
    p.font.size = Pt(11)
    p.font.bold = True
    p.font.color.rgb = C_ACCENT_TEAL
    p.space_after = Pt(3)

    p = tf5_l.add_paragraph()
    p.text = "Elimina la subjetividad del trazado tangencial de Fit 1. Los instantes t1 y t2 se interpolan con exactitud numérica en MATLAB mediante interp1()."
    p.font.name = FONT_BODY
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_MUTED

    # Card Derecha: Fórmulas y Aplicación Numérica
    add_card(s5, Inches(6.6), Inches(1.6), Inches(5.933), Inches(5.2))
    tb5_r = s5.shapes.add_textbox(Inches(6.9), Inches(1.8), Inches(5.333), Inches(4.7))
    tf5_r = tb5_r.text_frame
    tf5_r.word_wrap = True

    p = tf5_r.paragraphs[0]
    p.text = "Ecuaciones de Síntesis Directa"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(6)

    eqs = [
        ("Constante de Tiempo (tau)", "tau = 1.5 · (t2 - t1)"),
        ("Retardo Aparente (t0)", "t0 = t2 - tau"),
        ("Ganancia Estática (K)", "K = Delta_y / Delta_u = (y_inf - y0) / (u_inf - u0)")
    ]
    for tit, eq in eqs:
        p = tf5_r.add_paragraph()
        p.text = tit
        p.font.name = FONT_HEAD
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = C_SECONDARY
        p = tf5_r.add_paragraph()
        p.text = eq
        p.font.name = "Consolas"
        p.font.size = Pt(11.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        p.space_after = Pt(4)

    p = tf5_r.add_paragraph()
    p.text = "Sustitución con Datos del Monóptero:"
    p.font.name = FONT_HEAD
    p.font.size = Pt(11)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(3)

    p = tf5_r.add_paragraph()
    p.text = "• t1 (28.3%) = 0.6427 s  |  t2 (63.2%) = 1.6906 s\n" \
             "• tau = 1.5 · (1.6906 - 0.6427) = 1.5719 s\n" \
             "• t0 = 1.6906 - 1.5719 = 0.1188 s\n" \
             "• K = (34.96 - 13.45) / 50 = 0.4302 cm/µs"
    p.font.name = "Consolas"
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = C_ACCENT_TEAL

    add_footer(s5, 5)

    # =========================================================================
    # SLIDE 6: RESULTADOS Y VALIDACIÓN EXPERIMENTAL
    # =========================================================================
    s6 = prs.slides.add_slide(blank_layout)
    apply_background(s6)
    add_header(s6, "Validación Experimental", "Resultados de la Identificación vs Datos Reales")

    # Columna Izquierda: Tabla de Parámetros
    add_card(s6, Inches(0.8), Inches(1.6), Inches(5.2), Inches(5.2))
    tb6_t = s6.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(4.6), Inches(0.4))
    tf6_t = tb6_t.text_frame
    p = tf6_t.paragraphs[0]
    p.text = "Parámetros Identificados"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY

    # Tabla en PPTX
    rows, cols = 10, 3
    table_shape = s6.shapes.add_table(rows, cols, Inches(1.0), Inches(2.3), Inches(4.8), Inches(4.3))
    table = table_shape.table
    table.columns[0].width = Inches(1.1)
    table.columns[1].width = Inches(2.4)
    table.columns[2].width = Inches(1.3)

    table_data = [
        ("Parámetro", "Descripción", "Valor"),
        ("u0 / y0", "Punto hovering", "1762 µs / 13.5 cm"),
        ("u_inf / y_inf", "Régimen final", "1812 µs / 35.0 cm"),
        ("Delta u", "Escalón", "+50.0 µs"),
        ("Delta y", "Excursión", "+21.51 cm"),
        ("K", "Ganancia estática", "0.4302 cm/µs"),
        ("tau", "Constante tiempo", "1.5719 s"),
        ("t0", "Tiempo muerto", "0.1188 s"),
        ("RMSE", "Error cuadrático", "0.7540 cm"),
        ("Fit %", "Ajuste global", "85.77 %")
    ]

    for r_idx, row in enumerate(table_data):
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
            elif r_idx == 9: # Fit %
                cp.font.bold = True
                cp.font.color.rgb = C_ACCENT_TEAL
                cell.fill.solid()
                cell.fill.fore_color.rgb = C_CODE_BG
            else:
                cell.fill.solid()
                cell.fill.fore_color.rgb = C_CARD_BG if r_idx % 2 == 1 else C_CODE_BG

    # Columna Derecha: Gráfica Fit 3 vs Real
    add_card(s6, Inches(6.2), Inches(1.6), Inches(6.333), Inches(5.2))
    tb_g1_t = s6.shapes.add_textbox(Inches(6.5), Inches(1.8), Inches(5.7), Inches(0.4))
    tf_gt = tb_g1_t.text_frame
    p = tf_gt.paragraphs[0]
    p.text = "Respuesta Temporal: Experimental vs Modelo FOPDT"
    p.font.name = FONT_HEAD
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY

    s6.shapes.add_picture('Primer grafico.png', Inches(6.4), Inches(2.35), width=Inches(5.933))

    tb_g1_desc = s6.shapes.add_textbox(Inches(6.5), Inches(4.7), Inches(5.7), Inches(1.9))
    tf_gd = tb_g1_desc.text_frame
    tf_gd.word_wrap = True
    p = tf_gd.paragraphs[0]
    p.text = "• Ajuste del Modelo (Fit): 85.77% (Supera el 80% exigido por la guía de laboratorio).\n" \
             "• Error Cuadrático Medio: RMSE = 0.754 cm (< 8 mm de desviación promedio).\n" \
             "• Comportamiento Monótono: Valida que la interacción aerodinámica y de guiado es dominada por un único polo real sobreamortiguado."
    p.font.name = FONT_BODY
    p.font.size = Pt(10.5)
    p.font.color.rgb = C_DARK

    add_footer(s6, 6)

    # =========================================================================
    # SLIDE 7: POLOS Y ANÁLISIS DE ESTABILIDAD
    # =========================================================================
    s7 = prs.slides.add_slide(blank_layout)
    apply_background(s7)
    add_header(s7, "Análisis en el Dominio S", "Plano Complejo, Estabilidad y Función de Transferencia")

    # Columna Izquierda: Análisis analítico
    add_card(s7, Inches(0.8), Inches(1.6), Inches(5.8), Inches(5.2))
    tb7_l = s7.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(5.2), Inches(4.7))
    tf7_l = tb7_l.text_frame
    tf7_l.word_wrap = True

    p = tf7_l.paragraphs[0]
    p.text = "Función de Transferencia Obtenida"
    p.font.name = FONT_HEAD
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(6)

    p = tf7_l.add_paragraph()
    p.text = "G_p(s) = (0.4302 · e^(-0.1188·s)) / (1.5719·s + 1)"
    p.font.name = "Consolas"
    p.font.size = Pt(11.5)
    p.font.bold = True
    p.font.color.rgb = C_SECONDARY
    p.space_after = Pt(12)

    p = tf7_l.add_paragraph()
    p.text = "Ubicación del Polo Dominante:"
    p.font.name = FONT_HEAD
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = C_PRIMARY
    p.space_after = Pt(4)

    p = tf7_l.add_paragraph()
    p.text = "s_p = -1 / tau = -0.6362 rad/s"
    p.font.name = "Consolas"
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = C_ACCENT_TEAL
    p.space_after = Pt(12)

    diag_points = [
        ("Estabilidad Absoluta", "Polo estrictamente en el semiplano izquierdo (LHP), margen al eje imaginario |sigma| = 0.6362 s^-1."),
        ("Cero Sobreamortiguado", "Ausencia de parte imaginaria: dinámica puramente exponencial sin oscilaciones transitorias."),
        ("Índice de Controlabilidad", "t0 / tau = 0.1188 / 1.5719 = 0.0756 << 0.1. El retardo es despreciable, permitiendo controladores agresivos.")
    ]
    for t_d, b_d in diag_points:
        p = tf7_l.add_paragraph()
        p.text = f"•  {t_d}: "
        p.font.name = FONT_BODY
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = C_DARK
        run = p.add_run()
        run.text = b_d
        run.font.bold = False
        run.font.color.rgb = C_MUTED
        p.space_after = Pt(6)

    # Columna Derecha: Gráfica del Plano Complejo
    add_card(s7, Inches(6.8), Inches(1.6), Inches(5.733), Inches(5.2))
    
    # Imagen del plano complejo (reubicada ligeramente para no tapar el título interno del gráfico)
    s7.shapes.add_picture('Polos en el plano complejo.png', Inches(7.0), Inches(1.8), width=Inches(5.333))

    tb7_cap = s7.shapes.add_textbox(Inches(7.0), Inches(6.25), Inches(5.333), Inches(0.35))
    tf7_c = tb7_cap.text_frame
    p = tf7_c.paragraphs[0]
    p.text = "Figura 2: Polo real ubicado en el eje negativo (-0.6362 rad/s)."
    p.alignment = PP_ALIGN.CENTER
    p.font.name = FONT_BODY
    p.font.size = Pt(9.5)
    p.font.italic = True
    p.font.color.rgb = C_MUTED

    add_footer(s7, 7)

    # =========================================================================
    # SLIDE 8: CONCLUSIONES Y ETAPA 2
    # =========================================================================
    s8 = prs.slides.add_slide(blank_layout)
    apply_background(s8)
    add_header(s8, "Síntesis y Trabajo Futuro", "Conclusiones Técnicas y Proyección a la Etapa 2")

    conclusiones = [
        ("VALIDACIÓN DE PLANTA", "Fidelidad Dinámica 85.77%", 
         "El método Fit 3 demostró ser robusto frente a perturbaciones del sensor ultrasónico mediante filtrado previo de mediana (orden 5). El modelo FOPDT captura fielmente la aerodinámica del empuje."),
        ("CONTROLABILIDAD", "Relación t0 / tau = 0.076", 
         "Al ser t0/tau < 0.1, el sistema se clasifica como de retardo despreciable. Esto garantiza que un lazo de control PID convencional no sufrirá desestabilización por desfase de fase excesivo."),
        ("PROYECCIÓN ETAPA 2", "Diseño de Lazo Cerrado", 
         "Los parámetros K = 0.4302, tau = 1.5719 s y t0 = 0.1188 s permiten aplicar directamente métodos de sintonía analítica (Cohen-Coon, IMC o asignación de polos) para el PID digital en Arduino.")
    ]

    for i, (tag, title_c, desc_c) in enumerate(conclusiones):
        cy = Inches(1.6 + i * 1.7)
        card = add_card(s8, Inches(0.8), cy, Inches(11.733), Inches(1.5))
        
        # Icon bar on left of card
        ib = s8.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), cy, Inches(0.15), Inches(1.5))
        ib.fill.solid()
        ib.fill.fore_color.rgb = C_SECONDARY if i != 1 else C_ACCENT_TEAL
        ib.line.fill.background()

        tb = s8.shapes.add_textbox(Inches(1.2), cy + Inches(0.18), Inches(11.0), Inches(1.1))
        tf = tb.text_frame
        tf.word_wrap = True

        p = tf.paragraphs[0]
        p.text = tag
        p.font.name = FONT_HEAD
        p.font.size = Pt(9)
        p.font.bold = True
        p.font.color.rgb = C_SECONDARY if i != 1 else C_ACCENT_TEAL
        p.space_after = Pt(2)

        p = tf.add_paragraph()
        p.text = title_c
        p.font.name = FONT_HEAD
        p.font.size = Pt(14)
        p.font.bold = True
        p.font.color.rgb = C_PRIMARY
        p.space_after = Pt(4)

        p = tf.add_paragraph()
        p.text = desc_c
        p.font.name = FONT_BODY
        p.font.size = Pt(10.5)
        p.font.color.rgb = C_DARK

    add_footer(s8, 8)

    # Guardar presentación final
    output_path = "Exposicion_Monoptero_Pro.pptx"
    prs.save(output_path)
    print(f"Presentacion profesional guardada en {output_path}")
    try:
        prs.save("Exposicion_Monoptero.pptx")
        print("Tambien se actualizo Exposicion_Monoptero.pptx")
    except Exception as e:
        print(f"Nota: Exposicion_Monoptero.pptx esta abierta en PowerPoint ({e}). Usar Exposicion_Monoptero_Pro.pptx")

if __name__ == "__main__":
    build_presentation()
