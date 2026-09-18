/**
 * animations.ts — helpers de anime.js para transiciones de UI.
 *
 * Para: transiciones de paneles, contadores numéricos, pulso del
 * indicador de conexión, aparición de alertas, expansión PID.
 */

import { animate } from 'animejs';
import type { JSAnimation } from 'animejs';
import type { SourceStatus } from '../data/types';

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Aparición suave de una sección (al cambiar de modo) */
export function fadeIn(el: HTMLElement): void {
  if (prefersReducedMotion()) return;
  animate(el, { opacity: [0, 1], translateY: [6, 0], duration: 260, ease: 'outQuad' });
}

/** Resalta brevemente un elemento (p.ej. la etiqueta de modo del HUD) */
export function flash(el: HTMLElement): void {
  if (prefersReducedMotion()) return;
  animate(el, { scale: [1.15, 1], opacity: [0.4, 1], duration: 400, ease: 'outBack' });
}

/** Anima un número desde su valor actual hasta `to` */
export function countTo(el: HTMLElement, from: number, to: number, format: (v: number) => string): void {
  if (prefersReducedMotion()) {
    el.textContent = format(to);
    return;
  }
  const state = { v: from };
  animate(state, {
    v: to,
    duration: 350,
    ease: 'outQuad',
    onUpdate: () => { el.textContent = format(state.v); },
  });
}

/** Pulso continuo del indicador de conexión. Devuelve una función para detenerlo. */
export function pulse(el: HTMLElement): () => void {
  if (prefersReducedMotion()) return () => {};
  const anim: JSAnimation = animate(el, {
    scale: [1, 1.35],
    opacity: [1, 0.55],
    duration: 700,
    loop: true,
    alternate: true,
    ease: 'inOutSine',
  });
  return () => { anim.revert(); };
}

/** Expande o colapsa una sección (altura automática) */
export function toggleCollapse(el: HTMLElement, open: boolean): void {
  if (prefersReducedMotion()) {
    el.style.display = open ? '' : 'none';
    return;
  }
  if (open) {
    el.style.display = '';
    const h = el.scrollHeight;
    animate(el, {
      height: [0, h],
      opacity: [0, 1],
      duration: 280,
      ease: 'outQuad',
      onComplete: () => { el.style.height = ''; },
    });
  } else {
    animate(el, {
      height: [el.scrollHeight, 0],
      opacity: [1, 0],
      duration: 220,
      ease: 'inQuad',
      onComplete: () => {
        el.style.display = 'none';
        el.style.height = '';
      },
    });
  }
}

/** Muestra una notificación temporal en la esquina */
export function toast(container: HTMLElement, status: SourceStatus, durationMs = 3500): void {
  const el = document.createElement('div');
  el.className = `toast toast-${status.level}`;
  el.setAttribute('role', status.level === 'error' ? 'alert' : 'status');
  el.textContent = status.message;
  container.appendChild(el);

  const remove = () => {
    if (prefersReducedMotion()) {
      el.remove();
      return;
    }
    animate(el, { opacity: 0, translateX: 24, duration: 220, ease: 'inQuad', onComplete: () => el.remove() });
  };

  if (!prefersReducedMotion()) {
    animate(el, { opacity: [0, 1], translateX: [24, 0], duration: 260, ease: 'outQuad' });
  }
  setTimeout(remove, status.level === 'error' ? durationMs * 2 : durationMs);
}
