"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { followEvent } from "@/lib/domain/record";
import type { ComparisonRecord, LiveEvent, RunTurnResult, TimelineItem, TurnRecord } from "@/lib/domain/types";

/** The runner saves at least every second: after a gap, the saved record has caught up by then. */
const RELOAD_AFTER_GAP_MS = 1200;
/** While a turn runs, this long without any event means the stream may be stuck: reload. */
const SILENCE_MS = 20_000;

/**
 * Follows a comparison from any tab: loads the saved record, then applies its numbered live events in order.
 * Missed events (a gap, a reconnection, a long silence) are recovered by reloading the saved record.
 * The comparison id lives in the URL (`?c=<id>`), so a refresh or a shared link opens the same comparison.
 */
export function useComparison() {
  const [record, setRecord] = useState<ComparisonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<ComparisonRecord | null>(null);
  const stream = useRef<EventSource | null>(null);
  const timers = useRef<{ reload?: ReturnType<typeof setTimeout>; silence?: ReturnType<typeof setTimeout> }>({});

  const show = (next: ComparisonRecord | null) => {
    current.current = next;
    setRecord(next);
  };

  const close = () => {
    stream.current?.close();
    stream.current = null;
    clearTimeout(timers.current.reload);
    clearTimeout(timers.current.silence);
  };

  const follow = useCallback(async (id: string) => {
    close();
    const response = await fetch(`/api/comparisons/${id}`);
    const body = (await response.json().catch(() => null)) as { record?: ComparisonRecord; error?: string } | null;
    if (!response.ok || !body?.record) {
      setError(body?.error ?? `HTTP ${response.status}`);
      show(null);
      return;
    }
    setError(null);
    show(body.record);
    const reload = (delay: number) => {
      clearTimeout(timers.current.reload);
      timers.current.reload = setTimeout(() => void follow(id), delay);
    };
    const watchSilence = () => {
      clearTimeout(timers.current.silence);
      if (current.current?.status === "busy") timers.current.silence = setTimeout(() => reload(0), SILENCE_MS);
    };
    const source = new EventSource(`/api/comparisons/${id}/events?after=${body.record.seq}`);
    stream.current = source;
    let opened = false;
    source.onopen = () => {
      // A second open is a reconnection: events may have been missed meanwhile.
      if (opened) reload(0);
      opened = true;
    };
    source.onmessage = (message) => {
      const live = JSON.parse(message.data) as LiveEvent;
      if (!current.current) return;
      const { record: next, gap } = followEvent(current.current, live);
      if (gap) return reload(RELOAD_AFTER_GAP_MS);
      if (next !== current.current) show(next);
      watchSilence();
    };
    watchSilence();
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("c");
    if (id) void follow(id);
    return close;
  }, [follow]);

  /** Opens a comparison and puts its id in the URL. */
  const open = useCallback(
    (id: string) => {
      window.history.pushState(null, "", `?c=${id}`);
      void follow(id);
    },
    [follow],
  );

  const reset = useCallback(() => {
    close();
    window.history.pushState(null, "", window.location.pathname);
    show(null);
    setError(null);
  }, []);

  return { record, error, setError, open, reset };
}

/** One turn as the interface shows it. */
export interface TurnView {
  index: number;
  prompt: string;
  startedAt: number;
  items: Record<string, TimelineItem[]>;
  results: Record<string, RunTurnResult>;
  done: boolean;
  error?: string;
}

export function turnView(turn: TurnRecord): TurnView {
  return {
    index: turn.index,
    prompt: turn.prompt,
    startedAt: Date.parse(turn.startedAt),
    items: turn.items,
    results: turn.results,
    done: turn.state === "done",
    error: turn.error,
  };
}
