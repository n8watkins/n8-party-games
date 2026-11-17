// The production wall, in the bar and in every other room. Its five boxes (Cork & Bell, Flood,
// Tin Derby, Fox Trouble and the ideas poster) hang under the bar's painted gold frames
// (shared/rooms.js) and evenly in every other room, and only a game that can be played has a
// pool of light (shared/world.js, hasPool): Cork & Bell and Tin Derby. The other suites run on
// the test wall (six boxes, evenly in every room), so these are the rules on the wall a real
// party has: a pool only under a playable game, each as wide as its neighbours allow, the light
// each look draws ending where the room counts, a change of room or a restore carrying every
// piece with its pool, and pieces arriving in the dark.
import { describe, expect, it } from "vitest";
import { LobbyCore } from "../server/lobby-core.js";
import { ROOMS, ROOM_COOLDOWN_MS, framesFor, hangsOwnBoxes, wallFor } from "../shared/rooms.js";
import { COUNT_MS, SETTLE_MS, boxFromManifest, spotLights } from "../shared/vote.js";
import { PIECE_WIDTH, ROOM, drawnLight, evenWall, hasPool, lightAt, poolOf, posAt, spawnX, warmthAt } from "../shared/world.js";
import { landingGround, knockLanding } from "../shared/bump.js";
import { WALL } from "../wall.js";

const BAR = wallFor("bar", WALL.boxes);
const [CORK, FLOOD, DERBY, FOX, IDEAS] = [0, 1, 2, 3, 4];

/** A party on the production wall (or `wall`), in the bar, with these players seated and connected. */
function party(names, now = 1000, wall = WALL) {
  const core = new LobbyCore({ ...wall, seed: 11, code: "BCDFGH", now });
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
  it("hangs Cork & Bell, Flood, Tin Derby, Fox Trouble and the ideas poster, a box to each of the bar's frames", () => {
    expect(WALL.boxes.map((b) => b.id)).toEqual(["cork-and-bell", "flood", "tin-derby", "fox-trouble", "ideas"]);
    const { core } = party(["Ann"]);
    expect(core.wall.xs).toEqual(ROOMS.find((r) => r.id === "bar").frames);
    core.room = "ship";
    expect(core.wall.xs).toEqual(evenWall(5).xs);
  });

  it("has a pool only under a game that can be played: Cork & Bell and Tin Derby, in every room", () => {
    expect(WALL.boxes.map(hasPool)).toEqual([true, false, true, false, false]);
    for (const { id } of ROOMS) {
      const wall = wallFor(id, WALL.boxes);
      expect(wall.pools.map((p) => p.i), id).toEqual([CORK, DERBY]);
      for (const i of [FLOOD, FOX, IDEAS]) {
        expect(poolOf(wall, i), `${id}: box ${i}`).toBe(null);
        // Under its poster is the dark, and no look draws light there.
        expect(lightAt(wall.xs[i], wall), `${id}: under box ${i}`).not.toBe(i);
        expect(warmthAt(0, wall, i)).toBe(0);
      }
    }
  });

  it("never counts anyone under a coming-soon poster or the ideas poster, in any room", () => {
    for (const { id } of ROOMS) {
      const { core, seats } = party(["Ann", "Bo"]);
      core.room = id;
      const wall = core.wall;
      for (const i of [FLOOD, FOX, IDEAS]) {
        seats.forEach((s) => put(core, s.seat, wall.xs[i], 5000));
        expect(core.standing(5000), `${id}: under box ${i}`).toEqual({ 0: null, 1: null });
        core.evaluate(5000);
        expect(core.count).toBe(null);
      }
    }
  });

  it("hangs a wall of another size evenly, and a room's frames only take the counts it chose", () => {
    // Any other number of boxes in the bar, and any room without frames, is the even wall exactly as before.
    for (const n of [3, 4, 6, 7]) {
      expect(hangsOwnBoxes("bar", n)).toBe(false);
      expect(wallFor("bar", n)).toEqual(evenWall(n));
    }
    expect(wallFor("ship", 5)).toEqual(evenWall(5));
    // A room with more frames than boxes hangs them in the frames it chose for that many, and the rest stay empty.
    const room = { frames: [100, 300, 500, 700, 900], hang: { 3: [0, 2, 4], 5: [0, 1, 2, 3, 4] } };
    expect(framesFor(room, 3)).toEqual([100, 500, 900]);
    expect(framesFor(room, 4)).toBe(null);
    expect(framesFor({ frames: [1, 2], hang: { 2: [0] } }, 2)).toBe(null);
  });
});

