import "server-only";
import type { LiveEvent } from "@/lib/domain/types";

type Listener = (event: LiveEvent) => void;

/** Recent events kept per comparison, so a tab that connects a moment late catches up without a reload. */
const KEEP = 5_000;

interface Bus {
  listeners: Map<string, Set<Listener>>;
  recent: Map<string, LiveEvent[]>;
}

// One bus per server process, shared by every route (the dev server may load this module more than once).
const bus = ((globalThis as { __dyonBus?: Bus }).__dyonBus ??= { listeners: new Map(), recent: new Map() });

export function publish(comparisonId: string, event: LiveEvent): void {
  const recent = bus.recent.get(comparisonId) ?? [];
  recent.push(event);
  if (recent.length > KEEP) recent.splice(0, recent.length - KEEP);
  bus.recent.set(comparisonId, recent);
  for (const listener of bus.listeners.get(comparisonId) ?? []) listener(event);
}

/**
 * Calls `listener` with every event after `after`: first those already published, then new ones.
 * Returns the function that stops listening.
 */
export function subscribe(comparisonId: string, after: number, listener: Listener): () => void {
  for (const event of bus.recent.get(comparisonId) ?? []) if (event.seq > after) listener(event);
  const set = bus.listeners.get(comparisonId) ?? new Set();
  set.add(listener);
  bus.listeners.set(comparisonId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) bus.listeners.delete(comparisonId);
  };
}
