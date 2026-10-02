% IDENTIFICACIONFIT3  Identifica el modelo FOPDT del monocóptero con el método Fit 3.
%
%   Universidad del Magdalena · Control Análogo · Etapa 1 / Hito 2
%   Docente: Ing. Jordan Dallan Guillot Fula, PhD (c)
%
%   QUÉ HACE
%     Lee el ensayo de escalón del banco (Tower Copter de 1 GDL), filtra la
%     altura medida por el HC-SR04, calcula los parámetros del modelo de primer
%     orden con tiempo muerto (FOPDT)
%
%                 ΔY(s)      K · e^(-t0·s)
%         Gp(s) = ----- = -----------------      [cm/µs]
%                 ΔU(s)       tau·s + 1
%
%     con el método de dos puntos Fit 3 de Smith & Corripio, valida el modelo
%     contra los datos (Fit %, RMSE, residuos) y guarda figuras y resultados.
%
%   CÓMO SE USA
%     1. Abrir este archivo en MATLAB (no importa la carpeta actual).
%     2. Pulsar Run (F5). El script busca los datos en ../02_datos/.
%     3. Leer el reporte en la Command Window y las figuras en ./figuras/.
%
%   ENTRADAS
%     ../02_datos/datos_escalon_20260913_193329.csv  (o el .xlsx original)
%       tiempo_ms  instante de la muestra [ms]  (Ts = 50 ms)
%       pwm_us     ancho de pulso enviado al ESC [µs]  (1762 → 1812 µs)
%       altura_cm  altura del carro medida por el HC-SR04 [cm]
%     Las columnas se reconocen por su nombre, así que el script también acepta
%     el .xlsx original (columnas #, Timestamp, Tiempo, PWM, Altura).
%
%   SALIDAS
%     Command Window          tabla con u0, y0, K, tau, t0, polo, Fit y RMSE.
%     resultados_fit3.mat     variables del modelo; las usa Polosmonocopter.m.
%     figuras/fit3_respuesta.png  ensayo completo, modelo y puntos 28.3 / 63.2 %.
%     figuras/fit3_residuos.png   residuos en el tiempo y su histograma.
%
%   MÉTODO FIT 3 (deducción)
%     La respuesta normalizada de un FOPDT a un escalón es
%         F(t) = (y(t) - y0) / Δy = 1 - exp(-(t - t0)/tau),   t >= t0.
%     Despejando el tiempo en que F alcanza un nivel p:
%         t - t0 = -tau · ln(1 - p)
%         p = 0.283  →  t1 - t0 = 0.3327·tau ≈ tau/3
%         p = 0.632  →  t2 - t0 = 1.0000·tau
%     Restando ambas ecuaciones: t2 - t1 = (2/3)·tau, por lo tanto
%         tau = 1.5·(t2 - t1)      t0 = t2 - tau      K = Δy / Δu
%
%   REQUISITOS
%     MATLAB R2019b o superior (readtable con 'VariableNamingRule').
%     Signal Processing Toolbox: medfilt1.
%     Control System Toolbox (opcional): tf y lsim para la verificación cruzada.
%
%   VARIABLES PRINCIPALES
%     t_raw, u_raw, y_raw   datos crudos del archivo [s, µs, cm]
%     y_filt                altura filtrada con mediana de orden 5 [cm]
%     idx_step              índice de la primera muestra después del escalón
%     t, u, y               datos desde el escalón, con t = 0 en el escalón
%     u0, y0                punto de operación (promedio antes del escalón)
%     u_inf, y_inf          régimen permanente (promedio del último 15 %)
%     K, tau, t0            parámetros del modelo FOPDT [cm/µs, s, s]
%     y_mod                 respuesta del modelo en los instantes medidos [cm]
%     res                   residuos y - y_mod [cm]
%     fit_pct, rmse         métricas de ajuste [%, cm]
%
%   HISTORIAL
%     Versión anterior: leía la columna 1 del Excel (el índice "#") como tiempo
%     y el texto "Timestamp" como PWM, y el .csv era un Excel renombrado. Ahora
%     las columnas se identifican por nombre/rango físico y los datos se leen
%     de 02_datos/.
%
%   Ver también POLOSMONOCOPTER, COMPARACIONENSAYOS, VALIDACIONSIMULINK.

clear; clc; close all;

%% 1. UBICACIÓN DE LOS DATOS (independiente de la carpeta actual de MATLAB)
% mfilename('fullpath') devuelve la ruta de este archivo, así el script
% encuentra ../02_datos aunque MATLAB esté parado en otra carpeta. Si se
% ejecuta por secciones (Ctrl+Enter) mfilename viene vacío y se usa pwd.
carpeta_script = fileparts(mfilename('fullpath'));
if isempty(carpeta_script), carpeta_script = pwd; end
carpeta_datos  = fullfile(carpeta_script, '..', '02_datos');
carpeta_figs   = fullfile(carpeta_script, 'figuras');
if ~isfolder(carpeta_figs), mkdir(carpeta_figs); end

% Se prefiere el .csv; si no existe se usa el Excel original del ensayo.
archivo = fullfile(carpeta_datos, 'datos_escalon_20260913_193329.csv');
if ~isfile(archivo)
    archivo = fullfile(carpeta_datos, 'datos_escalon_20260913_193329.xlsx');
end
if ~isfile(archivo)
    error('No se encontraron los datos del escalón en %s', carpeta_datos);
end

%% 2. CARGA Y ASIGNACIÓN DE COLUMNAS (tiempo, PWM, altura)
% Se busca cada columna por su nombre y se exige que sea numérica. Así una
% columna de texto como "Timestamp" nunca se confunde con el PWM.
T = readtable(archivo, 'VariableNamingRule', 'preserve');
nombres = lower(string(T.Properties.VariableNames));
es_num  = varfun(@isnumeric, T, 'OutputFormat', 'uniform');

col_t = find(es_num & (contains(nombres, "tiempo") | contains(nombres, "ms") | contains(nombres, "time") | nombres == "t_s"), 1);
col_u = find(es_num & (contains(nombres, "pwm") | contains(nombres, "us")), 1);
col_y = find(es_num & (contains(nombres, "altura") | contains(nombres, "cm") | contains(nombres, "dist")), 1);
if isempty(col_t) || isempty(col_u) || isempty(col_y)
    error('No se identificaron las columnas tiempo/PWM/altura en %s', archivo);
end

t_raw = T{:, col_t};
u_raw = T{:, col_u};
y_raw = T{:, col_y};
% Se descartan filas incompletas (NaN en cualquiera de las tres columnas).
ok = ~(isnan(t_raw) | isnan(u_raw) | isnan(y_raw));
t_raw = t_raw(ok);  u_raw = u_raw(ok);  y_raw = y_raw(ok);
% Un ensayo dura ~15 s: si el tiempo pasa de 120 está en milisegundos.
if max(t_raw) > 120, t_raw = t_raw / 1000; end   % ms → s
% Periodo de muestreo real: la mediana ignora el jitter del puerto serial.
Ts = median(diff(t_raw));

%% 3. PREPROCESAMIENTO: filtro de mediana (orden 5) contra el ruido del HC-SR04
% La mediana elimina los rebotes espurios del ultrasonido sin desplazar la fase
% (a diferencia de un promedio móvil), así no se altera el tiempo muerto t0.
% Se usa el relleno por defecto de medfilt1 (ceros en los bordes), que es con el
% que se reportaron los resultados del Hito 1. Con 'truncate' K, tau y t0 cambian
% menos de 0.2 % (K = 0.4308, tau = 1.5739 s, t0 = 0.1185 s, Fit = 85.87 %).
y_filt = medfilt1(y_raw, 5);

%% 4. REBASE TEMPORAL: t = 0 en el instante del escalón
% El escalón se detecta en la señal de entrada: es la primera muestra donde el
% PWM salta más del 40 % de su rango total. No depende de un instante fijo, así
% que funciona aunque el ensayo empiece antes o después.
umbral = 0.4 * (max(u_raw) - min(u_raw));
idx_step = find(abs(diff(u_raw)) >= umbral, 1, 'first') + 1;
if isempty(idx_step), error('No se detectó un escalón en la señal PWM.'); end

% Desde aquí t es relativo al escalón. Usar el tiempo absoluto de millis()
% desplazaría t1 y t2 en ~5 s y arruinaría tau y t0.
t = t_raw(idx_step:end) - t_raw(idx_step);
u = u_raw(idx_step:end);
y = y_filt(idx_step:end);

%% 5. PUNTOS DE OPERACIÓN Y GANANCIA ESTÁTICA
% (u0, y0): promedio de los 5 s de hovering previos al escalón.
% (u_inf, y_inf): promedio del último 15 % del registro (régimen permanente).
% Promediar varias muestras atenúa el ruido del sensor en Δy.
u0 = mean(u_raw(1:idx_step-1));           % hovering previo (5 s)
y0 = mean(y_filt(1:idx_step-1));
L  = numel(y);
N_fin = max(5, round(0.15 * L));          % último 15 % = régimen permanente
u_inf = mean(u(L-N_fin+1:L));
y_inf = mean(y(L-N_fin+1:L));
delta_u = u_inf - u0;                     % amplitud del escalón [µs]
delta_y = y_inf - y0;                     % cambio de altura [cm]
K = delta_y / delta_u;                    % ganancia estática [cm/µs]

%% 6. MÉTODO FIT 3 — instantes del 28.3 % y 63.2 % (primer cruce, interpolado)
% Niveles de referencia en cm. Se toma el PRIMER cruce de cada nivel y se
% interpola linealmente entre la muestra anterior y la actual, así t1 y t2
% tienen resolución menor que Ts = 50 ms.
y_28 = y0 + 0.283 * delta_y;
y_63 = y0 + 0.632 * delta_y;
i1 = find(y >= y_28, 1, 'first');
i2 = find(y >= y_63, 1, 'first');
t1 = interp1(y(i1-1:i1), t(i1-1:i1), y_28);
t2 = interp1(y(i2-1:i2), t(i2-1:i2), y_63);
tau = 1.5 * (t2 - t1);                    % constante de tiempo [s]
t0  = max(0, t2 - tau);                   % tiempo muerto [s]; no puede ser negativo
polo = -1 / tau;                          % polo del modelo [rad/s]

%% 7. RESPUESTA DEL MODELO (solución analítica del FOPDT ante el escalón)
%   y_mod(t) = y0 + Δy·(1 - e^(-(t - t0)/tau))   para t >= t0
%   y_mod(t) = y0                               para t <  t0
% El factor (t >= t0) vale 0 o 1 y hace el papel del escalón unitario retardado.
y_mod = y0 + delta_y * (1 - exp(-(t - t0) / tau)) .* (t >= t0);

% Verificación cruzada con el Control System Toolbox (si está instalado)
if license('test', 'Control_Toolbox')
    % lsim exige paso constante; las muestras reales tienen jitter (50-52 ms),
    % así que se simula en una malla uniforme y se interpola a los instantes medidos.
    Gp = tf(K, [tau 1], 'InputDelay', t0);
    t_u = (0:Ts/10:t(end))';
    y_lsim = y0 + interp1(t_u, lsim(Gp, delta_u * ones(size(t_u)), t_u), t);
    fprintf('Diferencia máx. analítico vs lsim: %.2e cm\n', max(abs(y_lsim - y_mod)));
end

%% 8. MÉTRICAS DE BONDAD DE AJUSTE Y RESIDUOS
% Fit (NRMSE, el mismo índice que usa compare de MATLAB):
%   Fit = (1 - ||y - y_mod|| / ||y - mean(y)||) · 100 %
% 100 % es ajuste perfecto; 0 % equivale a predecir siempre el promedio.
% La guía del curso exige Fit >= 80 %.
res      = y - y_mod;                     % residuos [cm]
rmse     = sqrt(mean(res.^2));            % error cuadrático medio [cm]
fit_pct  = (1 - norm(res) / norm(y - mean(y))) * 100;   % NRMSE (igual que compare)
err_max  = max(abs(res));                 % peor error puntual [cm]
res_med  = mean(res);                     % sesgo: cercano a 0 si no hay error sistemático
% Ajuste contra la señal sin filtrar (cuánto del error es ruido del sensor)
y_crudo  = y_raw(idx_step:end);
fit_crudo = (1 - norm(y_crudo - y_mod) / norm(y_crudo - mean(y_crudo))) * 100;

%% 9. REPORTE
fprintf('\n==================================================\n');
fprintf('     IDENTIFICACIÓN FOPDT — FIT 3 (SMITH & CORRIPIO)\n');
fprintf('==================================================\n');
fprintf('Archivo                   : %s\n', archivo);
fprintf('Muestras / Ts             : %d / %.0f ms\n', numel(t_raw), Ts * 1000);
fprintf('Hovering (u0, y0)         : %.2f us | %.2f cm\n', u0, y0);
fprintf('Régimen final (u_inf, y_inf): %.2f us | %.2f cm\n', u_inf, y_inf);
fprintf('Delta u / Delta y         : %.2f us | %.2f cm\n', delta_u, delta_y);
fprintf('t1 (28.3%%) / t2 (63.2%%)   : %.4f s | %.4f s\n', t1, t2);
fprintf('--------------------------------------------------\n');
fprintf('Ganancia estática K       : %.4f cm/us\n', K);
fprintf('Constante de tiempo tau   : %.4f s\n', tau);
fprintf('Tiempo muerto t0          : %.4f s\n', t0);
fprintf('Polo dominante s = -1/tau : %.4f rad/s\n', polo);
fprintf('--------------------------------------------------\n');
fprintf('RMSE                      : %.4f cm\n', rmse);
fprintf('Error máximo |e|          : %.4f cm\n', err_max);
fprintf('Residuo medio             : %.4f cm\n', res_med);
fprintf('Fit (señal filtrada)      : %.2f %%\n', fit_pct);
fprintf('Fit (señal cruda)         : %.2f %%\n', fit_crudo);
if fit_pct >= 80
    fprintf('Criterio de la guía (Fit >= 80%%): APROBADO\n');
else
    fprintf('Criterio de la guía (Fit >= 80%%): NO ALCANZADO\n');
end
fprintf('==================================================\n');
fprintf('Gp(s) = %.4f e^(-%.4f s) / (%.4f s + 1)\n\n', K, t0, tau);

% Estas variables las reutilizan Polosmonocopter.m y ValidacionSimulink.m.
save(fullfile(carpeta_script, 'resultados_fit3.mat'), ...
    'K', 'tau', 't0', 'u0', 'y0', 'u_inf', 'y_inf', 'delta_u', 'delta_y', ...
    't1', 't2', 'rmse', 'fit_pct', 'fit_crudo', 'err_max', 'Ts');

%% 10. FIGURA 1 — Ensayo completo y modelo (formato informe IEEE)
% Se grafica todo el ensayo con t = 0 en el escalón: el hovering previo (t < 0)
% muestra el punto de operación (u0, y0) y su deriva antes del escalón.
t_all = t_raw - t_raw(idx_step);
y_mod_all = y0 + delta_y * (1 - exp(-(t_all - t0) / tau)) .* (t_all >= t0);
f1 = figure('Color', 'w', 'Position', [100 100 900 620]);
tema_claro(f1);
% Arriba: altura cruda (puntos grises), filtrada (azul), modelo (rojo) y los
% dos puntos que usa Fit 3 (círculos verdes).
subplot(2,1,1);
plot(t_all, y_raw, '.', 'Color', [0.6 0.6 0.6], 'MarkerSize', 7); hold on;
plot(t_all, y_filt, 'b-', 'LineWidth', 1.6);
plot(t_all, y_mod_all, 'r--', 'LineWidth', 2);
yline(y_28, 'k:', '28.3 %', 'LabelHorizontalAlignment', 'left');
yline(y_63, 'm:', '63.2 %', 'LabelHorizontalAlignment', 'left');
plot([t1 t2], [y_28 y_63], 'ko', 'MarkerFaceColor', 'g', 'MarkerSize', 7);
xline(0, 'k-', 'escalón', 'LabelVerticalAlignment', 'bottom');
grid on; ylabel('Altura y(t) [cm]'); xlim([t_all(1) t_all(end)]);
title(sprintf('Fit 3: K = %.4f cm/\\mus, \\tau = %.4f s, t_0 = %.4f s  (Fit = %.2f %%)', ...
    K, tau, t0, fit_pct));
legend('HC-SR04 crudo', 'Filtrada (mediana 5)', 'Modelo FOPDT', 'Location', 'southeast');
% Abajo: la entrada u(t). stairs la dibuja como retención de orden cero, que es
% lo que realmente recibe el ESC entre muestras.
subplot(2,1,2);
stairs(t_all, u_raw, 'k-', 'LineWidth', 1.5); grid on;
ylim([min(u_raw)-20, max(u_raw)+20]); xlim([t_all(1) t_all(end)]);
xlabel('Tiempo relativo al escalón t [s]'); ylabel('PWM u(t) [\mus]');
title(sprintf('Señal aplicada al ESC: %.0f \\rightarrow %.0f \\mus', u0, u_inf));
exportgraphics(f1, fullfile(carpeta_figs, 'fit3_respuesta.png'), 'Resolution', 200);

%% 11. FIGURA 2 — Análisis de residuos
% Si el modelo fuera perfecto, los residuos serían ruido blanco: centrados en
% cero, sin forma en el tiempo y con histograma simétrico. Las bandas ±2σ marcan
% dónde debería caer ~95 % de los residuos.
f2 = figure('Color', 'w', 'Position', [120 120 900 420]);
tema_claro(f2);
subplot(1,2,1);
plot(t, res, 'b-'); hold on; yline(0, 'k-');
yline([-2 2] * std(res), 'r:');
grid on; xlabel('t [s]'); ylabel('e(t) = y - y_{mod} [cm]');
title(sprintf('Residuos (RMSE = %.3f cm, |e|_{max} = %.2f cm)', rmse, err_max));
subplot(1,2,2);
histogram(res, 20, 'FaceColor', [0.3 0.5 0.8]);
grid on; xlabel('e [cm]'); ylabel('Frecuencia');
title(sprintf('Distribución (media = %.3f cm)', res_med));
exportgraphics(f2, fullfile(carpeta_figs, 'fit3_residuos.png'), 'Resolution', 200);

fprintf('Figuras guardadas en %s\n', carpeta_figs);

%% Funciones locales
function tema_claro(fig)
% TEMA_CLARO  Fuerza fondo blanco en la figura FIG.
% MATLAB R2025a+ usa el tema del escritorio (puede ser oscuro); para el
% informe se fuerza el tema claro. En versiones anteriores no hace nada.
try
    theme(fig, 'light');
catch
end
end