describe("the bar's pools on the production wall", () => {
  it("are as wide as their neighbours allow: Cork & Bell's and Tin Derby's a frame apart, each the full 118", () => {
    expect(BAR.pools.map((p) => [p.i, p.x, p.half])).toEqual([
      [CORK, 656.4, 118],
      [DERBY, 971.5, 118],
    ]);
    // At least a piece's width of dark between them.
    expect(BAR.pools[1].x - BAR.pools[1].half - (BAR.pools[0].x + BAR.pools[0].half)).toBeGreaterThanOrEqual(PIECE_WIDTH);
    expect(BAR.gap).toBeGreaterThanOrEqual(PIECE_WIDTH);
  });

  it("never reach under another playable game's frame", () => {
    for (const p of BAR.pools) {
      for (const q of BAR.pools) {
        if (q === p) continue;
        const frame = [BAR.xs[q.i] - BAR.box / 2, BAR.xs[q.i] + BAR.box / 2];
        expect(p.x + p.half < frame[0] || p.x - p.half > frame[1], `pool ${p.i} under frame ${q.i}`).toBe(true);
      }
    }
  });

  it("are drawn by every look out to where the room counts and no further, pool by pool", () => {
    for (const p of BAR.pools) {
      const drawn = drawnLight(BAR, p.i);
      expect([drawn.pool, drawn.cone, drawn.lit]).toEqual([p.half, p.half, p.half]);
    }
    for (let x = ROOM.minX; x <= ROOM.maxX; x += 0.5) {
      const counted = lightAt(x, BAR);
      for (let i = 0; i < BAR.n; i++) expect(warmthAt(Math.abs(x - BAR.xs[i]), BAR, i) > 0, `x=${x} box ${i}`).toBe(counted === i);
    }
    // An even wall keeps the light it always had, under the games that have a pool.
    const even = wallFor("ship", WALL.boxes);
    expect(drawnLight(even, CORK)).toEqual({ pool: even.half + 12, cone: even.half + 26, lit: even.half + 40, fade: 40 });
  });

  it("each hold four players standing shoulder to shoulder, all counted", () => {
    const { core, seats } = party(["Ann", "Bo", "Cy", "Di"]);
    const p = BAR.pools[0];
    seats.forEach((s, i) => put(core, s.seat, p.x - p.half + 4 + i * ((2 * p.half - 8) / 3), 1000));
    const standing = core.standing(1000);
    for (const s of seats) expect(standing[s.seat]).toBe("cork-and-bell");
  });

  it("are the only places a knock keeps clear of, and a knock never lands anyone in one", () => {
    // The dark goes right under Flood's, Fox Trouble's and the ideas poster's frames.
    const ground = landingGround(BAR);
    expect(ground.some(([a, b]) => a <= BAR.xs[FOX] && b >= BAR.xs[FOX])).toBe(true);
    for (let x = ROOM.minX; x <= ROOM.maxX; x += 7) for (const dir of [-1, 1]) expect(lightAt(knockLanding(x, dir, BAR), BAR), `from ${x} going ${dir}`).toBe(-1);
  });
});

