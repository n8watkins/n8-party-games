// The public API's guards, without the Workers runtime: body limits, origins, the QR allowlist,
// the bot check, and the cap on shared screens.
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, isJoinLink, originAllowed, readBody } from "../src/worker/http.js";
import { botCheckEnabled, verifyBotCheck } from "../src/worker/turnstile.js";
import { MAX_SCREENS, RoomCore } from "../src/core/room-core.js";

const req = (body, headers = {}) => new Request("https://games.example/api/party/rooms", { method: "POST", body, headers });

describe("reading a request body", () => {
  it("takes a small JSON object", async () => {
    expect(await readBody(req('{"nickname":"Ann"}'))).toEqual({ nickname: "Ann" });
    expect(await readBody(req(""))).toEqual({});
  });

  it("refuses anything too long, whatever the declared length", async () => {
    expect(await readBody(req("x".repeat(10), { "Content-Length": String(MAX_BODY_BYTES + 1) }))).toBeNull();
    const big = JSON.stringify({ nickname: "x".repeat(MAX_BODY_BYTES) });
    expect(await readBody(req(big))).toBeNull();
  });

  it("refuses non-objects and broken JSON", async () => {
    for (const body of ["[1,2]", "42", '"text"', "null", "{broken"]) expect(await readBody(req(body)), body).toBeNull();
  });
});

describe("origins", () => {
  const env = { PARTY_PUBLIC_ORIGIN: "http://192.168.1.20:8791" };
  const at = (origin) => new Request("https://games.example/api/party/rooms", { headers: origin ? { Origin: origin } : {} });

  it("lets the site itself, the public address and non-browser clients in", () => {
    expect(originAllowed(at("https://games.example"), env)).toBe(true);
    expect(originAllowed(at("http://192.168.1.20:8791"), env)).toBe(true);
    expect(originAllowed(at(null), env)).toBe(true);
  });

  it("turns other sites away", () => {
    expect(originAllowed(at("https://evil.example"), env)).toBe(false);
    expect(originAllowed(at("http://games.example"), env)).toBe(false);
    expect(originAllowed(at("null"), env)).toBe(false);
  });
});

describe("the QR endpoint draws only this site's join links", () => {
  const origins = new Set(["https://games.example"]);

  it("accepts a join link by PIN or room code", () => {
    expect(isJoinLink("https://games.example/cork-and-bell/?join=4821", origins)).toBe(true);
    expect(isJoinLink("https://games.example/?join=BCD234", origins)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const text of [
      "",
      "hello world",
      "https://evil.example/?join=4821",
      "https://games.example/cork-and-bell/?join=4821&x=1",
      "https://games.example/cork-and-bell/?join=48210",
      "https://games.example/cork-and-bell/?join=4821#frag",
      "https://user:pw@games.example/?join=4821",
      "https://games.example/a%20b/?join=4821",
      "javascript:alert(1)",
      "https://games.example/" + "a".repeat(300) + "?join=4821",
    ]) {
      expect(isJoinLink(text, origins), text).toBe(false);
    }
  });
});

describe("the bot check (Turnstile)", () => {
  const env = { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };
  const answer = (body) => async () => ({ json: async () => body });

  it("is off without a secret", () => {
    expect(botCheckEnabled({})).toBe(false);
    expect(botCheckEnabled({ TURNSTILE_SECRET_KEY: "" })).toBe(false);
    expect(botCheckEnabled(env)).toBe(true);
  });

  it("passes on success and sends the secret, the token and the address", async () => {
    let sent;
    const fetcher = async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return { json: async () => ({ success: true }) };
    };
    expect(await verifyBotCheck(env, "XXXX.DUMMY.TOKEN.XXXX", "203.0.113.9", fetcher)).toBe("ok");
    expect(sent.url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(sent.body).toEqual({ secret: env.TURNSTILE_SECRET_KEY, response: "XXXX.DUMMY.TOKEN.XXXX", remoteip: "203.0.113.9" });
  });

  it("fails without a token, with an oversized one, or when Turnstile says no", async () => {
    const never = async () => {
      throw new Error("should not be called");
    };
    expect(await verifyBotCheck(env, undefined, null, never)).toBe("failed");
    expect(await verifyBotCheck(env, "x".repeat(2049), null, never)).toBe("failed");
    expect(await verifyBotCheck(env, "t", null, answer({ success: false, "error-codes": ["invalid-input-response"] }))).toBe("failed");
    expect(await verifyBotCheck(env, "t", null, answer({ success: false, "error-codes": ["timeout-or-duplicate"] }))).toBe("failed");
  });

  it("reports Turnstile being unreachable or a refused secret as unavailable (fail closed)", async () => {
    const down = async () => {
      throw new Error("network");
    };
    expect(await verifyBotCheck(env, "t", null, down)).toBe("unavailable");
    expect(await verifyBotCheck(env, "t", null, answer({ success: false, "error-codes": ["internal-error"] }))).toBe("unavailable");
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await verifyBotCheck(env, "t", null, answer({ success: false, "error-codes": ["invalid-input-secret"] }))).toBe("unavailable");
    } finally {
      console.error = quiet;
    }
  });
});

describe("shared screens", () => {
  const game = { id: "g", minSeats: 2, maxSeats: 4, create: () => ({}), input() {}, tick: () => [], snapshot: () => ({}), isOver: () => false };

  it("are capped, and a closed one makes way for a new one", () => {
    const room = new RoomCore({ game, seed: 1, code: "BCDFGH", now: 0 });
    const tokens = [];
    for (let i = 0; i < MAX_SCREENS; i++) tokens.push(room.watch(0).token);
    for (const t of tokens) room.connect(t, 0);
    expect(room.watch(0)).toMatchObject({ ok: false, error: "room_full" });
    room.disconnect(tokens[2], 1);
    const again = room.watch(1);
    expect(again.ok).toBe(true);
    expect(room.identify(tokens[2])).toBeNull();
    expect(room.screens.size).toBe(MAX_SCREENS);
  });
});
