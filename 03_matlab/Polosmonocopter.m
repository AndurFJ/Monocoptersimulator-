% POLOSMONOCOPTER  Mapa de polos y respuesta al escalón del modelo FOPDT.
%
%   Planta: Monocóptero (Tower Copter 1 GDL) — Control Análogo, Etapa 1.
%
%   QUÉ HACE
%     Toma el modelo identificado por IdentificacionFIT3.m
%
%         Gp(s) = K · e^(-t0·s) / (tau·s + 1)
%
%     y analiza su estabilidad y su respuesta temporal:
%       1. Mapa de polos con rejilla de amortiguamiento (zeta) y frecuencia
%          natural (wn), sin el retardo.
%       2. Mapa de polos y ceros con el retardo aproximado por Padé de 1.er orden.
%       3. Respuesta al mismo escalón de 50 µs que se aplicó en el banco.
%
%   CÓMO SE USA
%     Ejecutar primero IdentificacionFIT3.m (genera resultados_fit3.mat) y
%     después este script. Si el .mat no existe, usa los valores del informe.
%
%   SALIDAS
%     figuras/mapa_polos.png        pzmap + sgrid de Gp(s) sin retardo.
%     figuras/mapa_polos_pade.png   pzmap de Gp(s) con Padé(1) del retardo.
%     figuras/respuesta_modelo.png  step de 50 µs con el tiempo de establecimiento.
%     Command Window                polo dominante y tiempo de establecimiento.
%
%   TEORÍA USADA
%     Polo:   tau·s + 1 = 0  →  s = -1/tau. Real y negativo → planta estable.
%     Padé:   e^(-t0·s) ≈ (1 - t0·s/2) / (1 + t0·s/2)
%             agrega un cero en s = +2/t0 (semiplano derecho) y un polo en
%             s = -2/t0. Ese cero de fase no mínima es el efecto del retardo.
%     Establecimiento al 2 %: e^(-(ts - t0)/tau) = 0.02 → ts = t0 + 3.91·tau
%             (≈ t0 + 4·tau, la regla de bolsillo que imprime el script).
%
%   REQUISITOS
%     Control System Toolbox: tf, pade, pzmap, sgrid, step, stepinfo.
%
%   Ver también IDENTIFICACIONFIT3, VALIDACIONSIMULINK.

clear; clc; close all;

carpeta_script = fileparts(mfilename('fullpath'));
if isempty(carpeta_script), carpeta_script = pwd; end
carpeta_figs = fullfile(carpeta_script, 'figuras');
if ~isfolder(carpeta_figs), mkdir(carpeta_figs); end

%% 1. Parámetros del modelo FOPDT experimental
% Se cargan del .mat para que este script siempre use el último resultado de
% IdentificacionFIT3.m; los valores escritos abajo son el respaldo.
archivo_res = fullfile(carpeta_script, 'resultados_fit3.mat');
if isfile(archivo_res)
    load(archivo_res, 'K', 'tau', 't0');
else
    K   = 0.4302;   % Ganancia estática [cm/us]
    tau = 1.5719;   % Constante de tiempo [s]
    t0  = 0.1188;   % Tiempo muerto [s]
end

%% 2. Función de transferencia
% pzmap solo grafica funciones racionales: el retardo e^(-t0 s) se omite (no
% agrega polos) y se muestra aparte con su aproximación de Padé de 1.er orden:
% e^(-t0 s) ≈ (1 - t0 s/2)/(1 + t0 s/2)
s    = tf('s');
Gp   = K / (tau * s + 1);                 % parte racional (sin retardo)
Gp_d = Gp * exp(-t0 * s);                 % modelo completo con retardo exacto
[num_p, den_p] = pade(t0, 1);             % coeficientes de Padé de orden 1
Gp_pade = Gp * tf(num_p, den_p);          % modelo racional equivalente
polo = -1 / tau;                          % único polo de Gp(s) [rad/s]

%% 3. Mapa de polos con rejilla de amortiguamiento (zeta) y frecuencia (wn)
% La línea roja punteada marca la distancia del polo al eje jω: cuanto más a la
% izquierda, más rápido decae la respuesta (constante de tiempo = 1/|polo|).
f1 = figure('Color', 'w', 'Position', [150, 120, 800, 520]);
tema_claro(f1);
pzmap(Gp); hold on; sgrid;
plot([polo, 0], [0, 0], 'r--', 'LineWidth', 2, ...
    'DisplayName', sprintf('Margen al eje j\\omega: \\sigma = %.4f rad/s', abs(polo)));
plot(polo, 0, 'rx', 'MarkerSize', 12, 'LineWidth', 2.5, 'HandleVisibility', 'off');
title(sprintf('Mapa de polos de G_p(s): polo en s = %.4f rad/s (estable)', polo));
legend('Location', 'northwest'); grid on;
exportgraphics(f1, fullfile(carpeta_figs, 'mapa_polos.png'), 'Resolution', 200);

%% 4. Polos y ceros con la aproximación de Padé del retardo
% Aparecen el polo de la planta (-1/tau), el polo de Padé (-2/t0) y el cero de
% Padé (+2/t0). Como 2/t0 >> 1/tau, el retardo casi no afecta la dinámica
% dominante; sí limita la ganancia que admitirá el PID en lazo cerrado.
f2 = figure('Color', 'w', 'Position', [170, 140, 800, 520]);
tema_claro(f2);
pzmap(Gp_pade); sgrid; grid on;
title(sprintf('G_p(s) con Padé(1) del retardo: polo %.3f, cero +%.2f, polo %.2f', ...
    polo, 2/t0, -2/t0));
exportgraphics(f2, fullfile(carpeta_figs, 'mapa_polos_pade.png'), 'Resolution', 200);

%% 5. Respuesta al escalón de 50 us (la misma que se aplicó en el banco)
% step simula Δy(t) del modelo con retardo exacto; stepinfo mide el tiempo de
% establecimiento al 2 %. Δy final = K·50 µs.
f3 = figure('Color', 'w', 'Position', [190, 160, 800, 420]);
tema_claro(f3);
opt = stepDataOptions('StepAmplitude', 50);
step(Gp_d, opt, 10); grid on;
info = stepinfo(Gp_d * 50);
title(sprintf('Respuesta del modelo a \\Deltau = 50 \\mus: t_s(2%%) = %.2f s, \\Deltay = %.2f cm', ...
    info.SettlingTime, 50 * K));
ylabel('\Deltay [cm]');
exportgraphics(f3, fullfile(carpeta_figs, 'respuesta_modelo.png'), 'Resolution', 200);

fprintf('Polo dominante: s = %.4f rad/s | constante de tiempo tau = %.4f s\n', polo, tau);
fprintf('Tiempo de establecimiento (2%%) ≈ 4·tau + t0 = %.2f s (stepinfo: %.2f s)\n', ...
    4 * tau + t0, info.SettlingTime);

%% Funciones locales
function tema_claro(fig)
% TEMA_CLARO  Fuerza el tema claro en MATLAB R2025a+ (en versiones anteriores no hace nada).
try
    theme(fig, 'light');
catch
end
end
