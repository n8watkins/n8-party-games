// The switch between the two waiting rooms on the real party room class: the host's `mode`
// message, saved before anyone hears of it, refused to the sender alone, the mode in the hello,
// the room view and the preview, and kept through a restart.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, openRoom, settle, useFakeRuntime } from "./fake-room.js";
import { choosing, from, started, turnGame } from "./turn-game.js";
import { MODE_COOLDOWN_MS } from "../shared/mode.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

/** Ann (the host), Bo and a big screen in the lobby, all connected. */
async function party() {
  const r = await openRoom(createLobbyRoom, turnGame());
  const { ctx, connect } = r;
  ctx.keepAlive = true;
  const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
  const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
  const screen = await ctx.room.join({ as: "screen" });
  const ws = { ann: await connect(ann.token), bo: await connect(bo.token), screen: await connect(screen.token) };
  await settle();
  return { ...r, tokens: { ann: ann.token, bo: bo.token, screen: screen.token }, ws };
}

const lastRoom = (messages) => messages.filter((m) => m.room).at(-1)?.room;

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("switching the party between the two waiting rooms", () => {
  it("is saved before anyone hears of it, then everyone gets a note and the room in its new mode", async () => {
    const r = await party();
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    // The moment any socket is told of the new mode, storage must already hold it.
    const seenInStore = [];
    for (const ws of Object.values(r.ws)) {
      ws.onSend = (text) => {
        if (text.includes('"mode":"turn-based"')) seenInStore.push(r.ctx.store.get("lobby")?.mode);
      };
    }
    r.say(r.ws.ann, { t: "mode", v: "turn-based" });
    await settle();
    expect(seenInStore.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seenInStore)).toEqual(new Set(["turn-based"]));
    for (const ws of Object.values(r.ws)) {
      const got = since(ws);
      expect(got.find((m) => m.t === "note")).toEqual({ t: "note", k: "mode", mode: "turn-based", seat: 0, name: "Ann", text: "Ann moved the party to the Table" });
      expect(lastRoom(got).mode).toBe("turn-based");
      // The note comes before the room view, so a page can carry it to the page it moves to.
      expect(got.findIndex((m) => m.t === "note")).toBeLessThan(got.findIndex((m) => m.t === "room"));
    }
  });

  it("refuses anyone but the host, to that page only, with the mode the party is still in", async () => {
    const r = await party();
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    r.say(r.ws.bo, { t: "mode", v: "turn-based" });
    await settle();
    expect(since(r.ws.bo)).toEqual([{ t: "mode-no", why: "Only the one who started the party can switch rooms.", v: "party-games" }]);
    expect(since(r.ws.ann)).toEqual([]);
    expect(since(r.ws.screen)).toEqual([]);
    expect(r.ctx.store.get("lobby").mode).toBe("party-games");
  });

  it("refuses a second tap within the cooldown, and takes the next one after it", async () => {
    const r = await party();
    r.say(r.ws.ann, { t: "mode", v: "turn-based" });
    await settle();
    const since = from(r.ws.ann);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    expect(since(r.ws.ann)).toEqual([{ t: "mode-no", why: "Wait a moment before switching again.", v: "turn-based" }]);
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    expect(lastRoom(since(r.ws.ann)).mode).toBe("party-games");
  });

  it("refuses during the settings step", async () => {
    const r = await choosing(createLobbyRoom, turnGame({ settings: true }));
    const since = from(r.ws.ann);
    r.say(r.ws.ann, { t: "mode", v: "turn-based" });
    await settle();
    expect(since(r.ws.ann)).toEqual([{ t: "mode-no", why: "A game's settings are being chosen. Go back to the room first, then switch.", v: "party-games" }]);
    // Back to the room, and past its rest: now it switches.
    r.say(r.ws.ann, { t: "settings-cancel" });
    await settle();
    r.say(r.ws.ann, { t: "mode", v: "turn-based" });
    await settle();
    expect(r.ctx.room.core.mode).toBe("turn-based");
  });

  it("refuses while a game is on", async () => {
    const r = await started(createLobbyRoom, turnGame());
    const since = from(r.ws.ann);
    r.say(r.ws.ann, { t: "mode", v: "turn-based" });
    await settle();
    expect(since(r.ws.ann)).toEqual([{ t: "mode-no", why: "A game is on. You can switch when it ends.", v: "party-games" }]);
  });

  it("is in the hello of a page that connects afterwards, and in the preview", async () => {
    const r = await party();
    expect((await r.ctx.room.preview()).mode).toBe("party-games");
    r.say(r.ws.ann, { t: "mode", v: "turn-based" });
    await settle();
    expect((await r.ctx.room.preview()).mode).toBe("turn-based");
    // Bo's page moves: its socket closes, and the new page says hello with the same token.
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    const again = await r.connect(r.tokens.bo);
    await settle();
    const hello = again.messages().find((m) => m.t === "hello");
    expect(hello.you).toEqual({ role: "player", seat: 1 });
    expect(hello.room.mode).toBe("turn-based");
    // And a newcomer joining while the party is in the plain room is told the same.
    const cy = await r.ctx.room.join({ nickname: "Cy", as: "player" });
    const cyWs = await r.connect(cy.token);
    await settle();
    expect(cyWs.messages().find((m) => m.t === "hello").room.mode).toBe("turn-based");
  });

  it("comes back through a restart", async () => {
    const r = await party();
    r.say(r.ws.ann, { t: "mode", v: "turn-based" });
    await settle();
    await r.sleepAndWake();
    expect(r.ctx.room.core.mode).toBe("turn-based");
    const again = await r.connect(r.tokens.ann);
    await settle();
    expect(again.messages().find((m) => m.t === "hello").room.mode).toBe("turn-based");
  });

  it("has no vote in the plain room: a move is not relayed", async () => {
    const r = await party();
    r.say(r.ws.ann, { t: "mode", v: "turn-based" });
    await settle();
    const since = from(r.ws.bo);
    const m = r.ctx.room.core.members[0];
    r.say(r.ws.ann, { t: "m", x: m.x + 20, d: 1, r: m.rev });
    r.say(r.ws.ann, { t: "b" });
    await settle();
    expect(since(r.ws.bo).filter((msg) => msg.t === "m" || msg.t === "b")).toEqual([]);
  });
});
