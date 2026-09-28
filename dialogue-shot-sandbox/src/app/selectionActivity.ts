export interface SelectionActivitySnapshot {
  polling: boolean;
  intervalMs: number;
}

/** Request pulses belong to the status indicator, not to the editor state. */
export function createSelectionActivity() {
  let snapshot: SelectionActivitySnapshot = { polling: false, intervalMs: 1_200 };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update: (next: SelectionActivitySnapshot) => {
      if (snapshot.polling === next.polling && snapshot.intervalMs === next.intervalMs) return;
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}

export type SelectionActivity = ReturnType<typeof createSelectionActivity>;
