import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/lib/server/tokens";
import { verifyToken as relayVerify } from "../party/src/room-token";
import { handlePublish } from "../party/src/publish";

const SECRET = "test-secret";
const NOW = 1_800_000_000;

describe("capability tokens (web app side)", () => {
  it("accepts a token for its own purpose and subject", () => {
    const token = signToken(SECRET, "dyon-publish:v1", "cmp-1", 60, NOW);
    expect(verifyToken(SECRET, "dyon-publish:v1", "cmp-1", token, NOW)).toBe(true);
  });
  it("refuses another subject, another purpose, another secret, expiry and tampering", () => {
    const token = signToken(SECRET, "dyon-publish:v1", "cmp-1", 60, NOW);
    expect(verifyToken(SECRET, "dyon-publish:v1", "cmp-2", token, NOW)).toBe(false);
    expect(verifyToken(SECRET, "dyon-room:v1", "cmp-1", token, NOW)).toBe(false);
    expect(verifyToken("other", "dyon-publish:v1", "cmp-1", token, NOW)).toBe(false);
    expect(verifyToken(SECRET, "dyon-publish:v1", "cmp-1", token, NOW + 61)).toBe(false);
    const [exp, sig] = token.split(".");
    expect(verifyToken(SECRET, "dyon-publish:v1", "cmp-1", `${Number(exp) + 3600}.${sig}`, NOW)).toBe(false);
    expect(verifyToken(SECRET, "dyon-publish:v1", "cmp-1", "garbage", NOW)).toBe(false);
    expect(verifyToken("", "dyon-publish:v1", "cmp-1", token, NOW)).toBe(false);
  });
});

describe("relay (Web Crypto) verifies what the web app signs", () => {
  it("room and publish tokens are not interchangeable", async () => {
    const room = signToken(SECRET, "dyon-room:v1", "cmp-1", 600, NOW);
    const publish = signToken(SECRET, "dyon-publish:v1", "cmp-1", 2700, NOW);
    expect(await relayVerify("dyon-room:v1", "cmp-1", room, SECRET, NOW)).toBe(true);
    expect(await relayVerify("dyon-publish:v1", "cmp-1", publish, SECRET, NOW)).toBe(true);
    expect(await relayVerify("dyon-publish:v1", "cmp-1", room, SECRET, NOW)).toBe(false);
    expect(await relayVerify("dyon-room:v1", "cmp-1", publish, SECRET, NOW)).toBe(false);
    expect(await relayVerify("dyon-publish:v1", "cmp-2", publish, SECRET, NOW)).toBe(false);
  });
  it("refuses a token valid too far in the future (forged lifetime)", async () => {
    const long = signToken(SECRET, "dyon-room:v1", "cmp-1", 24 * 3600, NOW);
    expect(await relayVerify("dyon-room:v1", "cmp-1", long, SECRET, NOW)).toBe(false);
  });
});

describe("relay publish endpoint", () => {
  const post = (auth?: string) =>
    new Request("https://relay/parties/main/cmp-1", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
      body: "hello",
    });
  it("broadcasts with a publish token for this room", async () => {
    const sent: string[] = [];
    const token = signToken(SECRET, "dyon-publish:v1", "cmp-1", 2700, NOW);
    expect((await handlePublish(post(`Publish ${token}`), "cmp-1", SECRET, (b) => sent.push(b), NOW)).status).toBe(200);
    expect(sent).toEqual(["hello"]);
  });
  it("refuses a publish token of another room, a room token, no auth, and the bare secret", async () => {
    const sent: string[] = [];
    const other = signToken(SECRET, "dyon-publish:v1", "cmp-2", 2700, NOW);
    const room = signToken(SECRET, "dyon-room:v1", "cmp-1", 600, NOW);
    for (const auth of [`Publish ${other}`, `Publish ${room}`, undefined, `Bearer ${SECRET}`]) {
      expect((await handlePublish(post(auth), "cmp-1", SECRET, (b) => sent.push(b), NOW)).status).toBe(401);
    }
    expect(sent).toEqual([]);
  });
});
