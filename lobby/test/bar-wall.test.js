// The bar on the production wall: its five boxes (Cork & Bell, Who Am I? and three coming soon)
// hang under the painting's gold frames (shared/rooms.js), and every other room hangs them
// evenly. The other suites run on the test wall (six boxes, evenly in every room), so these are
// the bar's own rules, on the wall a real party has: a change of room carries every piece with
// its pool, the light each look draws ends where the room counts, and pieces arrive in the dark
// at either end, never in a gap a piece can barely stand in.
import { describe, expect, it } from "vitest";
import { LobbyCore } from "../server/lobby-core.js";
import { ROOM_COOLDOWN_MS, wallFor } from "../shared/rooms.js";
import { SETTLE_MS } from "../shared/vote.js";
import { PIECE_WIDTH, ROOM, drawnLight, evenWall, lightAt, posAt, spawnX, warmthAt } from "../shared/world.js";
import { WALL } from "../wall.js";

const BAR = wallFor("bar", 5);
const EVEN = evenWall(5);

/** A party on the production wall, in the bar, with these players seated and connected. */
function party(names, now = 1000) {
  const core = new LobbyCore({ ...WALL, seed: 11, code: "BCDFGH", now });
  const seats = names.map((name) => {
    const joined = core.join(name, now);
    core.connect(joined.token, now);
    return joined;
  });
  return { core, seats };
}

/** Puts a seat's piece at x, standing, as the room would have it after a walk there. */
function put(core, seat, x, now) {
  Object.assign(core.members[seat], { x, d: 0, t: now });
}

/** Which pool each piece stands in, by the room's own wall: [seat, pool or -1]. */
const pools = (core, now) => core.members.filter(Boolean).map((m) => [m.seat, lightAt(posAt(m, now), core.wall)]);

describe("the production wall", () => {
  it("is five boxes, under the bar's painted frames in the bar and evenly everywhere else", () => {
    expect(WALL.boxes).toHaveLength(5);
    const { core } = party(["Ann"]);
    expect(core.wall.xs).toEqual(BAR.xs);
    core.room = "ship";
    expect(core.wall.xs).toEqual(EVEN.xs);
  });
});

describe("a change of room on the production wall", () => {
  it("carries every piece with its pool: nobody's place in the light or the dark changes, bar to ship to bar", () => {
    // Every place on the floor, a piece at a time, through two changes of room.
    let now = 10_000;
    const { core, seats } = party(["Ann", "Bo"], now);
    const [ann, bo] = seats;
    for (let x = ROOM.minX; x <= ROOM.maxX; x += 3) {
      core.room = "bar";
      put(core, ann.seat, x, now);
      put(core, bo.seat, ROOM.maxX - (x - ROOM.minX), now);
      const before = pools(core, now);
      now += ROOM_COOLDOWN_MS;
      expect(core.setRoom(ann.token, "ship", now)).toMatchObject({ ok: true, moved: true });
      expect(pools(core, now), `from x=${x}, in the Star Lounge`).toEqual(before);
      now += ROOM_COOLDOWN_MS;
      expect(core.setRoom(ann.token, "bar", now)).toMatchObject({ ok: true, moved: true });
      expect(pools(core, now), `from x=${x}, back in the bar`).toEqual(before);
      // And it comes back where it was, give or take a rounding.
      expect(Math.abs(core.members[ann.seat].x - x)).toBeLessThan(0.01);
    }
  });

  it("keeps every vote the room counts, and every page is told the new places", () => {
    let now = 10_000;
    const { core, seats } = party(["Ann", "Bo"], now);
    const [ann, bo] = seats;
    // Ann in Cork & Bell's light, near its edge; Bo in the dark gap between Cork & Bell and Who Am I?.
    put(core, ann.seat, BAR.xs[0] + BAR.half - 3, now);
    put(core, bo.seat, (BAR.xs[0] + BAR.xs[1]) / 2, now);
    core.evaluate(now);
    const before = core.standing(now);
    expect(before[ann.seat]).toBe(core.boxes[0].id);
    expect(before[bo.seat]).toBe(null);
    const revs = core.members.filter(Boolean).map((m) => m.rev);
    now += ROOM_COOLDOWN_MS;
    core.setRoom(ann.token, "ship", now);
    expect(core.standing(now)).toEqual(before);
    expect(core.members.filter(Boolean).map((m) => m.rev)).toEqual(revs.map((r) => r + 1));
  });

  it("starts no count on the change itself: the room rests a moment first", () => {
    let now = 10_000;
    const { core, seats } = party(["Ann", "Bo"], now);
    const [ann, bo] = seats;
    put(core, ann.seat, BAR.xs[0], now);
    put(core, bo.seat, (BAR.xs[0] + BAR.xs[1]) / 2, now);
    now += SETTLE_MS * 2;
    core.evaluate(now);
    expect(core.count).toBe(null);
    core.setRoom(ann.token, "ship", now);
    // Bo steps into Ann's light the moment the room changes: both stand in it, and still no count.
    put(core, bo.seat, core.wall.xs[0], now);
    for (const t of [now, now + SETTLE_MS / 2, now + SETTLE_MS - 1]) {
      core.evaluate(t);
      expect(core.count, `${t - now} ms after the change`).toBe(null);
    }
    core.evaluate(now + SETTLE_MS);
    expect(core.count).not.toBe(null);
  });

  it("carries the pieces of a room saved on the old even wall onto the bar's, once, when it wakes", () => {
    const now = 10_000;
    const { core, seats } = party(["Ann", "Bo", "Cy", "Di"], now);
    // Where pieces stood before the bar hung its boxes under its frames: in each even pool, on its edges, and in the dark.
    const places = [EVEN.xs[0], EVEN.xs[1] + EVEN.half - 1, (EVEN.xs[1] + EVEN.xs[2]) / 2, EVEN.xs[4] - EVEN.half + 1];
    seats.forEach((s, i) => put(core, s.seat, places[i], now));
    const data = JSON.parse(JSON.stringify(core.serialize()));
    // A save from before the wall was kept with the room.
    delete data.wall;
    const woken = LobbyCore.restore({ ...WALL }, data, now + 1000);
    seats.forEach((s, i) => expect(lightAt(woken.members[s.seat].x, BAR), `piece ${i} at ${places[i]}`).toBe(lightAt(places[i], EVEN)));
    // A save that has its wall is not carried again.
    const again = LobbyCore.restore({ ...WALL }, JSON.parse(JSON.stringify(woken.serialize())), now + 2000);
    seats.forEach((s) => expect(again.members[s.seat].x).toBe(woken.members[s.seat].x));
  });
});

