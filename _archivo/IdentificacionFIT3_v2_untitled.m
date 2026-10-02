%% =========================================================================
%% ETAPA 1: IDENTIFICACIÓN FOPDT - MÉTODO FIT 3 (SMITH & CORRIPIO)
%% PROYECTO: CONTROL DE MONOCÓPTERO (TOWER COPTER)
%% =========================================================================
clear; clc; close all;

%% 1. PARÁMETROS DEL ARCHIVO
archivo = 'datos_serial_20260913_193329.xlsx';
% Si usas archivo CSV en lugar de Excel:
% archivo = 'datos_escalon.csv';

if ~isfile(archivo)
    error('El archivo "%s" no existe en la carpeta actual de MATLAB.', archivo);
end

%% 2. CARGA INTELIGENTE Y FILTRADO DE COLUMNAS NO NUMÉRICAS
if endsWith(archivo, '.xlsx') || endsWith(archivo, '.xls')
    T = readtable(archivo, 'VariableNamingRule', 'preserve');
    % Descartar columnas de texto/fecha (ej. Timestamp)
    es_numerica = varfun(@isnumeric, T, 'OutputFormat', 'uniform');
    if ~any(es_numerica)
        error('No se detectaron columnas con datos numéricos en el archivo.');
    end
    nombres = T.Properties.VariableNames(es_numerica);
    datos   = table2array(T(:, es_numerica));
