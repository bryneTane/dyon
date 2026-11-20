import { routePartykitRequest, Server } from "partyserver";
import { handlePublish } from "./publish";
import { guardRoom } from "./room-token";

type Env = {
  Main: DurableObjectNamespace<ComparisonRoom>;
  PARTYKIT_SECRET?: string;
};

/**
 * One room per comparison (room id = comparison id). PURE PUB/SUB, no state: the worker publishes
 * numbered events, connected browsers receive them. A browser that (re)connects reads the comparison
 * from the database first and skips the events it already has (by number).
 *
 *   GET  /parties/main/<id>?token=…   WebSocket, token signed by the web app
 *   POST /parties/main/<id>           publish, `Authorization: Publish <token>` (the worker of that turn)
 */
export class ComparisonRoom extends Server<Env> {
  static options = { hibernate: true };

  onRequest(req: Request): Promise<Response> {
    return handlePublish(req, this.name, this.env.PARTYKIT_SECRET, (body) => this.broadcast(body));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routePartykitRequest(request, env, {
      onBeforeConnect: (req, lobby) => guardRoom(req, lobby.name, env.PARTYKIT_SECRET, Math.floor(Date.now() / 1000)),
    });
    return response || new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
