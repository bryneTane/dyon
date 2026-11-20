import "server-only";
import type { LiveEvent } from "@/lib/domain/types";
import { relaySecret, relayUrl } from "./config";
import { signToken } from "./tokens";

// The live room of a comparison is a pure relay (party/): the worker publishes, browsers listen. Only the web app
// holds the relay secret. It hands out narrow tokens signed with it: a browser gets a join token for one room, the
// worker a publish token for the room of the turn it runs.

export const ROOM_TOKEN_TTL_S = 600;
/** Covers a whole turn (20-minute limit) plus preparation and saving. */
export const PUBLISH_TOKEN_TTL_S = 45 * 60;

export function roomUrl(comparisonId: string): string {
  return `${relayUrl}/parties/main/${comparisonId}`;
}

/** Verified in party/src/room-token.ts. */
export function signRoomToken(room: string): string {
  return signToken(relaySecret, "dyon-room:v1", room, ROOM_TOKEN_TTL_S);
}

export function signPublishToken(room: string): string {
  return signToken(relaySecret, "dyon-publish:v1", room, PUBLISH_TOKEN_TTL_S);
}

/**
 * Publishes a turn's events to its room, in order, without ever blocking the turn. A failed publish is logged and
 * skipped: the browsers see a gap in the numbers and reload the saved comparison.
 */
export function createPublisher(url: string, token: string): (event: LiveEvent) => void {
  let queue: Promise<unknown> = Promise.resolve();
  return (event) => {
    queue = queue
      .then(async () => {
        const response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Publish ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
      })
      .catch((error) => console.error(`Could not publish event ${event.seq}:`, error));
  };
}
