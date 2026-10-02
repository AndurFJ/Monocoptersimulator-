% COMPARACIONENSAYOS  Aplica Fit 3 a todos los ensayos de escalón y los compara.
%
%   Universidad del Magdalena · Control Análogo · Etapa 1 / Hito 2
%
%   QUÉ HACE
%     Repite la identificación Fit 3 de IdentificacionFIT3.m sobre cada ensayo
%     de escalón guardado en ../02_datos/ y los pone lado a lado:
%       - 13/09/2026 con Arduino Uno (el ensayo del informe).
%       - 01/10/2026 con ESP32, antes y después de corregir el PWM.
%
%     Los ensayos de las 17:06 y 17:29 del 01/10 se hicieron con la librería
%     ESP32Servo usando su timer por defecto de 10 bits. A 50 Hz el periodo es
%     20000 µs y 2^10 = 1024 pasos, así que el pulso solo puede tomar múltiplos
%     de 20000/1024 = 19.53 µs y la librería trunca hacia abajo:
%         1870 µs → 1855.5 µs     1920 µs → 1914.1 µs     1925 µs → 1914.1 µs
%     Por eso esos "escalones de 50 µs" fueron en realidad de 39.1 y 58.6 µs.
%     El ensayo de las 17:47 ya usa el timer de 16 bits (pasos de 0.31 µs).
%     El script calcula K con el Δu nominal y con el Δu que de verdad llegó al ESC.
%
%   CÓMO SE USA
%     Abrir y ejecutar (F5). No depende de la carpeta actual.
%
%   ENTRADAS (../02_datos/)
%     datos_escalon_20260913_193329.csv          columnas tiempo_ms, pwm_us, altura_cm
%     ensayo_escalon_2026-10-01_HH-MM-SS.xlsx    hoja Datos_crudos: t_s, altura_cm, pwm
%
%   SALIDAS
%     Command Window                  tabla comparativa de los cuatro ensayos.
%     resultados_comparacion.csv      la misma tabla, para el informe.
%     figuras/comparacion_ensayos.png      cada ensayo con su modelo Fit 3.
%     figuras/comparacion_normalizada.png  respuestas normalizadas superpuestas.
%     figuras/cuantizacion_pwm.png         pulso pedido vs. pulso real (10 bits).
%
%   REQUISITOS
%     Signal Processing Toolbox (medfilt1).
%
%   Ver también IDENTIFICACIONFIT3.

clear; clc; close all;

carpeta_script = fileparts(mfilename('fullpath'));
if isempty(carpeta_script), carpeta_script = pwd; end
carpeta_datos = fullfile(carpeta_script, '..', '02_datos');
carpeta_figs  = fullfile(carpeta_script, 'figuras');
if ~isfolder(carpeta_figs), mkdir(carpeta_figs); end

%% 1. LISTA DE ENSAYOS
% bits_pwm = resolución del timer que generó el pulso del ESC.
%   Inf → Arduino Uno (Servo.h, resolución de 0.5 µs: se toma como exacta).
%   10  → ESP32Servo con el timer por defecto (pasos de 19.53 µs).
%   16  → ESP32Servo con setTimerWidth(16) (pasos de 0.31 µs).
ensayos = struct( ...
    'archivo',  {'datos_escalon_20260913_193329.csv', ...
                 'ensayo_escalon_2026-10-01_17-06-54.xlsx', ...
                 'ensayo_escalon_2026-10-01_17-29-05.xlsx', ...
                 'ensayo_escalon_2026-10-01_17-47-26.xlsx'}, ...
    'nombre',   {'13/09 · Arduino Uno', ...
                 '01/10 17:06 · ESP32 10 bits', ...
                 '01/10 17:29 · ESP32 10 bits', ...
                 '01/10 17:47 · ESP32 16 bits'}, ...
    'bits_pwm', {Inf, 10, 10, 16});
n = numel(ensayos);

%% 2. PULSO REAL QUE GENERA EL TIMER
% El periférico cuenta ticks enteros: ticks = floor(us · 2^bits / 20000).
% El pulso que sale por el pin es ticks · 20000 / 2^bits.
periodo_us = 20000;                                   % 50 Hz
pulso_real = @(us, bits) floor(us .* 2.^bits ./ periodo_us) .* periodo_us ./ 2.^bits;

