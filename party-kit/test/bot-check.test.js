// The bot check on new rooms (Cloudflare Turnstile), without the network: siteverify is a fake
// that keeps the real one's rules (a token is good once, for the action and site it was made on).
// First the check on its own (turnstile.js), then the room API around it (handlePartyApi).
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
const { PROTOCOL, PROTOCOL_HEADER } = await import("../src/worker/http.js");
const { BOT_CHECK_ACTION, BOT_CHECK_MESSAGE, BOT_CHECK_UNAVAILABLE_MESSAGE, SITEVERIFY_URL, botCheckEnabled, botCheckHostnames, verifyBotCheck } = await import("../src/worker/turnstile.js");

const SECRET = "a-real-looking-secret-for-tests";
const SITE = "partygames.example";

/**
 * A siteverify that answers as Cloudflare's does. `tokens` maps a token to where it was made
 * ({action, hostname}); a token passes once, and a second use answers "timeout-or-duplicate".
 */
function fakeSiteverify(tokens = {}) {
  const spent = new Set();
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const answer = (value) => ({ ok: true, json: async () => value });
    if (body.secret !== SECRET) return answer({ success: false, "error-codes": ["invalid-input-secret"] });
    const made = tokens[body.response];
    if (!made) return answer({ success: false, "error-codes": ["invalid-input-response"] });
    if (spent.has(body.response)) return answer({ success: false, "error-codes": ["timeout-or-duplicate"] });
    spent.add(body.response);
    return answer({ success: true, challenge_ts: "2026-11-21T00:00:00.000Z", "error-codes": [], ...made });
  };
  return { fetcher, calls };
}

const good = { action: BOT_CHECK_ACTION, hostname: SITE };
const quietly = async (fn) => {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const spyErr = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await fn();
  } finally {
    spy.mockRestore();
    spyErr.mockRestore();
  }
};