describe("a wall with one game that can be played", () => {
  // The day before Tin Derby was hosted: Cork & Bell the only pool.
  const one = { ...WALL, boxes: WALL.boxes.map((b) => (b.id === "tin-derby" ? { ...b, soon: true, view: null } : b)) };
  const narrow = { ...WALL, boxes: [boxFromManifest({ id: "duo", name: "Duo", players: { min: 2, max: 2 }, devices: { phone: true } }, { view: "/d.js" }), ...WALL.boxes.slice(1, 4).map((b) => ({ ...b, soon: true, view: null })), WALL.boxes[4]] };

  it("has its one pool as wide as a room's (118) and the vote still works: everyone in the one light starts the count", () => {
    const wall = wallFor("bar", one.boxes);
    expect(wall.pools.map((p) => [p.i, p.half])).toEqual([[CORK, 118]]);
    const { core, seats } = party(["Ann", "Bo", "Cy"], 1000, one);
    seats.forEach((s, k) => put(core, s.seat, wall.xs[CORK] - 60 + k * 60, 20_000));
    core.evaluate(20_000);
    expect(core.count).not.toBe(null);
    expect(core.tick(20_000 + COUNT_MS).start).toBe("cork-and-bell");
  });

  it("starts no count for a party too small or too big for its one game", () => {
    const wall = wallFor("bar", narrow.boxes);
    expect(wall.pools.map((p) => p.i)).toEqual([0]);
    // One player: "Needs 2 players", the light is off, and standing in it is the dark.
    const alone = party(["Ann"], 1000, narrow);
    put(alone.core, 0, wall.xs[0], 20_000);
    alone.core.evaluate(20_000);
    expect(alone.core.lights().duo).toBe("Needs 2 players");
    expect(alone.core.count).toBe(null);
    // Three players: "For 2 players".
    const crowd = party(["Ann", "Bo", "Cy"], 1000, narrow);
    crowd.seats.forEach((s) => put(crowd.core, s.seat, wall.xs[0], 20_000));
    crowd.core.evaluate(20_000);
    expect(crowd.core.lights().duo).toBe("For 2 players");
    expect(crowd.core.count).toBe(null);
    // Two: it counts.
    const two = party(["Ann", "Bo"], 1000, narrow);
    two.seats.forEach((s) => put(two.core, s.seat, wall.xs[0], 20_000));
    two.core.evaluate(20_000);
    expect(two.core.count).not.toBe(null);
  });

  it("never offers a coming-soon game or a poster as a spot", () => {
    expect(spotLights(WALL.boxes, "cork-and-bell", 2)).toEqual(["cork-and-bell", "tin-derby"]);
    expect(spotLights(WALL.boxes, "cork-and-bell", 3)).toBe(null);
    expect(spotLights(one.boxes, "cork-and-bell", 2)).toBe(null);
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
    // Ann in Cork & Bell's light, near its edge; Bo in the dark under Flood's poster, between the two pools.
    const cork = BAR.pools[0];
    put(core, ann.seat, cork.x + cork.half - 3, now);
    put(core, bo.seat, BAR.xs[FLOOD], now);
    core.evaluate(now);
    const before = core.standing(now);
    expect(before[ann.seat]).toBe("cork-and-bell");
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
    put(core, ann.seat, BAR.xs[CORK], now);
    put(core, bo.seat, BAR.xs[FLOOD], now);
    now += SETTLE_MS * 2;
    core.evaluate(now);
    expect(core.count).toBe(null);
    core.setRoom(ann.token, "ship", now);
    // Bo steps into Ann's light the moment the room changes: both stand in it, and still no count.
    put(core, bo.seat, core.wall.xs[CORK], now);
    for (const t of [now, now + SETTLE_MS / 2, now + SETTLE_MS - 1]) {
      core.evaluate(t);
      expect(core.count, `${t - now} ms after the change`).toBe(null);
    }
    core.evaluate(now + SETTLE_MS);
    expect(core.count).not.toBe(null);
  });
});

