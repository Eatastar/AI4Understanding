type MeasureAnchor = (id: string) => DOMRect | null;

/** Only mounted answer surfaces register geometry. Floating windows can outlive them. */
export class AnnotationAnchors {
  private sources = new Map<string, MeasureAnchor>();
  private listeners = new Map<string, Set<() => void>>();

  register(key: string, measure: MeasureAnchor) {
    this.sources.set(key, measure);
    this.changed(key);
    return () => {
      if (this.sources.get(key) !== measure) return;
      this.sources.delete(key);
      this.changed(key);
    };
  }

  measure(key: string, id: string) {
    return this.sources.get(key)?.(id) ?? null;
  }

  changed(key: string) {
    this.listeners.get(key)?.forEach(listener => listener());
  }

  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }
}
