// The public API's guards, without the Workers runtime: body limits, origins, the QR allowlist,
// and the cap on shared screens. The bot check has its own file (bot-check.test.js).
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, assetOr404, isJoinLink, originAllowed, readBody } from "../src/worker/http.js";
import { MAX_SCREENS, RoomCore } from "../src/core/room-core.js";

const req = (body, headers = {}) => new Request("https://games.example/api/party/rooms", { method: "POST", body, headers });

describe("a file that is not there (assetOr404)", () => {
  // What Workers answers for a missing file under a folder kept for a year: its 404, with the folder's cache rule.
  const year = "public, max-age=31536000, immutable";
  const missing = () => new Response("Not Found", { status: 404, headers: { "Cache-Control": year, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'" } });

  it("is never kept by a browser, whatever the folder's rule says, and stays a 404 with its other headers", async () => {
    const res = await assetOr404(Promise.resolve(missing()));
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(await res.text()).toBe("Not Found");
  });

  it("is the same for any error answer", async () => {
    for (const status of [400, 404, 405, 500]) expect((await assetOr404(new Response(null, { status, headers: { "Cache-Control": year } }))).headers.get("Cache-Control"), status).toBe("no-store");
  });

  it("leaves a file and a redirect exactly as the static files answered them", async () => {
    const file = new Response("export {}", { status: 200, headers: { "Cache-Control": year } });
    expect(await assetOr404(file)).toBe(file);
    const moved = new Response(null, { status: 301, headers: { Location: "/m/a.webp", "Cache-Control": year } });
    expect(await assetOr404(moved)).toBe(moved);
    const same = new Response(null, { status: 304 });
    expect(await assetOr404(same)).toBe(same);
  });
});

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
