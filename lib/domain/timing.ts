import type { TimelineItem } from "./types";

/**
 * Stamps each step with the time Dyon first saw it and the time it stopped running,
 * in milliseconds since the run started. Agents send a step again under the same id as it changes.
 */
export function createStepClock(now: () => number = Date.now) {
  const started = now();
  const seen = new Map<string, { t: number; running: boolean }>();
  return (item: TimelineItem): TimelineItem => {
    const t = now() - started;
    const known = seen.get(item.id);
    const running = item.status === "running";
    if (!known) {
      seen.set(item.id, { t, running });
      return { ...item, t };
    }
    const stamped: TimelineItem = { ...item, t: known.t };
    if (known.running && !running) stamped.endT = t;
    known.running = running;
    return stamped;
  };
}