else
    datos   = readmatrix(archivo);
    nombres = cellstr(strcat('Col_', num2str((1:size(datos,2))')));
end

% Eliminar filas que contengan NaN
datos = datos(~any(isnan(datos), 2), :);
num_cols = size(datos, 2);

%% 3. ASIGNACIÓN ROBUSTA DE VARIABLES (TIEMPO, PWM, ALTURA)
idx_t = 0; idx_u = 0; idx_y = 0;

% Criterio A: Detección por nombres de encabezado
for c = 1:num_cols
    col_nombre = lower(nombres{c});
    if contains(col_nombre, {'time', 'tiemp', 'ms', 'seg'}) && idx_t == 0
        idx_t = c;
    elseif contains(col_nombre, {'pwm', 'esc', 'pulso', 'u'}) && idx_u == 0
        idx_u = c;
    elseif contains(col_nombre, {'altur', 'dist', 'height', 'y', 'sensor'}) && idx_y == 0
        idx_y = c;
    end
end

% Criterio B: Detección estricta por rangos físicos reales
for c = 1:num_cols
    col_data = datos(:, c);
    min_v = min(col_data);
    max_v = max(col_data);

    % PWM de ESC: Únicamente oscila en pulsos entre 900 y 2100 us
    if idx_u == 0 && min_v >= 900 && max_v <= 2200
        idx_u = c;
    % Altura: Medida física en torre (0 a 100 cm con movimiento real)
    elseif idx_y == 0 && min_v >= 0 && max_v <= 110 && (max_v - min_v > 3)
        idx_y = c;
    end
end

% El tiempo es la columna monótonamente creciente restante
if idx_t == 0
    for c = 1:num_cols
        if c ~= idx_u && c ~= idx_y
            idx_t = c;
            break;
        end
    end
end

% Asignación final de respaldo si no coincidió
if idx_t == 0, idx_t = 1; end
if idx_u == 0, idx_u = 2; end
if idx_y == 0, idx_y = 3; end

t_raw = datos(:, idx_t);
u_raw = datos(:, idx_u);
y_raw = datos(:, idx_y);

% Si el tiempo está en ms (ej. 5000 ms), convertir a segundos
if max(t_raw) > 120
    t_raw = t_raw / 1000;
end

%% 4. PREPROCESAMIENTO Y REBASE TEMPORAL
% Filtro de mediana orden 5 para atenuar ruido ultrasónico
y_filt = medfilt1(y_raw, 5);

% Detección del escalón en la señal de control u(t)
diff_u = abs(diff(u_raw));
umbral_salto = (max(u_raw) - min(u_raw)) * 0.4;

if umbral_salto > 5 && any(diff_u >= umbral_salto)
    idx_step = find(diff_u >= umbral_salto, 1, 'first') + 1;
else
    % Respaldo: ubicar a los 5.0 s (hovering inicial programado)
    [~, idx_step] = min(abs(t_raw - (t_raw(1) + 5.0)));
end

% Ajuste de seguridad para el índice
idx_step = max(5, min(idx_step, length(t_raw) - 10));

% Definición estricta de tiempo relativo: t = 0 en el instante del escalón
t = t_raw(idx_step:end) - t_raw(idx_step);
u = u_raw(idx_step:end);
y = y_filt(idx_step:end);

%% 5. REGÍMENES ESTACIONARIOS Y GANANCIA ESTÁTICA
% Estado de Hovering previo al escalón
u_0 = mean(u_raw(1:idx_step-1));
y_0 = mean(y_filt(1:idx_step-1));

% Estado estacionario final (promedio del 15% de muestras finales)
L = length(y);
N_fin = max(5, round(0.15 * L));
u_inf = mean(u(L - N_fin + 1 : L));
y_inf = mean(y(L - N_fin + 1 : L));

delta_u = u_inf - u_0;
delta_y = y_inf - y_0;

% Ganancia estática K
K = delta_y / delta_u;

%% 6. IDENTIFICACIÓN FIT 3 (SMITH & CORRIPIO)
y_28 = y_0 + 0.283 * delta_y;
y_63 = y_0 + 0.632 * delta_y;

idx_1 = find(y >= y_28, 1, 'first');
idx_2 = find(y >= y_63, 1, 'first');

if isempty(idx_1) || idx_1 < 2, idx_1 = 2; end
if isempty(idx_2) || idx_2 <= idx_1, idx_2 = min(L, idx_1 + 2); end

% Interpolación lineal para obtener tiempos t1 y t2 continuos
t_1 = interp1(y(idx_1-1:idx_1), t(idx_1-1:idx_1), y_28, 'linear', 'extrap');
t_2 = interp1(y(idx_2-1:idx_2), t(idx_2-1:idx_2), y_63, 'linear', 'extrap');

% Constante de tiempo y retardo aparente
tau = 1.5 * (t_2 - t_1);
if tau <= 0, tau = 0.5; end
t0  = max(0, t_2 - tau);

%% 7. SOLUCIÓN ANALÍTICA FOPDT Y SIMULACIÓN EXACTA
% y_model(t) = y0 + K * Delta_u * (1 - exp(-(t - t0)/tau))  para t >= t0
y_sim = zeros(size(t));
for i = 1:length(t)
    if t(i) < t0
        y_sim(i) = y_0;
    else
        y_sim(i) = y_0 + delta_y * (1 - exp(-(t(i) - t0) / tau));
    end
end

%% 8. VALIDACIÓN DE CALIDAD DEL MODELO
rmse = sqrt(mean((y - y_sim).^2));
fit_pct = (1 - (norm(y - y_sim) / norm(y - mean(y)))) * 100;

%% 9. DESPLIEGUE DE RESULTADOS EN CONSOLA
fprintf('\n==================================================\n');
fprintf('        REPORTE DE IDENTIFICACIÓN FOPDT (FIT 3)   \n');
fprintf('==================================================\n');
fprintf('Hovering inicial (u0, y0) :  %.2f us | %.2f cm\n', u_0, y_0);
fprintf('Estado final     (u_inf, y_inf): %.2f us | %.2f cm\n', u_inf, y_inf);
fprintf('Salto de entrada (Delta U):  %.2f us\n', delta_u);
fprintf('Salto de salida  (Delta Y):  %.2f cm\n', delta_y);
fprintf('--------------------------------------------------\n');
fprintf('Ganancia estática (K)     :  %.4f cm/us\n', K);
fprintf('Constante de tiempo (tau) :  %.4f s\n', tau);
fprintf('Tiempo muerto aparente(t0):  %.4f s\n', t0);
fprintf('--------------------------------------------------\n');
fprintf('Error RMSE                :  %.4f cm\n', rmse);
fprintf('Porcentaje de Ajuste Fit %%:  %.2f %%\n', fit_pct);
if fit_pct >= 80
    fprintf('Criterio Guía (Fit >= 80%%):  APROBADO [OK]\n');
else
    fprintf('Criterio Guía (Fit >= 80%%):  NO ALCANZADO (Fit < 80%%)\n');
end
fprintf('==================================================\n\n');

%% 10. GRÁFICA COMPARATIVA (FORMATO PARA INFORME IEEE)
figure('Color', 'w', 'Position', [150, 100, 850, 600]);

subplot(2,1,1);
plot(t, y, 'b-', 'LineWidth', 1.6); hold on;
plot(t, y_sim, 'r--', 'LineWidth', 2.0);
yline(y_0, 'k:', 'LineWidth', 1.1);
yline(y_inf, 'k:', 'LineWidth', 1.1);
plot([t_1, t_2], [y_28, y_63], 'ko', 'MarkerFaceColor', 'g', 'MarkerSize', 6);
grid on;
title(sprintf('Identificación FOPDT - Smith & Corripio (Fit = %.2f %%, RMSE = %.2f cm)', fit_pct, rmse), 'FontSize', 11);
ylabel('Altura y(t) [cm]', 'FontSize', 10);
legend('Curva Experimental (Filtrada)', 'Modelo FOPDT Fit 3', 'Régimen Permanente', '', 'Puntos Fit 3 (28.3% y 63.2%)', 'Location', 'southeast');

subplot(2,1,2);
plot(t, u, 'k-', 'LineWidth', 1.5);
grid on;
title('Señal de Excitación Aplicada al ESC', 'FontSize', 11);
xlabel('Tiempo relativo t [s]', 'FontSize', 10);
ylabel('PWM u(t) [\mus]', 'FontSize', 10);
ylim([min(u)-20, max(u)+20]);