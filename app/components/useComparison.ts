"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import { followEvent } from "@/lib/domain/record";
import type { ComparisonRecord, LiveEvent, RunTurnResult, TimelineItem, TurnRecord, Verdict } from "@/lib/domain/types";

/** The runner saves at least every second: after a gap, the saved record has caught up by then. */
const RELOAD_AFTER_GAP_MS = 1200;
/** While a turn runs, this long without any event means the stream may be stuck: reload. */
const SILENCE_MS = 20_000;

/**
 * Follows a comparison from any tab: loads the saved record, then applies its numbered live events in order.
 * Missed events (a gap, a reconnection, a long silence) are recovered by reloading the saved record.
 * The comparison id lives in the URL (`?c=<id>`), so a refresh or a shared link opens the same comparison.
 */
interface Loaded {
  record: ComparisonRecord;
  /** The comparison's live room, and a join token for it. */
  room: { url: string; token: string };
}

async function load(id: string): Promise<Loaded> {
  const response = await fetch(`/api/comparisons/${id}`);
  const body = (await response.json().catch(() => null)) as (Loaded & { error?: string }) | null;
  if (!response.ok || !body?.record) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}

export function useComparison() {
  const [record, setRecord] = useState<ComparisonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<ComparisonRecord | null>(null);
  const socket = useRef<PartySocket | null>(null);
  const timers = useRef<{ reload?: ReturnType<typeof setTimeout>; silence?: ReturnType<typeof setTimeout> }>({});

  const show = (next: ComparisonRecord | null) => {
    current.current = next;
    setRecord(next);
  };

  const close = () => {
    socket.current?.close();
    socket.current = null;
    clearTimeout(timers.current.reload);
    clearTimeout(timers.current.silence);
  };

  const follow = useCallback(async (id: string) => {
    close();
    const first = await load(id).catch((e: Error) => e);
    if (first instanceof Error) {
      setError(first.message);
      show(null);
      return;
    }
    setError(null);
    show(first.record);
    /** Reads the saved comparison again; kept only if it is not behind what this tab already shows. */
    const refresh = async () => {
      const fresh = await load(id).catch(() => null);
      const shown = current.current;
      if (fresh && shown?.info.id === id && fresh.record.seq >= shown.seq) show(fresh.record);
    };
    const reload = (delay: number) => {
      clearTimeout(timers.current.reload);
      timers.current.reload = setTimeout(() => void refresh(), delay);
    };
    const watchSilence = () => {
      clearTimeout(timers.current.silence);
      if (current.current?.status === "busy") timers.current.silence = setTimeout(() => reload(0), SILENCE_MS);
    };
    const room = new URL(first.room.url);
    const live = new PartySocket({
      host: room.host,
      protocol: room.protocol === "https:" ? "wss" : "ws",
      party: "main",
      room: id,
      // A fresh join token on every (re)connection: tokens last 10 minutes.
      query: async () => ({ token: (await load(id).catch(() => first)).room.token }),
    });
    // Events published while connecting, or during a disconnection, are caught up from the saved comparison.
    live.addEventListener("open", () => reload(0));
    live.addEventListener("message", (message) => {
      const event = JSON.parse(String(message.data)) as LiveEvent;
      if (!current.current) return;
      const { record: next, gap } = followEvent(current.current, event);
      if (gap) return reload(RELOAD_AFTER_GAP_MS);
      if (next !== current.current) show(next);
      watchSilence();
    });
    socket.current = live;
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

  /** Records the user's verdict; the names of a blind comparison are revealed once it is saved. */
  const saveVerdict = useCallback(async (winner: string, note: string) => {
    const id = current.current?.info.id;
    if (!id) return;
    const response = await fetch(`/api/comparisons/${id}/verdict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner, note }),
    });
    const body = (await response.json().catch(() => null)) as { verdict?: Verdict; error?: string } | null;
    if (!response.ok || !body?.verdict) throw new Error(body?.error ?? `HTTP ${response.status}`);
    if (current.current?.info.id === id) show({ ...current.current, verdict: body.verdict });
  }, []);

  return { record, error, setError, open, reset, saveVerdict };
}

/** One turn as the interface shows it. */
export interface TurnView {
  index: number;
  prompt: string;
  startedAt: number;
  items: Record<string, TimelineItem[]>;
  results: Record<string, RunTurnResult>;
  done: boolean;
  /** No worker has taken the turn yet (hosted: a machine is starting). */
  queued: boolean;
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
    queued: turn.state === "queued",
    error: turn.error,
  };
}
