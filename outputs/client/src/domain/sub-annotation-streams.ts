import { isSubAnnotationReplyPending, type SubAnnotationTarget } from './sub-annotations';
import type { Conversation } from './types';

interface SubAnnotationStream {
  target: SubAnnotationTarget;
  controller: AbortController;
  answer: string;
}

/** Streaming text lives with its request and only the displayed node subscribes. */
export class SubAnnotationStreams {
  private readonly live = new Map<string, SubAnnotationStream>();
  private readonly listeners = new Map<string, Set<() => void>>();

  get(id: string | undefined) { return id ? this.live.get(id) : undefined; }

  subscribe(id: string | undefined, listener: () => void) {
    if (!id) return () => {};
    const listeners = this.listeners.get(id) ?? new Set();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(id);
    };
  }

  private changed(id: string) { this.listeners.get(id)?.forEach(listener => listener()); }

  start(target: SubAnnotationTarget, controller: AbortController) {
    this.live.set(target.childId, { target, controller, answer: '' });
    this.changed(target.childId);
  }

  current(conversation: Conversation | undefined, id: string, controller: AbortController) {
    const stream = this.live.get(id);
    if (stream?.controller !== controller || !isSubAnnotationReplyPending(conversation, stream.target)) {
      controller.abort();
      return;
    }
    return stream;
  }

  append(conversation: Conversation | undefined, id: string, controller: AbortController, delta: string) {
    const stream = this.current(conversation, id, controller);
    if (!stream || controller.signal.aborted) return;
    this.live.set(id, { ...stream, answer: stream.answer + delta });
    this.changed(id);
  }

  stop(id: string) { this.live.get(id)?.controller.abort(); }

  stopNodes(annotationId: string, removed: ReadonlySet<string>) {
    for (const stream of this.live.values()) {
      if (stream.target.annotationId === annotationId && removed.has(stream.target.childId)) stream.controller.abort();
    }
  }

  finish(id: string, controller: AbortController) {
    if (this.live.get(id)?.controller !== controller) return;
    this.live.delete(id);
    this.changed(id);
  }
}
