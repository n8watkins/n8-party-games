// The Worker's door in front of a room's socket (handlePartyApi): what it lets through to the
// room, and what it limits now that the seat's token is no longer in the address for it to see.
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { handlePartyApi } = await import("../src/worker/index.js");
const { RATE_LIMITS } = await import("../src/worker/limit-logic.js");

/** A Worker environment whose limiter and room keep what they were asked. */
function door({ limit = "on", allow = true } = {}) {
  const hits = [];
  const fetched = [];
  const env = {
    PARTY_RATE_LIMIT: limit,
    PARTY_LIMITER: {
      getByName: (name) => ({
        hit: async (rule) => {
          hits.push({ name, rule });
          return allow;
        },
      }),
    },
    PARTY_ROOMS: {
      getByName: (code) => ({
        fetch: async (request) => {
          fetched.push({ code, url: request.url });
          return { status: 101 };
        },
      }),
    },
  };
  return { env, hits, fetched };
}

const socket = (path, headers = {}) => new Request(`https://party.test${path}`, { headers: { Upgrade: "websocket", "CF-Connecting-IP": "203.0.113.7", ...headers } });

describe("opening a room's socket", () => {
  it("goes through to the room with no token anywhere, counted against the caller's address", async () => {
    const { env, hits, fetched } = door();
    const res = await handlePartyApi(socket("/api/party/rooms/BCDFGH/ws"), env);
    expect(res.status).toBe(101);
    expect(fetched).toEqual([{ code: "BCDFGH", url: "https://party.test/api/party/rooms/BCDFGH/ws" }]);
    expect(hits).toEqual([{ name: "socket:203.0.113.7", rule: RATE_LIMITS.socket }]);
  });

  it("is refused before the room is woken when one address opens too many", async () => {
    const { env, fetched } = door({ allow: false });
    const res = await handlePartyApi(socket("/api/party/rooms/BCDFGH/ws"), env);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(fetched).toEqual([]);
  });

  it("allows a party of five devices on one address to drop and come back, and not a script", () => {
    // Five devices, each reconnecting as fast as the client's back-off lets it (every four seconds).
    expect(RATE_LIMITS.socket.limit).toBeGreaterThanOrEqual(5 * 15);
    expect(RATE_LIMITS.socket.limit).toBeLessThanOrEqual(240);
    expect(RATE_LIMITS.socket.windowMs).toBe(60_000);
  });

  it("is not limited where the limiter is off (local play and the test runs)", async () => {
    const { env, hits, fetched } = door({ limit: "off" });
    await handlePartyApi(socket("/api/party/rooms/BCDFGH/ws"), env);
    expect(hits).toEqual([]);
    expect(fetched).toHaveLength(1);
  });

  it("the old form, with the token in the address, is the room's to refuse: the door only limits it", async () => {
    const { env, hits, fetched } = door();
    await handlePartyApi(socket("/api/party/rooms/BCDFGH/ws?token=abc"), env);
    expect(hits).toHaveLength(1);
    expect(fetched).toHaveLength(1);
  });

  it("an address with something too long to be a token never reaches the room", async () => {
    const { env, fetched } = door();
    const res = await handlePartyApi(socket(`/api/party/rooms/BCDFGH/ws?token=${"x".repeat(65)}`), env);
    expect(res.status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it("is refused without an upgrade, for a code that cannot be one, and from another site's page", async () => {
    const { env, hits, fetched } = door();
    expect((await handlePartyApi(new Request("https://party.test/api/party/rooms/BCDFGH/ws"), env)).status).toBe(400);
    expect((await handlePartyApi(socket("/api/party/rooms/nope/ws"), env)).status).toBe(404);
    expect((await handlePartyApi(socket("/api/party/rooms/BCDFGH/ws", { Origin: "https://evil.example" }), env)).status).toBe(403);
    expect(hits).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("the party room's API has the same door", async () => {
    const { env, hits } = door();
    const lobbies = [];
    const rooms = { getByName: (code) => ({ fetch: async (request) => (lobbies.push({ code, url: request.url }), { status: 101 }) }) };
    const res = await handlePartyApi(socket("/api/lobby/rooms/BCDFGH/ws"), env, { prefix: "/api/lobby", rooms });
    expect(res.status).toBe(101);
    expect(lobbies).toEqual([{ code: "BCDFGH", url: "https://party.test/api/lobby/rooms/BCDFGH/ws" }]);
    expect(hits).toHaveLength(1);
  });
});