describe("checking a token", () => {
  const env = { TURNSTILE_SECRET_KEY: SECRET };
  const check = (token, fetcher, more = {}) => verifyBotCheck(env, token, { hostnames: [SITE], fetcher, ...more });

  it("is off without a secret", () => {
    expect(botCheckEnabled({})).toBe(false);
    expect(botCheckEnabled({ TURNSTILE_SECRET_KEY: "" })).toBe(false);
    expect(botCheckEnabled({ TURNSTILE_SITE_KEY: "0x4AAAAAAA" })).toBe(false);
    expect(botCheckEnabled(env)).toBe(true);
  });

  it("passes a good token, sending the secret, the token and the caller's address to siteverify", async () => {
    const { fetcher, calls } = fakeSiteverify({ T1: good });
    expect(await check("T1", fetcher, { remoteip: "203.0.113.9" })).toBe("ok");
    expect(calls).toEqual([{ url: SITEVERIFY_URL, body: { secret: SECRET, response: "T1", remoteip: "203.0.113.9" } }]);
  });

  it("fails a bad token, and asks nothing for a missing or oversized one", async () => {
    const { fetcher, calls } = fakeSiteverify({ T1: good });
    expect(await check("not-a-token", fetcher)).toBe("failed");
    expect(await check(undefined, fetcher)).toBe("failed");
    expect(await check("", fetcher)).toBe("failed");
    expect(await check(42, fetcher)).toBe("failed");
    expect(await check("x".repeat(2049), fetcher)).toBe("failed");
    expect(calls).toHaveLength(1);
  });

  it("is single use: the same token a second time fails", async () => {
    const { fetcher } = fakeSiteverify({ T1: good });
    expect(await check("T1", fetcher)).toBe("ok");
    expect(await check("T1", fetcher)).toBe("failed");
  });

  it("fails a token made for another action", async () => {
    const { fetcher } = fakeSiteverify({ T1: { ...good, action: "login" }, T2: { hostname: SITE } });
    await quietly(async () => {
      expect(await check("T1", fetcher)).toBe("failed");
      expect(await check("T2", fetcher)).toBe("failed");
    });
  });

  it("fails a token made on another site", async () => {
    const { fetcher } = fakeSiteverify({ T1: { ...good, hostname: "evil.example" }, T2: { action: BOT_CHECK_ACTION } });
    await quietly(async () => {
      expect(await check("T1", fetcher)).toBe("failed");
      expect(await check("T2", fetcher)).toBe("failed");
      // And with no hostnames to match, nothing passes.
      expect(await verifyBotCheck(env, "T3", { fetcher: fakeSiteverify({ T3: good }).fetcher })).toBe("failed");
    });
  });

  it("says unavailable (the caller fails closed) when siteverify cannot be reached", async () => {
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await check("T1", down)).toBe("unavailable");
  });

  it("says unavailable when siteverify does not answer in time, without waiting longer", async () => {
    const hang = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    const started = Date.now();
    expect(await check("T1", hang, { timeoutMs: 30 })).toBe("unavailable");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("says unavailable for siteverify's own error, an answer that is not JSON, or a refused secret", async () => {
    const answer = (value) => async () => ({ ok: true, json: async () => value });
    expect(await check("T1", answer({ success: false, "error-codes": ["internal-error"] }))).toBe("unavailable");
    expect(await check("T1", async () => ({ ok: false, json: async () => JSON.parse("<html>") }))).toBe("unavailable");
    expect(await check("T1", answer(null))).toBe("unavailable");
    await quietly(async () => {
      expect(await verifyBotCheck({ TURNSTILE_SECRET_KEY: "wrong" }, "T1", { hostnames: [SITE], fetcher: fakeSiteverify({ T1: good }).fetcher })).toBe("unavailable");
    });
  });

  it("takes Cloudflare's test secrets without comparing site or action (they answer for example.com)", async () => {
    const testEnv = { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };
    const answer = async () => ({ ok: true, json: async () => ({ success: true, hostname: "example.com", "error-codes": [] }) });
    expect(await verifyBotCheck(testEnv, "XXXX.DUMMY.TOKEN.XXXX", { hostnames: [SITE], fetcher: answer })).toBe("ok");
    // A real secret never gets that pass.
    await quietly(async () => expect(await verifyBotCheck(env, "XXXX.DUMMY.TOKEN.XXXX", { hostnames: [SITE], fetcher: answer })).toBe("failed"));
  });

  it("knows this site's own hostname and its public address", () => {
    const request = new Request(`https://${SITE}/api/party/rooms`, { method: "POST" });
    expect([...botCheckHostnames(request, {})]).toEqual([SITE]);
    expect([...botCheckHostnames(request, { PARTY_PUBLIC_ORIGIN: "http://192.168.1.20:8791" })]).toEqual([SITE, "192.168.1.20"]);
    expect([...botCheckHostnames(request, { PARTY_PUBLIC_ORIGIN: "not a url" })]).toEqual([SITE]);
  });
});

/** A Worker environment with rooms that keep what they were asked, and no limits or budget. */
function site(vars = {}) {
  const made = [];
  const joined = [];
  const env = {
    PARTY_RATE_LIMIT: "off",
    ...vars,
    PARTY_PINS: { getByName: () => ({ resolve: async (pin) => (pin === "1234" ? "BCDFGH" : null) }) },
    PARTY_ROOMS: {
      getByName: (code) => ({
        create: async (args) => {
          made.push(args);
          return { ok: true, code, pin: "1234", token: "seat-token", seat: 0, role: args.as };
        },
        preview: async () => ({ players: [{ nickname: "Ann" }] }),
        join: async (args) => {
          joined.push(args);
          return { ok: true, code, token: "seat-token-2", seat: 1, role: args.as };
        },
      }),
    },
  };
  return { env, made, joined };
}

const api = (path, { method = "POST", body, origin } = {}) =>
  new Request(`https://${SITE}/api/party${path}`, {
    method,
    headers: { "Content-Type": "application/json", [PROTOCOL_HEADER]: PROTOCOL, "CF-Connecting-IP": "203.0.113.7", ...(origin && { Origin: origin }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const send = async (request, env, options) => {
  const res = await handlePartyApi(request, env, options);
  return { status: res.status, ...(await res.json()) };
};

describe("making a room with the bot check", () => {
  const on = { TURNSTILE_SECRET_KEY: SECRET, TURNSTILE_SITE_KEY: "0x4AAAAAAAtest" };

  it("is untouched when it is off: no token is asked for, siteverify is never called, and the page gets no site key", async () => {
    for (const vars of [{}, { TURNSTILE_SITE_KEY: "0x4AAAAAAAtest" }]) {
      const { env, made } = site(vars);
      const siteverify = vi.fn();
      expect(await send(api("/rooms", { body: { nickname: "Ann" } }), env, { siteverify })).toMatchObject({ status: 201, ok: true, pin: "1234" });
      expect(await send(api("/rooms", { body: { as: "screen" } }), env, { siteverify })).toMatchObject({ status: 201, role: "screen" });
      expect(made).toHaveLength(2);
      expect(siteverify).not.toHaveBeenCalled();
      expect((await send(api("/config", { method: "GET" }), env)).turnstileSiteKey).toBeNull();
    }
  });

  it("hands the page its site key when it is on", async () => {
    const { env } = site(on);
    expect((await send(api("/config", { method: "GET" }), env)).turnstileSiteKey).toBe("0x4AAAAAAAtest");
  });

  it("makes the room with a good token, and only once per token", async () => {
    const { env, made } = site(on);
    const { fetcher } = fakeSiteverify({ T1: good });
    expect(await send(api("/rooms", { body: { nickname: "Ann", turnstile: "T1" } }), env, { siteverify: fetcher })).toMatchObject({ status: 201, ok: true });
    const again = await send(api("/rooms", { body: { nickname: "Ann", turnstile: "T1" } }), env, { siteverify: fetcher });
    expect(again).toEqual({ status: 403, ok: false, error: "bot_check", message: BOT_CHECK_MESSAGE });
    expect(made).toEqual([{ code: expect.any(String), nickname: "Ann", as: "player" }]);
  });

  it("refuses without a token, with a bad one, or one from another action or site, with a line the page shows", async () => {
    const { env, made } = site(on);
    const { fetcher } = fakeSiteverify({ T2: { ...good, action: "login" }, T3: { ...good, hostname: "evil.example" } });
    await quietly(async () => {
      for (const turnstile of [undefined, "nonsense", "T2", "T3"]) {
        const res = await send(api("/rooms", { body: { nickname: "Ann", turnstile } }), env, { siteverify: fetcher });
        expect(res, String(turnstile)).toEqual({ status: 403, ok: false, error: "bot_check", message: BOT_CHECK_MESSAGE });
      }
    });
    // A shared screen making a room is checked the same way.
    expect(await send(api("/rooms", { body: { as: "screen" } }), env, { siteverify: fetcher })).toMatchObject({ status: 403, error: "bot_check" });
    expect(made).toEqual([]);
  });

  it("fails closed when siteverify is down: no room, a 503 and a line saying to try again", async () => {
    const { env, made } = site(on);
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await send(api("/rooms", { body: { nickname: "Ann", turnstile: "T1" } }), env, { siteverify: down })).toEqual({ status: 503, ok: false, error: "bot_check_unavailable", message: BOT_CHECK_UNAVAILABLE_MESSAGE });
    expect(made).toEqual([]);
  });

  it("spends no token on a request refused for something cheaper (no name)", async () => {
    const { env } = site(on);
    const { fetcher, calls } = fakeSiteverify({ T1: good });
    expect(await send(api("/rooms", { body: { nickname: "", turnstile: "T1" } }), env, { siteverify: fetcher })).toMatchObject({ status: 400, error: "bad_name" });
    expect(calls).toEqual([]);
  });

  it("never asks someone joining by PIN, or looking a PIN up", async () => {
    const { env, joined } = site(on);
    const siteverify = vi.fn();
    expect(await send(api("/join/1234", { method: "GET" }), env, { siteverify })).toMatchObject({ status: 200, ok: true });
    expect(await send(api("/join/1234", { body: { nickname: "Bo" } }), env, { siteverify })).toMatchObject({ status: 200, ok: true, seat: 1 });
    expect(await send(api("/join/1234", { body: { as: "screen" } }), env, { siteverify })).toMatchObject({ status: 200, ok: true, role: "screen" });
    expect(joined).toHaveLength(2);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it("guards the party room's own API (/api/lobby) the same way", async () => {
    const { env, made } = site(on);
    const lobby = (body) => new Request(`https://${SITE}/api/lobby/rooms`, { method: "POST", headers: { [PROTOCOL_HEADER]: PROTOCOL }, body: JSON.stringify(body) });
    const { fetcher } = fakeSiteverify({ T1: good });
    const options = { prefix: "/api/lobby", rooms: env.PARTY_ROOMS, siteverify: fetcher };
    expect((await handlePartyApi(lobby({ nickname: "Ann" }), env, options)).status).toBe(403);
    expect((await handlePartyApi(lobby({ nickname: "Ann", turnstile: "T1" }), env, options)).status).toBe(201);
    expect(made).toHaveLength(1);
  });
});