describe("the bar's light on the production wall", () => {
  it("leaves at least a piece's width of dark between two pools, and four players still fit in one", () => {
    for (let i = 1; i < BAR.n; i++) expect(BAR.xs[i] - BAR.half - (BAR.xs[i - 1] + BAR.half)).toBeGreaterThanOrEqual(PIECE_WIDTH);
    // Four pieces standing shoulder to shoulder, overlapping as they do, all count.
    const { core, seats } = party(["Ann", "Bo", "Cy", "Di"]);
    seats.forEach((s, i) => put(core, s.seat, BAR.xs[0] - BAR.half + 4 + i * ((2 * BAR.half - 8) / 3), 1000));
    const standing = core.standing(1000);
    for (const s of seats) expect(standing[s.seat]).toBe(core.boxes[0].id);
  });

  it("is drawn by every look out to where the room counts and no further", () => {
    const drawn = drawnLight(BAR);
    // The flat look's pool and cone, the 3D and real looks' pool, ring and beam: all at the counted edge.
    expect(drawn.pool).toBe(BAR.half);
    expect(drawn.cone).toBe(BAR.half);
    expect(drawn.lit).toBe(BAR.half);
    // The warmth on a piece: lit exactly where the room counts it in a light.
    for (let x = ROOM.minX; x <= ROOM.maxX; x += 0.5) {
      const counted = lightAt(x, BAR);
      for (let i = 0; i < BAR.n; i++) expect(warmthAt(Math.abs(x - BAR.xs[i]), BAR) > 0, `x=${x} pool ${i}`).toBe(counted === i);
    }
    // An even wall keeps the light it always had.
    expect(drawnLight(EVEN)).toEqual({ pool: EVEN.half + 12, cone: EVEN.half + 26, lit: EVEN.half + 40, fade: 40 });
  });

  it("brings arriving and respawned pieces in at the dark ends of the wall, never into a gap between two pools", () => {
    const leftEnd = BAR.xs[0] - BAR.half;
    const rightEnd = BAR.xs[BAR.n - 1] + BAR.half;
    for (let seat = 0; seat < 8; seat++) {
      const x = spawnX(seat, BAR);
      expect(x < leftEnd - PIECE_WIDTH / 2 || x > rightEnd + PIECE_WIDTH / 2, `seat ${seat} at ${x}`).toBe(true);
      expect(x).toBeGreaterThanOrEqual(ROOM.minX);
      expect(x).toBeLessThanOrEqual(ROOM.maxX);
    }
    // In a real party: the four who arrive, and the same four after a game sends them back.
    const { core, seats } = party(["Ann", "Bo", "Cy", "Di"]);
    for (const s of seats) expect(lightAt(core.members[s.seat].x, BAR)).toBe(-1);
    for (const s of seats) expect(core.members[s.seat].x < leftEnd || core.members[s.seat].x > rightEnd).toBe(true);
    core.respawn(2000);
    for (const s of seats) expect(core.members[s.seat].x < leftEnd || core.members[s.seat].x > rightEnd).toBe(true);
  });
});