%% 3. IDENTIFICACIÓN FIT 3 DE CADA ENSAYO
res = cell(n, 1);
for k = 1:n
    [t, u, y] = leer_ensayo(fullfile(carpeta_datos, ensayos(k).archivo));
    r = fit3(t, u, y);
    % Δu que realmente recibió el ESC y la ganancia corregida con ese Δu
    if isinf(ensayos(k).bits_pwm)
        r.du_real = r.delta_u;
    else
        r.du_real = pulso_real(r.u_inf, ensayos(k).bits_pwm) - ...
                    pulso_real(r.u0,    ensayos(k).bits_pwm);
    end
    r.K_real = r.delta_y / r.du_real;
    res{k} = r;
end
res = [res{:}];

%% 4. TABLA COMPARATIVA
tabla = table( ...
    string({ensayos.nombre})', [res.u0]', [res.y0]', [res.delta_u]', [res.du_real]', ...
    [res.delta_y]', [res.K]', [res.K_real]', [res.tau]', [res.t0]', ...
    ([res.t0] ./ [res.tau])', [res.fit_pct]', [res.rmse]', ...
    'VariableNames', {'Ensayo', 'u0_us', 'y0_cm', 'du_nominal_us', 'du_real_us', ...
    'dy_cm', 'K_nominal', 'K_real', 'tau_s', 't0_s', 't0_sobre_tau', 'Fit_pct', 'RMSE_cm'});
fprintf('\n=== COMPARACIÓN DE ENSAYOS (método Fit 3) ===\n');
disp(tabla);
writetable(tabla, fullfile(carpeta_script, 'resultados_comparacion.csv'));

%% 5. FIGURA — cada ensayo con su modelo
f1 = figure('Color', 'w', 'Position', [80 80 1100 700]);
tema_claro(f1);
for k = 1:n
    r = res(k);
    subplot(2, 2, k);
    plot(r.t_all, r.y_raw, '.', 'Color', [0.65 0.65 0.65], 'MarkerSize', 6); hold on;
    plot(r.t_all, r.y_filt, 'b-', 'LineWidth', 1.4);
    plot(r.t_all, r.y_mod_all, 'r--', 'LineWidth', 1.8);
    xline(0, 'k:');
    grid on; xlim([-5 10]);
    xlabel('t relativo al escalón [s]'); ylabel('y [cm]');
    title({ensayos(k).nombre, sprintf('K = %.3f   \\tau = %.2f s   t_0 = %.2f s   Fit = %.1f %%', ...
        r.K_real, r.tau, r.t0, r.fit_pct)}, 'FontSize', 9);
    if k == 1
        legend('crudo', 'mediana 5', 'FOPDT', 'Location', 'southeast');
    end
end
exportgraphics(f1, fullfile(carpeta_figs, 'comparacion_ensayos.png'), 'Resolution', 200);

%% 6. FIGURA — respuestas normalizadas
% F(t) = (y - y0)/Δy pone todos los ensayos en la misma escala 0 → 1, así se
% comparan solo las formas (rapidez, retardo, cola lenta), no las amplitudes.
f2 = figure('Color', 'w', 'Position', [100 100 900 480]);
tema_claro(f2);
colores = lines(n);
for k = 1:n
    r = res(k);
    plot(r.t_all, (r.y_filt - r.y0) / r.delta_y, '-', 'Color', colores(k, :), 'LineWidth', 1.6); hold on;
end
yline([0.283 0.632 1], 'k:');
grid on; xlim([-1 10]); ylim([-0.3 1.3]);
xlabel('t relativo al escalón [s]'); ylabel('(y - y_0) / \Deltay');
title('Respuestas normalizadas: misma escala, distinta forma');
legend({ensayos.nombre}, 'Location', 'southeast');
exportgraphics(f2, fullfile(carpeta_figs, 'comparacion_normalizada.png'), 'Resolution', 200);

%% 7. FIGURA — cuantización del PWM con timer de 10 bits
f3 = figure('Color', 'w', 'Position', [120 120 760 460]);
tema_claro(f3);
us = 1840:0.25:1940;
plot(us, us, 'k:', 'LineWidth', 1); hold on;
stairs(us, pulso_real(us, 10), 'r-', 'LineWidth', 1.8);
pedidos = [1870 1875 1920 1925];
plot(pedidos, pulso_real(pedidos, 10), 'ko', 'MarkerFaceColor', 'y', 'MarkerSize', 7);
% 1920 y 1925 caen en el mismo escalón, así que comparten una sola etiqueta.
text(1871, pulso_real(1870, 10) - 4, sprintf('1870 → %.1f', pulso_real(1870, 10)), 'FontSize', 8);
text(1876, pulso_real(1875, 10) - 4, sprintf('1875 → %.1f', pulso_real(1875, 10)), 'FontSize', 8);
text(1898, pulso_real(1920, 10) - 5, sprintf('1920 y 1925 → %.1f', pulso_real(1920, 10)), 'FontSize', 8);
grid on; axis([1840 1940 1835 1945]);
xlabel('Pulso pedido por el firmware [\mus]'); ylabel('Pulso que sale del ESP32 [\mus]');
title('ESP32Servo con timer de 10 bits: pasos de 19.53 \mus, truncados');
legend('ideal', '10 bits', 'pulsos del 01/10', 'Location', 'northwest');
exportgraphics(f3, fullfile(carpeta_figs, 'cuantizacion_pwm.png'), 'Resolution', 200);

