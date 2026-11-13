// The room a party is in: one shared choice, picked by the host, kept through a sleep, refused
// during the count, the coin toss and a game, and not changed twice within a few seconds.
import { describe, expect, it } from "vitest";
import { DROP_FADE_MS as RECONNECT_GRACE_MS } from "../server/lobby-core.js";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { DEFAULT_ROOM, ROOMS, ROOM_COOLDOWN_MS, isRoom, roomLocked } from "../shared/rooms.js";
import { boxFromManifest } from "../shared/vote.js";
import { POSITION_SLACK, boxCentre } from "../shared/world.js";

const wall = () => ({ boxes: [boxFromManifest(coinFlipManifest, { test: true })], games: new Map([["coin-flip", coinFlip]]) });
const room = (now = 1000) => new LobbyCore({ ...wall(), seed: 7, code: "BCDFGH", now });
function seated(core, name, now = 1000) {
  const joined = core.join(name, now);
  core.connect(joined.token, now);
  return joined;
}
function stand(core, seat, now) {
  const m = core.members[seat];
  const x = boxCentre(0, core.boxes.length);
  let at = m.x;
  while (Math.abs(x - at) > POSITION_SLACK) {
    at += Math.sign(x - at) * POSITION_SLACK;
    core.move(seat, { x: at, d: 0, r: m.rev }, now);
  }
  core.move(seat, { x, d: 0, r: m.rev }, now);
  core.evaluate(now);
}

describe("the rooms list", () => {
  it("is the live skins of the 3D look, with the same names", async () => {
    // skins.js paints with a canvas only when a room is drawn, so it can be read here.
    const { SKINS } = await import("../public/look3d/skins.js");
    const live = Object.values(SKINS).filter((s) => s.live);
    expect(ROOMS.map((r) => r.id).sort()).toEqual(live.map((s) => s.id).sort());
    for (const r of ROOMS) expect(r.name).toBe(SKINS[r.id].name);
    expect(isRoom(DEFAULT_ROOM)).toBe(true);
    expect(isRoom("submarine")).toBe(false);
  });

  it("says why the room cannot be changed", () => {
    expect(roomLocked({ phase: "lobby", vote: {} })).toBe(null);
    expect(roomLocked({ phase: "lobby", vote: { count: { endsIn: 5 } } })).toMatch(/count/);
    expect(roomLocked({ phase: "lobby", vote: { toss: {} } })).toMatch(/coin toss/);
    expect(roomLocked({ phase: "playing", vote: {} })).toMatch(/game/);
  });
});

describe("the party's room", () => {
  it("starts in the bar, and everyone's view carries it and who picks it", () => {
    const core = room();
    const ann = seated(core, "Ann");
    seated(core, "Bo");
    const view = core.view(1000);
    expect(view.room).toBe(DEFAULT_ROOM);
    expect(view.picker).toEqual({ seat: ann.seat });
  });

  it("is changed by the host's tap only", () => {
    const core = room();
    const ann = seated(core, "Ann");
    const bo = seated(core, "Bo");
    expect(core.setRoom(bo.token, "ship", 2000)).toMatchObject({ ok: false, why: "Only the one who started the party can change the room." });
    expect(core.setRoom(ann.token, "ship", 2000)).toEqual({ ok: true, room: "ship", by: 0 });
    expect(core.view(2000).room).toBe("ship");
    expect(core.setRoom(ann.token, "nowhere", 9000)).toMatchObject({ ok: false });
  });

  it("waits a few seconds between changes, for everyone", () => {
    const core = room();
    const ann = seated(core, "Ann");
    core.setRoom(ann.token, "ship", 2000);
    expect(core.setRoom(ann.token, "camp", 2000 + ROOM_COOLDOWN_MS - 1)).toMatchObject({ ok: false });
    expect(core.setRoom(ann.token, "camp", 2000 + ROOM_COOLDOWN_MS)).toMatchObject({ ok: true });
  });

  it("is not changed during the count, the coin toss or a game", () => {
    const core = room();
    const ann = seated(core, "Ann");
    stand(core, ann.seat, 2000);
    expect(core.count).not.toBe(null);
    expect(core.setRoom(ann.token, "ship", 2100)).toMatchObject({ ok: false, why: expect.stringMatching(/count is running/) });
    core.toss = { between: ["a", "b"], winner: "a", endsAt: 9000 };
    expect(core.setRoom(ann.token, "ship", 2100)).toMatchObject({ ok: false, why: expect.stringMatching(/coin toss/) });
    core.toss = null;
    core.count = null;
    core.startGame("coin-flip", 2200);
    expect(core.setRoom(ann.token, "ship", 2300)).toMatchObject({ ok: false, why: expect.stringMatching(/game is on/) });
  });

  it("passes to the first player still here when the host leaves, and to them while the host is away", () => {
    const core = room();
    const ann = seated(core, "Ann");
    const bo = seated(core, "Bo");
    core.disconnect(ann.token, 2000);
    expect(core.view(2000).picker).toEqual({ seat: bo.seat });
    core.connect(ann.token, 3000);
    expect(core.view(3000).picker).toEqual({ seat: ann.seat });
    core.disconnect(ann.token, 4000);
    core.tick(4000 + RECONNECT_GRACE_MS);
    expect(core.hostToken).toBe(bo.token);
    expect(core.setRoom(bo.token, "roof", 4000 + RECONNECT_GRACE_MS)).toMatchObject({ ok: true });
  });

  it("is picked by the first player, and the screen too, when a big screen made the party", () => {
    const core = room();
    const screen = core.watch(1000);
    core.connect(screen.token, 1000);
    expect(core.view(1000).picker).toEqual({ seat: -1 });
    const ann = seated(core, "Ann");
    const bo = seated(core, "Bo");
    expect(core.view(1000).picker).toEqual({ seat: ann.seat });
    expect(core.setRoom(bo.token, "ship", 2000)).toMatchObject({ ok: false });
    expect(core.setRoom(ann.token, "ship", 2000)).toMatchObject({ ok: true, by: 0 });
    expect(core.setRoom(screen.token, "camp", 2000 + ROOM_COOLDOWN_MS)).toMatchObject({ ok: true, by: -1 });
    core.leave(screen.token, 3000);
    expect(core.view(3000).picker).toEqual({ seat: ann.seat });
  });

  it("survives the room sleeping, host and all", () => {
    const core = room();
    const ann = seated(core, "Ann");
    core.setRoom(ann.token, "fair", 2000);
    const woken = LobbyCore.restore(wall(), structuredClone(core.serialize()), 50_000);
    expect(woken.view(50_000).room).toBe("fair");
    woken.resume(ann.token, null);
    expect(woken.view(50_000).picker).toEqual({ seat: ann.seat });
    // A room saved before rooms existed is in the bar.
    const old = structuredClone(core.serialize());
    delete old.room;
    expect(LobbyCore.restore(wall(), old, 50_000).room).toBe(DEFAULT_ROOM);
  });
});
