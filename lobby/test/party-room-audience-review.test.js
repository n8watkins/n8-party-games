// What an independent review of the party room's audience work (W6) found, each proved on the
// real Durable Object class before it was fixed: pieces that jumped back after a sleep, a second
// socket of someone who left, a moving piece taking a spot, and the spot step's sums.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, settle, useFakeRuntime } from "./fake-room.js";
import { spotsFor4, standOn, turnGame } from "./turn-game.js";
import { SETTINGS_MS } from "../server/lobby-core.js";
import { spawnX } from "../shared/world.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const spots = (game, opts) => spotsFor4(createLobbyRoom, game, opts);
const roomOf = (ws) => ws.messages().filter((m) => m.room).at(-1)?.room;

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("a spot step that ends by itself, then a sleep", () => {
  it("keeps every piece by the door with the room's rev, so the page's next move is taken and nobody jumps back into a light", async () => {
    const r = await spots(turnGame());
    const { ctx, say, ws } = r;
    // Cy stands on the first spot; the second stays empty, so the time limit ends the step.
    await standOn(r, ws.cy, 2, 0);
    await vi.advanceTimersByTimeAsync(SETTINGS_MS);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const n = ctx.room.core.boxes.length;
    const seen = roomOf(ws.cy).members;
    expect(seen.map((m) => m.x)).toEqual([0, 1, 2, 3].map((seat) => spawnX(seat, n)));

    // The room sleeps and wakes with the same sockets.
    await r.sleepAndWake();
    const core = ctx.room.core;
    for (const seat of [0, 1, 2, 3]) expect(core.members[seat]).toMatchObject({ x: seen[seat].x, rev: seen[seat].rev });
    expect(Object.values(core.standing(Date.now()))).toEqual([null, null, null, null]);

    // Cy's page walks on from where it was told her piece is: the room takes it and passes it on.
    const before = ws.ann.frames.length;
    say(ws.cy, { t: "m", x: seen[2].x + 20, d: 1, r: seen[2].rev });
    await settle();
    expect(core.members[2]).toMatchObject({ x: seen[2].x + 20, d: 1 });
    expect(ws.ann.frames.slice(before).map((f) => JSON.parse(f))).toContainEqual({ t: "m", s: 2, x: seen[2].x + 20, d: 1 });
    // At the next room view, nobody stands in a light.
    expect(Object.values(core.voteView(Date.now()).standing)).toEqual([null, null, null, null]);
  });
});