fprintf('Figuras guardadas en %s\n', carpeta_figs);

%% Funciones locales
function [t, u, y] = leer_ensayo(archivo)
% LEER_ENSAYO  Devuelve tiempo [s], PWM [µs] y altura [cm] de un ensayo.
% El .csv del 13/09 trae tiempo en ms; los .xlsx del simulador traen la hoja
% Datos_crudos con tiempo en s.
if endsWith(archivo, '.csv')
    T = readtable(archivo);
    t = T.tiempo_ms / 1000;
    u = T.pwm_us;
    y = T.altura_cm;
else
    T = readtable(archivo, 'Sheet', 'Datos_crudos');
    t = T.t_s;
    u = T.pwm;
    y = T.altura_cm;
end
end

function r = fit3(t_raw, u_raw, y_raw)
% FIT3  Mismos pasos que IdentificacionFIT3.m, empaquetados como función.
%   Entradas: tiempo [s], PWM [µs], altura cruda [cm] (vectores columna).
%   Salida:   estructura con u0, y0, u_inf, y_inf, K, tau, t0, Fit, RMSE y las
%             series para graficar (t_all, y_raw, y_filt, y_mod_all).

% Filtro de mediana de orden 5 (no desplaza la fase → no altera t0)
y_filt = medfilt1(y_raw, 5);

% Escalón: primer salto del PWM mayor al 40 % de su rango
umbral = 0.4 * (max(u_raw) - min(u_raw));
idx = find(abs(diff(u_raw)) >= umbral, 1, 'first') + 1;
t = t_raw(idx:end) - t_raw(idx);
y = y_filt(idx:end);
u = u_raw(idx:end);

% Punto de operación (antes del escalón) y régimen final (último 15 %)
r.u0 = mean(u_raw(1:idx-1));
r.y0 = mean(y_filt(1:idx-1));
L = numel(y);
N_fin = max(5, round(0.15 * L));
r.u_inf = mean(u(L-N_fin+1:L));
r.y_inf = mean(y(L-N_fin+1:L));
r.delta_u = r.u_inf - r.u0;
r.delta_y = r.y_inf - r.y0;
r.K = r.delta_y / r.delta_u;

% Cruces del 28.3 % y 63.2 % interpolados → tau y t0
y28 = r.y0 + 0.283 * r.delta_y;
y63 = r.y0 + 0.632 * r.delta_y;
i1 = find(y >= y28, 1, 'first');
i2 = find(y >= y63, 1, 'first');
r.t1 = interp1(y(i1-1:i1), t(i1-1:i1), y28);
r.t2 = interp1(y(i2-1:i2), t(i2-1:i2), y63);
r.tau = 1.5 * (r.t2 - r.t1);
r.t0 = max(0, r.t2 - r.tau);

% Modelo y métricas (Fit tipo NRMSE, igual que en IdentificacionFIT3.m)
y_mod = r.y0 + r.delta_y * (1 - exp(-(t - r.t0) / r.tau)) .* (t >= r.t0);
e = y - y_mod;
r.rmse = sqrt(mean(e.^2));
r.fit_pct = (1 - norm(e) / norm(y - mean(y))) * 100;

% Series del ensayo completo (t = 0 en el escalón) para las figuras
r.t_all = t_raw - t_raw(idx);
r.y_raw = y_raw;
r.y_filt = y_filt;
r.y_mod_all = r.y0 + r.delta_y * (1 - exp(-(r.t_all - r.t0) / r.tau)) .* (r.t_all >= r.t0);
end

function tema_claro(fig)
% TEMA_CLARO  Fuerza el tema claro en MATLAB R2025a+ (en versiones anteriores no hace nada).
try
    theme(fig, 'light');
catch
end
end
