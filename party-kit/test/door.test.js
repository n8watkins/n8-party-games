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
const { RATE_LIMITS, clientKey, nextWindow, socketClient } = await import("../src/worker/limit-logic.js");
const { PROTOCOL } = await import("../src/worker/http.js");

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

  it("counts IPv6 by the /64, as every other limit does: a carrier gives each phone its own /64 out of a shared /48", async () => {
    const { env, hits } = door();
    for (const ip of ["2001:db8:1:2::5", "2001:0db8:0001:0002:1:2:3:4", "2001:db8:1:3::1"]) await handlePartyApi(socket("/api/party/rooms/BCDFGH/ws", { "CF-Connecting-IP": ip }), env);
    expect(hits.map((h) => h.name)).toEqual(["socket:2001:db8:1:2::/64", "socket:2001:db8:1:2::/64", "socket:2001:db8:1:3::/64"]);
    // The room's own key for sharing out its waiting sockets is the /48, and only there.
    expect(socketClient("2001:db8:1:2::5")).toBe("2001:db8:1::/48");
    expect(socketClient("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(socketClient(null)).toBe("local");
    expect(clientKey("2001:db8:1:2::5")).toBe("2001:db8:1:2::/64");
  });

  it("a full socket allowance spent from one /64 does not stop a phone in another /64 of the same /48 opening a socket to a different room", async () => {
    // A limiter that counts as the real one does (one fixed window per name).
    const windows = new Map();
    const fetched = [];
    const env = {
      PARTY_RATE_LIMIT: "on",
      PARTY_LIMITER: {
        getByName: (name) => ({
          hit: async (rule) => {
            const window = nextWindow(windows.get(name) ?? { start: Date.now(), count: 0 }, rule, Date.now());
            windows.set(name, window);
            return window.count <= rule.limit;
          },
        }),
      },
      PARTY_ROOMS: { getByName: (code) => ({ fetch: async () => (fetched.push(code), { status: 101 }) }) },
    };
    const greedy = { "CF-Connecting-IP": "2001:db8:1:2::66" };
    const statuses = [];
    for (let i = 0; i <= RATE_LIMITS.socket.limit; i++) statuses.push((await handlePartyApi(socket("/api/party/rooms/BCDFGH/ws", greedy), env)).status);
    expect(statuses.at(-2)).toBe(101);
    expect(statuses.at(-1)).toBe(429);
    const phone = await handlePartyApi(socket("/api/party/rooms/KMNPQR/ws", { "CF-Connecting-IP": "2001:db8:1:7::3" }), env);
    expect(phone.status).toBe(101);
    expect(fetched.at(-1)).toBe("KMNPQR");
  });

  it("passes the caller's address on to the room, which shares out its waiting sockets by it", async () => {
    const { env } = door();
    let seen = null;
    env.PARTY_ROOMS = { getByName: () => ({ fetch: async (request) => ((seen = request.headers.get("CF-Connecting-IP")), { status: 101 }) }) };
    await handlePartyApi(socket("/api/party/rooms/BCDFGH/ws", { "CF-Connecting-IP": "198.51.100.4" }), env);
    expect(seen).toBe("198.51.100.4");
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

  it("the old form, with the token in the address, is the room's to take: the door only limits it", async () => {
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

describe("making or joining a room from a page loaded before the token left the address", () => {
  // Such a page keeps its old script until it is loaded afresh: it would be given a seat and then
  // open its socket the old way, putting a fresh token in an address each time. The new client
  // marks its requests; one without the mark is told, in words the old page shows, to reload.
  const post = (path, headers = {}) => new Request(`https://party.test${path}`, { method: "POST", body: JSON.stringify({ nickname: "Ann" }), headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers } });
  const rooms = () => {
    const calls = [];
    return { calls, getByName: (code) => ({ create: async (a) => (calls.push(["create", code]), { ok: true, code: a.code, pin: "4821", token: "t", seat: 0, role: "player" }), join: async () => (calls.push(["join", code]), { ok: true, code, pin: "4821", token: "t", seat: 1, role: "player" }) }) };
  };

  it.each([
    ["making a room", "/api/party/rooms"],
    ["joining one", "/api/party/join/BCDFGH"],
  ])("%s without the mark is refused before anything is counted or woken, with a line to show", async (_, path) => {
    const { env, hits } = door();
    env.PARTY_ROOMS = rooms();
    const res = await handlePartyApi(post(path), env);
    expect(res.status).toBe(426);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: "page_outdated" });
    expect(body.message).toMatch(/reload/i);
    expect(hits).toEqual([]);
    expect(env.PARTY_ROOMS.calls).toEqual([]);
  });

  it("a wrong mark is refused the same way", async () => {
    const { env } = door();
    env.PARTY_ROOMS = rooms();
    expect((await handlePartyApi(post("/api/party/join/BCDFGH", { "X-Party-Protocol": "1" }), env)).status).toBe(426);
  });

  it("with the mark, joining goes through", async () => {
    const { env } = door();
    env.PARTY_ROOMS = rooms();
    const res = await handlePartyApi(post("/api/party/join/BCDFGH", { "X-Party-Protocol": PROTOCOL }), env);
    expect(res.status).toBe(200);
    expect(env.PARTY_ROOMS.calls).toEqual([["join", "BCDFGH"]]);
  });

  it("looking a code up needs no mark: it hands out no seat", async () => {
    const { env } = door();
    env.PARTY_ROOMS = { getByName: () => ({ preview: async () => ({ code: "BCDFGH", players: [] }) }) };
    const res = await handlePartyApi(new Request("https://party.test/api/party/join/BCDFGH", { headers: { "CF-Connecting-IP": "203.0.113.7" } }), env);
    expect(res.status).toBe(200);
  });

  it("the party room's API asks for the mark too", async () => {
    const { env } = door();
    const lobbies = rooms();
    expect((await handlePartyApi(post("/api/lobby/rooms"), env, { prefix: "/api/lobby", rooms: lobbies })).status).toBe(426);
    expect(lobbies.calls).toEqual([]);
  });
});
