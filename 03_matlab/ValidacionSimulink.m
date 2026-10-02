% VALIDACIONSIMULINK  Simula simulinkdelsistema.slx y lo compara con el ensayo real.
%
%   Universidad del Magdalena · Control Análogo · Etapa 1 / Hito 2
%
%   QUÉ HACE
%     1. Lee los parámetros de los bloques del modelo de Simulink y los compara
%        con los que calculó IdentificacionFIT3.m.
%     2. Simula el modelo (Step → Transfer Fcn → Transport Delay → + y0 → Scope).
%     3. Superpone la salida de Simulink sobre la altura medida el 13/09 y
%        calcula el Fit con la misma fórmula del informe.
%     4. Exporta una imagen del diagrama de bloques.
%
%   DIAGRAMA DEL MODELO
%     Step (t = 1 s, 0 → 50 µs) → Transfer Fcn 0.4302/(1.5719 s + 1)
%       → Transport Delay 0.1188 s → Sum (+ Constant 13.45 cm) → Scope
%
%   CÓMO SE USA
%     Ejecutar IdentificacionFIT3.m primero (crea resultados_fit3.mat) y luego
%     este script. El .slx no se modifica: el registro del Scope se activa solo
%     en memoria y el modelo se cierra sin guardar.
%
%   SALIDAS
%     Command Window                       parámetros de bloques y Fit.
%     figuras/simulink_vs_experimental.png  salida de Simulink sobre los datos.
%     figuras/simulink_diagrama.png         captura del diagrama de bloques.
%
%   REQUISITOS
%     Simulink, Signal Processing Toolbox (medfilt1).
%
%   Ver también IDENTIFICACIONFIT3, POLOSMONOCOPTER.

clear; clc; close all;

carpeta_script = fileparts(mfilename('fullpath'));
if isempty(carpeta_script), carpeta_script = pwd; end
carpeta_datos = fullfile(carpeta_script, '..', '02_datos');
carpeta_figs  = fullfile(carpeta_script, 'figuras');
if ~isfolder(carpeta_figs), mkdir(carpeta_figs); end

modelo = 'simulinkdelsistema';
load_system(fullfile(carpeta_script, [modelo '.slx']));

%% 1. PARÁMETROS DE LOS BLOQUES VS. RESULTADOS DE FIT 3
num   = str2num(get_param([modelo '/Transfer Fcn'], 'Numerator'));    %#ok<ST2NM>
den   = str2num(get_param([modelo '/Transfer Fcn'], 'Denominator'));  %#ok<ST2NM>
td    = str2double(get_param([modelo '/Transport Delay'], 'DelayTime'));
y0_b  = str2double(get_param([modelo '/Constant'], 'Value'));
t_esc = str2double(get_param([modelo '/Step'], 'Time'));
du_b  = str2double(get_param([modelo '/Step'], 'FinalValue'));

archivo_res = fullfile(carpeta_script, 'resultados_fit3.mat');
if isfile(archivo_res)
    load(archivo_res, 'K', 'tau', 't0', 'y0', 'delta_u');
else
    K = 0.4302; tau = 1.5719; t0 = 0.1188; y0 = 13.45; delta_u = 50;
end

fprintf('\n=== BLOQUES DE %s vs. FIT 3 ===\n', modelo);
fprintf('K   (numerador)        : %8.4f   | Fit 3: %8.4f cm/us\n', num(1), K);
fprintf('tau (denominador)      : %8.4f   | Fit 3: %8.4f s\n', den(1), tau);
fprintf('t0  (Transport Delay)  : %8.4f   | Fit 3: %8.4f s\n', td, t0);
fprintf('y0  (Constant)         : %8.2f   | Fit 3: %8.2f cm\n', y0_b, y0);
fprintf('Δu  (Step final)       : %8.2f   | ensayo: %7.2f us\n', du_b, delta_u);
fprintf('El escalón de Simulink ocurre en t = %.1f s (en el ensayo, t = 0).\n', t_esc);

%% 2. SIMULACIÓN
% El Scope no guarda datos por defecto; se activa su registro solo para esta
% corrida. MaxStep = 10 ms deja la curva bien muestreada con el solver variable.
% Al terminar se cierra el modelo SIN guardar, también si la simulación falla.
scope = [modelo '/Scope'];
try
    set_param(scope, 'DataLogging', 'on', 'DataLoggingVariableName', 'y_scope', ...
        'DataLoggingSaveFormat', 'Dataset');
    salida = sim(modelo, 'StopTime', '15', 'MaxStep', '0.01');
catch ME
    close_system(modelo, 0);
    rethrow(ME);
end
serie = salida.get('y_scope').getElement(1).Values;   % timeseries del Scope
t_sim = serie.Time - t_esc;              % t = 0 en el escalón, como en el ensayo
y_sim = squeeze(serie.Data);

%% 3. COMPARACIÓN CON EL ENSAYO DEL 13/09
T = readtable(fullfile(carpeta_datos, 'datos_escalon_20260913_193329.csv'));
t_raw = T.tiempo_ms / 1000;
u_raw = T.pwm_us;
y_raw = T.altura_cm;
y_filt = medfilt1(y_raw, 5);
umbral = 0.4 * (max(u_raw) - min(u_raw));
idx = find(abs(diff(u_raw)) >= umbral, 1, 'first') + 1;
t_exp = t_raw - t_raw(idx);

% Salida de Simulink evaluada en los instantes medidos después del escalón
[t_unico, iu] = unique(t_sim);           % Simulink repite instantes en los escalones
despues = t_exp >= 0 & t_exp <= t_unico(end);
y_sim_exp = interp1(t_unico, y_sim(iu), t_exp(despues));
y_med = y_filt(despues);
e = y_med - y_sim_exp;
fit_sim = (1 - norm(e) / norm(y_med - mean(y_med))) * 100;
fprintf('Fit Simulink vs. señal filtrada: %.2f %%   RMSE = %.3f cm\n', fit_sim, sqrt(mean(e.^2)));

f1 = figure('Color', 'w', 'Position', [100 100 900 460]);
tema_claro(f1);
plot(t_exp, y_raw, '.', 'Color', [0.65 0.65 0.65], 'MarkerSize', 7); hold on;
plot(t_exp, y_filt, 'b-', 'LineWidth', 1.4);
plot(t_sim, y_sim, 'r-', 'LineWidth', 2);
xline(0, 'k:', 'escalón');
grid on; xlim([-5 10]);
xlabel('Tiempo relativo al escalón t [s]'); ylabel('Altura [cm]');
title(sprintf('Simulink (%s.slx) vs. ensayo del 13/09: Fit = %.2f %%', modelo, fit_sim), ...
    'Interpreter', 'none');
legend('HC-SR04 crudo', 'Filtrada (mediana 5)', 'Salida del Scope', 'Location', 'southeast');
exportgraphics(f1, fullfile(carpeta_figs, 'simulink_vs_experimental.png'), 'Resolution', 200);

%% 4. IMAGEN DEL DIAGRAMA DE BLOQUES
try
    print(['-s' modelo], '-dpng', '-r200', fullfile(carpeta_figs, 'simulink_diagrama.png'));
    fprintf('Diagrama exportado.\n');
catch ME
    warning('No se pudo exportar el diagrama: %s', ME.message);
end
close_system(modelo, 0);                 % descarta el registro activado arriba

fprintf('Figuras guardadas en %s\n', carpeta_figs);

%% Funciones locales
function tema_claro(fig)
% TEMA_CLARO  Fuerza el tema claro en MATLAB R2025a+ (en versiones anteriores no hace nada).
try
    theme(fig, 'light');
catch
end
end
