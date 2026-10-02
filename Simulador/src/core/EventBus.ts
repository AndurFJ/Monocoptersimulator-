/**
 * EventBus — sistema pub/sub simple y tipado.
 *
 * spec.md §5: "La app es esencialmente un bucle de animación con
 * 3 consumidores (3D, HUD, gráficas); un store reactivo tipo
 * Redux/Zustand es sobre-ingeniería aquí."
 */

type Listener<T> = (payload: T) => void;

export class EventBus<EventMap> {
  private listeners = new Map<keyof EventMap, Set<Listener<never>>>();

  /** Suscribirse a un evento. Devuelve función para desuscribirse. */
  on<K extends keyof EventMap>(event: K, cb: Listener<EventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(cb as Listener<never>);
    return () => {
      set.delete(cb as Listener<never>);
    };
  }

  /** Emitir un evento a todos los suscriptores. */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      (cb as Listener<EventMap[K]>)(payload);
    }
  }

  /** Eliminar todos los suscriptores de un evento, o de todos si no se especifica. */
  clear(event?: keyof EventMap): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