describe("a room saved on an older wall, woken on today's", () => {
  /** Saves a party with pieces at `places`, lets `edit` change the save as an older one would be, and wakes it. */
  function wake(places, edit) {
    const now = 10_000;
    const { core, seats } = party(places.map((_, i) => `P${i}`), now);
    seats.forEach((s, i) => put(core, s.seat, places[i], now));
    const data = JSON.parse(JSON.stringify(core.serialize()));
    edit(data);
    const woken = LobbyCore.restore({ ...WALL }, data, now + 1000);
    return { seats, woken, now };
  }

  it("carries the pieces of a save with no wall (the even wall, a pool under every box) once, and nobody's vote changes", () => {
    const old = evenWall(5);
    // In each old pool, on its edges, and in the dark: the old wall had a pool under the coming-soon boxes too, whose light was off.
    const places = [old.xs[0], old.xs[0] + old.half - 1, old.xs[2] - old.half + 1, old.xs[1], (old.xs[2] + old.xs[3]) / 2, old.xs[4]];
    const { seats, woken, now } = wake(places.slice(0, 4), (data) => delete data.wall);
    const counted = (x) => [0, 2].includes(lightAt(x, old)) ? lightAt(x, old) : -1;
    seats.forEach((s, i) => expect(lightAt(woken.members[s.seat].x, BAR), `piece ${i} at ${places[i]}`).toBe(counted(places[i])));
    // A save that has its wall is not carried again.
    const again = LobbyCore.restore({ ...WALL }, JSON.parse(JSON.stringify(woken.serialize())), now + 2000);
    seats.forEach((s) => expect(again.members[s.seat].x).toBe(woken.members[s.seat].x));
  });

  it("carries the pieces of a save on the bar's earlier wall (narrow pools under all five frames) without changing a vote", () => {
    const frames = BAR.xs;
    const half = 40.7;
    const places = [frames[0], frames[0] + half - 1, frames[2] - half + 1, frames[1]];
    const { seats, woken } = wake(places, (data) => (data.wall = { xs: frames, half }));
    const counted = (x) => { const i = frames.findIndex((f) => Math.abs(x - f) <= half); return [0, 2].includes(i) ? i : -1; };
    seats.forEach((s, i) => expect(lightAt(woken.members[s.seat].x, BAR), `piece ${i} at ${places[i]}`).toBe(counted(places[i])));
  });

  it("keeps a piece that stood in the dark out of a pool its old wall did not have", () => {
    // Saved while Tin Derby was coming soon: its place had no pool. Today it has one, and the piece stays in the dark.
    const { seats, woken } = wake([BAR.xs[DERBY], BAR.xs[DERBY] + 30], (data) => (data.wall.pools = data.wall.pools.filter((p) => p.id !== "tin-derby")));
    for (const s of seats) expect(lightAt(woken.members[s.seat].x, BAR)).toBe(-1);
  });
});

describe("arrivals on the production wall", () => {
  it("brings arriving and respawned pieces in at the dark ends of the bar's wall, never into a pool", () => {
    const left = BAR.pools[0].x - BAR.pools[0].half;
    const right = BAR.pools[1].x + BAR.pools[1].half;
    for (let seat = 0; seat < 8; seat++) {
      const x = spawnX(seat, BAR);
      expect(x < left - PIECE_WIDTH / 2 || x > right + PIECE_WIDTH / 2, `seat ${seat} at ${x}`).toBe(true);
      expect(x).toBeGreaterThanOrEqual(ROOM.minX);
      expect(x).toBeLessThanOrEqual(ROOM.maxX);
    }
    // In a real party: the four who arrive, and the same four after a game sends them back.
    const { core, seats } = party(["Ann", "Bo", "Cy", "Di"]);
    for (const s of seats) expect(lightAt(core.members[s.seat].x, BAR)).toBe(-1);
    core.respawn(2000);
    for (const s of seats) expect(lightAt(core.members[s.seat].x, BAR)).toBe(-1);
  });
});
