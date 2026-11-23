// The touch counters (the owner's round three, "Counters"; lobby/shared/counters.js): the curling
// stone, dominoes, boo the stilts, the slime's swallow and stick, and ghosts that meet. Their rules
// as numbers, the room's judgement of each (LobbyCore.bump, curl, domino, boo, goo, pop and the
// room's own look along the floor), the limits on all of them (each resolves once; judged at the
// moment of the touch; nothing comes to rest in a light it was not in), what a page draws in both
// looks, and on the real Durable Object class that each reaches every page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { BumpDraw } from "../public/bump-draw.js";
import { bumpPose, startFright, startKnock } from "../public/look3d/pieces.js";
import { heardKickCounters, heardTouch } from "../public/move-state.js";
import { CHARGE_FULL_MS, IMPACT_MS, STUN_MS, knockLanding, knockState } from "../shared/bump.js";
import { LOOK_COOLDOWN_MS } from "../shared/characters.js";
import {
  CURL_CONTACT, CURL_MS, DOMINO_CONTACT, GOO_REACH, POP_MS, STICK_APART, STICK_MS, SWALLOW_MS, SWALLOW_OUT,
  curlDistance, curlEase, curlPose, curlReaches, flightReaches, popPose, stickPose, swallowedPose,
} from "../shared/counters.js";
import { MOVED, TOUCH_GRACE_MS } from "../shared/moves.js";
import { STILT_MS } from "../shared/robot.js";
import { HARDEN_MS, HOLD_MS } from "../shared/slime.js";
import { boxFromManifest } from "../shared/vote.js";
import { POSITION_SLACK, ROOM, lightAt, posAt, walkSpeed } from "../shared/world.js";
import { WALL } from "../wall.js";
import { dropFakeRuntime, openRoom, settle, useFakeRuntime, walkTo } from "./fake-room.js";
import { turnGame } from "./turn-game.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const coinWall = () => ({ boxes: [boxFromManifest(coinFlipManifest, { test: true })], games: new Map([["coin-flip", coinFlip]]) });

function party(names, wall = coinWall()) {
  const core = new LobbyCore({ ...wall, seed: 7, code: "BCDFGH", now: 1000 });
  for (const name of names) core.connect(core.join(name, 1000).token, 1000);
  return core;
}

function place(core, seat, x, now, face = 1) {
  const m = core.members[seat];
  while (Math.abs(x - m.x) > 1) core.move(seat, { x: Math.abs(x - m.x) > POSITION_SLACK ? m.x + Math.sign(x - m.x) * (POSITION_SLACK - 10) : x, d: 0, r: m.rev }, now);
  core.move(seat, { x, d: face, r: m.rev }, now);
  core.move(seat, { x, d: 0, r: m.rev }, now);
}

function be(core, seat, character, now = 1000) {
  core.members[seat].character = character;
  core.members[seat].lookAt = now - LOOK_COOLDOWN_MS * 10;
}

const walk = (core, seat, x, d, now) => core.move(seat, { x, d, r: core.members[seat].rev }, now);
const lights = (core) => [core.landingWall(), core.litPlaces()];

describe("the touch counters, as numbers", () => {
  it("slide the stone further the harder the kick, slowing as it goes, and say when it reaches a spot", () => {
    expect(curlDistance(0)).toBeLessThan(curlDistance(1));
    expect(curlEase(0)).toBe(0);
    expect(curlEase(CURL_MS)).toBe(1);
    expect(curlEase(CURL_MS / 2)).toBeGreaterThan(0.5);
    expect(curlReaches(600, 0)).toBe(0);
    expect(curlReaches(600, 600)).toBe(CURL_MS);
    expect(curlReaches(600, 601)).toBeNull();
    expect(curlEase(curlReaches(600, 300))).toBeCloseTo(0.5, 2);
  });

  it("time a domino by the flight of the piece that hits it, and not past where it lands", () => {
    expect(flightReaches(500, 710, 500 + DOMINO_CONTACT)).toBe(IMPACT_MS + 50);
    expect(flightReaches(500, 710, 760)).toBeGreaterThan(flightReaches(500, 710, 650));
    expect(flightReaches(500, 710, 800)).toBeNull();
    expect(flightReaches(500, 290, 400)).not.toBeNull();
    expect(flightReaches(500, 290, 600)).toBeNull();
    // A piece already within contact of where the flight begins is met at once, as the flight starts
    // (as the curling stone meets one: reach 0); one behind it is never met.
    expect(flightReaches(500, 710, 540)).toBe(flightReaches(500, 710, 500 + DOMINO_CONTACT));
    expect(flightReaches(500, 290, 480)).toBe(flightReaches(500, 290, 500 - DOMINO_CONTACT));
    expect(flightReaches(500, 710, 500)).toBeNull();
    expect(flightReaches(500, 710, 480)).toBeNull();
  });

  it("draw each one, and still with less motion", () => {
    expect(curlPose(-10, 500, 900, 300)).toMatchObject({ state: "standing", x: 500 });
    expect(curlPose(CURL_MS / 2, 500, 900, 300).x).toBeGreaterThan(700);
    expect(curlPose(CURL_MS / 2, 500, 900, 300, true).x).toBe(curlPose(CURL_MS / 2, 500, 900, 300).x);
    expect(swallowedPose(SWALLOW_MS / 2, 500, 700, 300).sx).toBeLessThan(0.6);
    expect(swallowedPose(SWALLOW_MS - 1, 500, 700, 300).x).toBeGreaterThan(690);
    expect(stickPose(STICK_MS / 3, 500, 470, 300).sx).toBeGreaterThan(1.05);
    expect(stickPose(STICK_MS - 1, 500, 470, 300).x).toBeLessThan(471);
    expect(popPose(POP_MS / 3, 500, 500, 300).lift).toBeGreaterThan(5);
    expect(popPose(POP_MS / 3, 500, 500, 300, true).lift).toBeGreaterThan(0);
    for (const kind of ["curl", "swallowed", "stick", "pop"]) expect(MOVED[kind].ms).toBeGreaterThan(0);
    // A knock still to come stands until it does.
    expect(knockState(-50)).toBe("standing");
  });
});

describe("the curling stone: a charged kick sends a hardened slime sliding", () => {
  /** Pat (a pawn) charges into Sam (a slime, hardened) with Bo standing `gap` beyond Sam. */
  function setup(gap = 260, wall) {
    const core = party(["Pat", "Sam", "Bo"], wall);
    be(core, 1, "slime");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 390, 1500, -1);
    place(core, 2, 390 + gap, 1500, -1);
    core.charge(0, 2000);
    core.slime(1, "harden", 2400);
    return core;
  }

  it("slides the stone off as the kick lands; it knocks the first piece in its way over as it reaches it, and slides on past it into the dark", () => {
    const core = setup();
    const now = 2000 + CHARGE_FULL_MS;
    const b = core.bump(0, now, undefined, true);
    const [wall, lit] = lights(core);
    expect(b).toMatchObject({ bo: 1, c: 1 });
    const dist = curlDistance(1);
    // The stone: past Bo, in the dark.
    expect(b.cu.x).toBe(knockLanding(390, 1, wall, lit, { distance: dist, least: 260 + CURL_CONTACT }));
    // Bo is reached when the slide every page draws (CURL_MS over 390 -> the stone's rest) gets there.
    const at = IMPACT_MS + curlReaches(b.cu.x - 390, 260 - CURL_CONTACT);
    expect(b.cv).toMatchObject({ to: 2, at, x: knockLanding(650, 1, wall, lit) });
    expect(core.members[2].stunUntil).toBe(now + at - IMPACT_MS + STUN_MS);
    expect(b.cu.x).toBeGreaterThan(650);
    expect(lightAt(b.cu.x, wall)).toBe(-1);
    expect(core.members[1]).toMatchObject({ x: b.cu.x, fright: "curl", stunUntil: now + IMPACT_MS + CURL_MS });
    // The pawn is still punished: thrown back, down longer.
    expect(b.ke).toBeGreaterThan(0);
  });

  it("knocks a voter out of its light and never stops in it (the decided rule), on the production wall", () => {
    const core = party(["Pat", "Sam", "Bo"], WALL);
    be(core, 1, "slime");
    const [wall, lit] = lights(core);
    const pool = wall.pools.find((p) => lit.includes(p.i));
    // Bo votes in the middle of a lit pool; Pat and Sam stand in the dark before it.
    place(core, 2, Math.round(pool.x), 1500);
    place(core, 1, Math.round(pool.x - pool.half - 150), 1500, 1);
    place(core, 0, Math.round(pool.x - pool.half - 240), 1500, 1);
    core.charge(0, 2000);
    core.slime(1, "harden", 2400);
    const b = core.bump(0, 2000 + CHARGE_FULL_MS, undefined, true);
    expect(b.cv?.to).toBe(2);
    expect(lightAt(core.members[2].x, wall)).toBe(-1);
    expect(lightAt(b.cu.x, wall)).toBe(-1);
    expect(b.cu.x).toBeGreaterThan(pool.x);
  });

  it("slides the whole way with nobody in reach, and a tap does no curling", () => {
    const far = setup(1200 - 390);
    const b = far.bump(0, 2000 + CHARGE_FULL_MS, undefined, true);
    expect(b.cv).toBeUndefined();
    expect(b.cu).toBeDefined();
    const tap = party(["Pat", "Sam"]);
    be(tap, 1, "slime");
    place(tap, 0, 300, 1500, 1);
    place(tap, 1, 390, 1500, -1);
    tap.slime(1, "harden", 2000);
    expect(tap.bump(0, 2100)?.cu).toBeUndefined();
    expect(tap.members[1].x).toBe(390);
  });

  it("is a counter once: what the stone knocks over flies into nobody else", () => {
    const core = party(["Pat", "Sam", "Bo", "Cy"]);
    be(core, 1, "slime");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 390, 1500, -1);
    place(core, 2, 650, 1500, -1);
    place(core, 3, 720, 1500, -1);
    core.charge(0, 2000);
    core.slime(1, "harden", 2400);
    const b = core.bump(0, 2000 + CHARGE_FULL_MS, undefined, true);
    expect(b.cv?.to).toBe(2);
    expect(b.dm).toBeUndefined();
    expect(core.members[3].stunUntil ?? 0).toBeLessThan(2000);
  });

  it("knocks the piece in its way when every page draws the stone reaching it, all over the production wall", () => {
    // Every placement the review tried: the stone's rest can be pushed on well past its distance to
    // clear a light, and the knock is timed on that real slide (curlPose), not the nominal one.
    let tried = 0;
    let worst = 0;
    for (let sx = 100; sx < 2400; sx += 37) {
      for (let gap = 70; gap < 640; gap += 29) {
        if (sx - 90 < 110 || sx + gap > 1810) continue;
        const core = party(["Pat", "Sam", "Bo"], WALL);
        be(core, 1, "slime");
        for (const [s, x, f] of [[0, sx - 90, 1], [1, sx, -1], [2, sx + gap, -1]]) Object.assign(core.members[s], { x, d: 0, t: 1500, face: f });
        core.charge(0, 2000);
        core.slime(1, "harden", 2400);
        const b = core.bump(0, 2000 + CHARGE_FULL_MS, 1, true);
        if (!b?.cu || !b.cv) continue;
        tried++;
        const reach = sx + gap - CURL_CONTACT;
        let drawn = null;
        for (let t = 0; t <= CURL_MS && drawn === null; t++) if (sx + (b.cu.x - sx) * curlEase(t) >= reach) drawn = IMPACT_MS + t;
        expect(drawn, `stone from ${sx}, Bo ${gap} on`).not.toBeNull();
        worst = Math.max(worst, Math.abs(drawn - b.cv.at));
        // And the stone rests past the piece it knocked over.
        expect(b.cu.x, `stone from ${sx}, Bo ${gap} on`).toBeGreaterThanOrEqual(reach);
      }
    }
    expect(tried).toBeGreaterThan(100);
    expect(worst).toBeLessThan(20);
  });

  it("stops short of a hardened slime in its way, which stands, as it does against a kick", () => {
    const core = setup(260);
    be(core, 2, "slime");
    core.slime(2, "harden", 2900);
    const now = 2000 + CHARGE_FULL_MS;
    const b = core.bump(0, now, undefined, true);
    expect(b.cv).toBeUndefined();
    expect(b.cu.x).toBeLessThanOrEqual(650 - CURL_CONTACT);
    expect(b.cu.x).toBeGreaterThan(390);
    expect(core.members[2]).toMatchObject({ x: 650 });
    expect(core.members[2].stunUntil ?? 0).toBeLessThan(now);
  });
});

describe("dominoes: a kicked piece that flies into another knocks it over too", () => {
  it("knocks the first piece in the flight over as the flight reaches it, a kick's distance on", () => {
    const core = party(["Pat", "Bo", "Cy"]);
    place(core, 0, 300, 1500, 1);
    place(core, 1, 380, 1500, -1);
    place(core, 2, 500, 1500, -1);
    const b = core.bump(0, 2000);
    const [wall, lit] = lights(core);
    expect(b.to).toBe(1);
    const at = flightReaches(380, b.x, 500);
    expect(b.dm).toMatchObject({ to: 2, at, x: knockLanding(500, 1, wall, lit) });
    expect(core.members[2].stunUntil).toBe(2000 + at - IMPACT_MS + STUN_MS);
  });

  it("once: the domino flies into nobody, and a piece past where the first lands is left alone", () => {
    const core = party(["Pat", "Bo", "Cy", "Di"]);
    place(core, 0, 300, 1500, 1);
    place(core, 1, 380, 1500, -1);
    place(core, 2, 500, 1500, -1);
    place(core, 3, 640, 1500, -1);
    const b = core.bump(0, 2000);
    expect(b.dm?.to).toBe(2);
    expect(core.members[3].stunUntil ?? 0).toBeLessThan(2000);
    const short = party(["Pat", "Bo", "Cy"]);
    place(short, 0, 300, 1500, 1);
    place(short, 1, 380, 1500, -1);
    place(short, 2, 1500, 1500, -1);
    expect(short.bump(0, 2000).dm).toBeUndefined();
  });

  it("stops short of a hardened slime in the flight, which stands and knocks nobody", () => {
    const core = party(["Pat", "Bo", "Sam"]);
    be(core, 2, "slime");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 380, 1500, -1);
    place(core, 2, 500, 1500, -1);
    core.slime(2, "harden", 1950);
    const b = core.bump(0, 2000);
    expect(b.to).toBe(1);
    expect(b.dm).toBeUndefined();
    expect(b.x).toBeLessThanOrEqual(500 - DOMINO_CONTACT);
    expect(core.members[1].x).toBe(b.x);
    expect(core.members[2]).toMatchObject({ x: 500 });
    expect(core.members[2].stunUntil ?? 0).toBeLessThan(2000);
  });

  it("knocks a piece standing right behind the kicked one (inside contact distance) at once, not the one beyond it", () => {
    const core = party(["Pat", "Bo", "Cy", "Di"]);
    place(core, 0, 300, 1500, 1);
    place(core, 1, 380, 1500, -1);
    place(core, 2, 420, 1500, -1);
    place(core, 3, 520, 1500, -1);
    const b = core.bump(0, 2000);
    const [wall, lit] = lights(core);
    expect(b.to).toBe(1);
    // Met as the flight begins: every page knocks it over then (heardKickCounters draws `at`).
    expect(b.dm).toMatchObject({ to: 2, at: flightReaches(380, b.x, 380 + DOMINO_CONTACT), x: knockLanding(420, 1, wall, lit) });
    expect(core.members[2].stunUntil).toBe(2000 + b.dm.at - IMPACT_MS + STUN_MS);
    expect(core.members[3].stunUntil ?? 0).toBeLessThan(2000);
  });

  it("is stopped at once by a hardened slime standing right behind the kicked one: it lands where it stood", () => {
    const core = party(["Pat", "Bo", "Sam", "Di"]);
    be(core, 2, "slime");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 380, 1500, -1);
    place(core, 2, 420, 1500, -1);
    place(core, 3, 520, 1500, -1);
    core.slime(2, "harden", 1950);
    const b = core.bump(0, 2000);
    expect(b).toMatchObject({ to: 1, x: 380 });
    expect(b.dm).toBeUndefined();
    expect(core.members[1]).toMatchObject({ x: 380, stunUntil: 2000 + STUN_MS });
    expect(core.members[2]).toMatchObject({ x: 420 });
    for (const s of [2, 3]) expect(core.members[s].stunUntil ?? 0).toBeLessThan(2000);
  });

  it("passes a piece it cannot knock: one down or just up, a robot up on its legs, a faded ghost", () => {
    for (const [what, prep] of [
      ["up on its legs", (core) => (be(core, 2, "robot"), core.stilts(2, 1900))],
      ["faded", (core) => (be(core, 2, "ghost"), (core.members[2].fadeAt = -Infinity), core.fade(2, 1900))],
      ["just up", (core) => Object.assign(core.members[2], { immuneUntil: 3000 })],
    ]) {
      const core = party(["Pat", "Bo", "Cy"]);
      place(core, 0, 300, 1500, 1);
      place(core, 1, 380, 1500, -1);
      place(core, 2, 500, 1500, -1);
      prep(core);
      expect(core.bump(0, 2000).dm, what).toBeUndefined();
    }
  });
});

describe("boo the stilts: a faded ghost topples a robot up on its legs", () => {
  it("knocks it over where a spook would have sent it, its legs dropped", () => {
    const core = party(["Gus", "Rob"]);
    be(core, 0, "ghost");
    be(core, 1, "robot");
    core.members[0].fadeAt = -Infinity;
    place(core, 0, 500, 1500);
    place(core, 1, 600, 1500);
    core.fade(0, 2000);
    core.stilts(1, 2000);
    walk(core, 0, 500, 1, 2000);
    const out = core.boo(0, 1, 2200);
    expect(out).toMatchObject({ ok: true, relay: { t: "spook", to: 1, tp: 1 } });
    expect(core.members[1].stiltsUntil).toBeLessThanOrEqual(2200);
    expect(core.members[1].stunUntil).toBe(2200 + STUN_MS);
    expect(core.members[1].fright).toBeNull();
  });

  it("only while it is up: a robot whose legs are down is spooked as anyone is", () => {
    const core = party(["Gus", "Rob"]);
    be(core, 0, "ghost");
    be(core, 1, "robot");
    core.members[0].fadeAt = -Infinity;
    place(core, 0, 500, 1500);
    place(core, 1, 600, 1500);
    core.fade(0, 2000);
    core.stilts(1, 2000 - STILT_MS - 100);
    walk(core, 0, 500, 1, 2000);
    expect(core.boo(0, 1, 2200)).toMatchObject({ ok: true, relay: { t: "spook", to: 1 } });
    expect(core.members[1].fright).toBe("spook");
  });
});

describe("the slimes: soft swallows hard, soft sticks to soft", () => {
  /** Sam and Sue (slimes) standing `gap` apart. */
  function setup(gap = 140) {
    const core = party(["Sam", "Sue"]);
    be(core, 0, "slime");
    be(core, 1, "slime");
    place(core, 0, 500, 1500);
    place(core, 1, 500 + gap, 1500, -1);
    return core;
  }

  for (const [order, walker] of [
    ["the soft one walks into the hard one", 0],
    ["the hard one walks into the soft one", 1],
  ]) {
    it(`swallows the hard one and spits it out the far side (${order})`, () => {
      const core = setup();
      // Sam soft, Sue hard.
      core.slime(0, "harden", 2000);
      core.slime(0, "absorb", 2000 + HOLD_MS);
      core.slime(1, "harden", 2000 + HOLD_MS);
      const now = 2000 + HOLD_MS + 10;
      walk(core, walker, core.members[walker].x, walker === 0 ? 1 : -1, now);
      core.dueMoves(now);
      const touched = now + ((140 - GOO_REACH) / walkSpeed("slime")) * 1000;
      const out = core.dueMoves(Math.ceil(touched + TOUCH_GRACE_MS));
      const goo = out.find((m) => m.t === "goo");
      expect(goo).toMatchObject({ k: "swallow", s: 0, to: 1 });
      // Out past Sam's middle (by SWALLOW_OUT), away from where Sue came in from.
      const samX = posAt(core.members[0], Math.ceil(touched + TOUCH_GRACE_MS));
      expect(Math.abs(goo.x - Math.round(samX - SWALLOW_OUT))).toBeLessThanOrEqual(1);
      expect(core.members[1]).toMatchObject({ fright: "swallowed", x: goo.x });
      expect(core.members[1].hardUntil).toBeLessThanOrEqual(Math.ceil(touched + TOUCH_GRACE_MS));
      expect(core.members[0].softUntil).toBeLessThanOrEqual(Math.ceil(touched + TOUCH_GRACE_MS));
    });
  }

  it("sticks two soft ones together, and they come apart STICK_APART apart, their absorbs spent", () => {
    const core = setup();
    core.slime(0, "harden", 2000);
    core.slime(0, "absorb", 2000 + HOLD_MS);
    core.slime(1, "harden", 2000);
    core.slime(1, "absorb", 2000 + HOLD_MS);
    const now = 2000 + HOLD_MS + 10;
    walk(core, 0, 500, 1, now);
    core.dueMoves(now);
    const touched = now + ((140 - GOO_REACH) / walkSpeed("slime")) * 1000;
    const out = core.dueMoves(Math.ceil(touched + TOUCH_GRACE_MS));
    const goo = out.find((m) => m.t === "goo");
    expect(goo).toMatchObject({ k: "stick", s: 0, to: 1 });
    expect(goo.ox - goo.x).toBeCloseTo(STICK_APART, -1);
    for (const s of [0, 1]) expect(core.members[s]).toMatchObject({ fright: "stick", stunUntil: Math.ceil(touched + TOUCH_GRACE_MS) + STICK_MS });
  });

  it("meet at once when one goes hard or soft beside the other, and hard beside hard is nothing", () => {
    const core = setup(60);
    core.slime(1, "harden", 2000);
    core.slime(0, "harden", 2050);
    const soft = core.slime(0, "absorb", 2050 + HOLD_MS);
    expect(soft.relay.goo).toMatchObject({ t: "goo", k: "swallow", s: 0, to: 1 });
    const hh = setup(60);
    hh.slime(0, "harden", 2000);
    expect(hh.slime(1, "harden", 2000).relay.goo).toBeUndefined();
  });

  it("are judged as they were when they touched: an absorb over by the time the room counts it still swallowed", () => {
    const core = setup();
    core.slime(0, "harden", 2000);
    core.slime(0, "absorb", 2000 + HOLD_MS);
    core.slime(1, "harden", 2000 + HOLD_MS);
    const now = 2000 + HOLD_MS + 10;
    walk(core, 1, 640, -1, now);
    core.dueMoves(now);
    const touched = now + ((140 - GOO_REACH) / walkSpeed("slime")) * 1000;
    // Looked at only long after both had ended (a phone gone quiet, no wake in between).
    const out = core.dueMoves(now + HARDEN_MS + 2000);
    expect(out.find((m) => m.t === "goo")).toMatchObject({ k: "swallow" });
    expect(touched).toBeLessThan(now + HARDEN_MS);
  });

  it("do not stick a slime the room knocked inside the touch's grace: the knock stands", () => {
    // Sam and Sue both soft; Sam walks into Sue, the room holds the touch; Pat kicks Sam 50 ms later.
    const core = party(["Sam", "Sue", "Pat"]);
    be(core, 0, "slime");
    be(core, 1, "slime");
    place(core, 0, 500, 1500);
    place(core, 1, 640, 1500, -1);
    place(core, 2, 420, 1500, 1);
    for (const s of [0, 1]) {
      core.slime(s, "harden", 2000);
      core.slime(s, "absorb", 2000 + HOLD_MS);
    }
    const now = 2000 + HOLD_MS + 10;
    walk(core, 0, 500, 1, now);
    core.dueMoves(now);
    const touched = Math.ceil(now + ((140 - GOO_REACH) / walkSpeed("slime")) * 1000);
    core.dueMoves(touched + 1);
    expect(core.pending.map((p) => p.kind)).toEqual(["goo"]);
    const kickAt = touched + 50;
    Object.assign(core.members[2], { x: Math.round(posAt(core.members[0], kickAt) - 60), d: 0, t: kickAt, face: 1 });
    const kick = core.bump(2, kickAt, 1);
    expect(kick).toMatchObject({ to: 0 });
    const out = core.dueMoves(touched + TOUCH_GRACE_MS + 1);
    expect(out.find((m) => m.t === "goo")).toBeUndefined();
    expect(core.members[0]).toMatchObject({ x: kick.x, stunUntil: kickAt + STUN_MS });
    expect(core.members[0].fright ?? null).toBeNull();
  });

  it("never start on a slime already in a move: a stone mid-slide (no longer hard), or one just up", () => {
    // The stone: Pat's charged kick sends Sam sliding; Sue, hard beside where he will rest, goes soft mid-slide.
    const core = party(["Pat", "Sam", "Sue"]);
    be(core, 1, "slime");
    be(core, 2, "slime");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 390, 1500, -1);
    place(core, 2, 1000, 1500, -1);
    core.charge(0, 2000);
    core.slime(1, "harden", 2400);
    const now = 2000 + CHARGE_FULL_MS;
    const b = core.bump(0, now, 1, true);
    const stone = core.members[1];
    expect(b.cu).toBeDefined();
    expect(stone.hardUntil).toBe(now);
    Object.assign(core.members[2], { x: b.cu.x + 50, d: 0, t: now });
    core.slime(2, "harden", now + 50);
    const soft = core.slime(2, "absorb", now + 50 + HOLD_MS);
    expect(soft.relay?.goo).toBeUndefined();
    expect(stone).toMatchObject({ x: b.cu.x, fright: "curl" });
    // Just up from a knock (safe): a soft slime going soft beside it does not swallow it, as the room's own look would not.
    const up = party(["Sam", "Sue"]);
    be(up, 0, "slime");
    be(up, 1, "slime");
    place(up, 0, 500, 1500);
    place(up, 1, 560, 1500, -1);
    Object.assign(up.members[1], { stunUntil: 1900, immuneUntil: 5000 });
    up.slime(1, "harden", 2000);
    up.slime(0, "harden", 2000);
    expect(up.slime(0, "absorb", 2000 + HOLD_MS).relay?.goo).toBeUndefined();
    expect(up.members[1].fright ?? null).toBeNull();
  });
});

describe("ghosts that meet: two faded ghosts pop solid", () => {
  function setup() {
    const core = party(["Gus", "Gil"]);
    for (const s of [0, 1]) {
      be(core, s, "ghost");
      core.members[s].fadeAt = -Infinity;
    }
    place(core, 0, 500, 1500);
    place(core, 1, 620, 1500, -1);
    core.fade(0, 2000);
    core.fade(1, 2000);
    return core;
  }

  it("pops both solid where they are, with a little shock: each has its vote back", () => {
    const core = setup();
    walk(core, 0, 500, 1, 2100);
    core.dueMoves(2100);
    const out = core.dueMoves(2100 + 2000);
    const pop = out.find((m) => m.t === "pop");
    expect(pop).toMatchObject({ s: 0, to: 1 });
    for (const s of [0, 1]) {
      expect(core.faded(core.members[s], 4200)).toBe(false);
      expect(core.members[s].fright).toBe("pop");
    }
  });

  it("not when one of them is solid: a ghost never spooks a ghost", () => {
    const core = setup();
    core.members[1].fadedUntil = 2050;
    walk(core, 0, 500, 1, 2100);
    core.dueMoves(2100);
    expect(core.dueMoves(4100).some((m) => m.t === "pop" || m.t === "spook")).toBe(false);
    // And no page can make one: a boo at a ghost is refused.
    expect(core.boo(0, 1, 4100)).toMatchObject({ ok: false });
  });
});

describe("a held touch settled by the toucher's own word (found in review of #97)", () => {
  // The room holds a touch it saw for TOUCH_GRACE_MS; the toucher's next ordinary `m` (it walks on,
  // stops, turns) settles it. A stick, a swallow of the walker and a pop move the toucher itself:
  // the phone's word, sent before it heard of that, must not be written over where the room put it.
  const slimes = (gap = 140) => {
    const core = party(["Sam", "Sue"]);
    be(core, 0, "slime");
    be(core, 1, "slime");
    place(core, 0, 500, 1500);
    place(core, 1, 500 + gap, 1500, -1);
    return core;
  };
  /** Walks `seat` in direction `d` from `now` and returns the moment the room holds its first touch. */
  const hold = (core, seat, d, now, kind) => {
    walk(core, seat, core.members[seat].x, d, now);
    core.dueMoves(now);
    const touched = Math.ceil(core.nextTouch(now));
    expect(core.dueMoves(touched + 1)).toEqual([]);
    expect(core.pending.map((p) => p.kind)).toEqual([kind]);
    return touched;
  };

  for (const d of [1, 0, -1]) {
    it(`leaves a slime stuck by its own walk where the stick put it, whatever its phone then says (d: ${d})`, () => {
      const core = slimes();
      for (const s of [0, 1]) {
        core.slime(s, "harden", 2000);
        core.slime(s, "absorb", 2000 + HOLD_MS);
      }
      const touched = hold(core, 0, 1, 2000 + HOLD_MS + 10, "goo");
      const at = touched + 50;
      const sam = core.members[0];
      const out = core.move(0, { x: posAt(sam, at), d, r: sam.rev }, at);
      const goo = out.touches.find((m) => m.t === "goo");
      expect(goo).toMatchObject({ k: "stick", s: 0, to: 1 });
      // Only the touch is passed on: the phone's word was about a walk the room has just ended.
      expect(out.relay).toBeNull();
      expect(out.fix).toBeNull();
      expect(sam).toMatchObject({ x: goo.x, d: 0, t: at, rev: goo.rev, stunUntil: at + STICK_MS });
      // Nothing walks on: a second later the room still has it where every page was told.
      expect(posAt(sam, at + 1000)).toBe(goo.x);
    });
  }

  it("leaves a hard slime that walked into a soft one where it was spat out", () => {
    const core = slimes();
    core.slime(0, "harden", 2000);
    core.slime(0, "absorb", 2000 + HOLD_MS);
    core.slime(1, "harden", 2000 + HOLD_MS);
    const touched = hold(core, 1, -1, 2000 + HOLD_MS + 10, "goo");
    const at = touched + 50;
    const sue = core.members[1];
    const out = core.move(1, { x: posAt(sue, at), d: -1, r: sue.rev }, at);
    const goo = out.touches.find((m) => m.t === "goo");
    expect(goo).toMatchObject({ k: "swallow", s: 0, to: 1 });
    expect(out.relay).toBeNull();
    expect(sue).toMatchObject({ x: goo.x, d: 0, rev: goo.rev, stunUntil: at + SWALLOW_MS });
    expect(posAt(sue, at + 1000)).toBe(goo.x);
  });

  it("still takes the word of a soft slime that swallowed what it walked into: the swallow does not move it", () => {
    const core = slimes();
    core.slime(0, "harden", 2000);
    core.slime(0, "absorb", 2000 + HOLD_MS);
    core.slime(1, "harden", 2000 + HOLD_MS);
    const touched = hold(core, 0, 1, 2000 + HOLD_MS + 10, "goo");
    const at = touched + 50;
    const sam = core.members[0];
    const x = posAt(sam, at);
    const out = core.move(0, { x, d: 0, r: sam.rev }, at);
    expect(out.touches.find((m) => m.t === "goo")).toMatchObject({ k: "swallow", s: 0, to: 1 });
    expect(out.relay).toMatchObject({ t: "m", s: 0, d: 0, x: Math.round(x) });
    expect(sam).toMatchObject({ x, d: 0 });
  });

  it("leaves a faded ghost that drifted into another where the pop put it", () => {
    const core = party(["Gus", "Gil"]);
    for (const s of [0, 1]) {
      be(core, s, "ghost");
      core.members[s].fadeAt = -Infinity;
    }
    place(core, 0, 500, 1500);
    place(core, 1, 620, 1500, -1);
    core.fade(0, 2000);
    core.fade(1, 2000);
    const touched = hold(core, 0, 1, 2100, "spook");
    const at = touched + 50;
    const gus = core.members[0];
    const out = core.move(0, { x: posAt(gus, at), d: 1, v: 1, r: gus.rev }, at);
    const pop = out.touches.find((m) => m.t === "pop");
    expect(pop).toMatchObject({ s: 0, to: 1 });
    expect(out.relay).toBeNull();
    expect(gus).toMatchObject({ x: pop.x, d: 0, vt: null, rev: pop.rev, stunUntil: at + POP_MS });
    expect(posAt(gus, at + 1000)).toBe(pop.x);
  });
});

describe("the touch counters, drawn in both looks", () => {
  const piece = (seat, x) => ({ seat, rx: x, face: 1, net: { x, d: 0, t: 0 }, rev: 0, hook: null, goo: null });
  const flat = BumpDraw.prototype;
  const fx = { burst() {}, dust() {} };
  const looks = [
    ["flat", (p, x, at, kind) => flat.fright.call(fx, p, x, at, kind), (p, x, at) => flat.knock.call(fx, p, x, at), (p, now) => flat.pose.call(fx, p, now)],
    ["3D", startFright, startKnock, (p, now) => bumpPose(p, now)],
  ];

  it("stands a domino and the stone's target until the flight reaches them, then knocks them over; the stone slides off as the kick lands", () => {
    for (const [look, fright, knock, pose] of looks) {
      const pieces = new Map([[1, piece(1, 500)], [2, piece(2, 700)], [3, piece(3, 900)]]);
      heardKickCounters(pieces, { t: "b", s: 0, dm: { to: 1, x: 760, rev: 2, at: 300 }, cv: { to: 2, x: 950, rev: 2, at: 500 }, cu: { s: 3, x: 1300, rev: 3 } }, 1000, { fright, knock });
      expect(pose(pieces.get(1), 1000 + 200).x, look).toBe(500);
      expect(pose(pieces.get(1), 1000 + 300 + 100).state, look).toBe("flying");
      expect(pose(pieces.get(2), 1000 + 400).x, look).toBe(700);
      expect(pose(pieces.get(3), 1000 + 100).x, look).toBe(900);
      expect(pose(pieces.get(3), 1000 + IMPACT_MS + CURL_MS / 2).x, look).toBeGreaterThan(1000);
    }
  });

  it("draws the swallow, the stick and the pop on every piece they move", () => {
    for (const [look, fright, knock, pose] of looks) {
      const pieces = new Map([[0, piece(0, 500)], [1, piece(1, 620)]]);
      heardTouch(pieces, { t: "goo", k: "swallow", s: 0, to: 1, x: 404, rev: 3 }, 1000, { fright, knock });
      expect(pieces.get(1).fright.kind, look).toBe("swallowed");
      expect(pose(pieces.get(1), 1000 + SWALLOW_MS / 2).sx, look).toBeLessThan(0.6);
      const stuck = new Map([[0, piece(0, 500)], [1, piece(1, 560)]]);
      heardTouch(stuck, { t: "goo", k: "stick", s: 0, to: 1, x: 482, rev: 3, ox: 578, orev: 3 }, 1000, { fright, knock });
      expect(stuck.get(0).fright.kind, look).toBe("stick");
      expect(stuck.get(1).fright.kind, look).toBe("stick");
      const ghosts = new Map([[0, piece(0, 500)], [1, piece(1, 520)]]);
      ghosts.get(0).fadeUntil = 5000;
      heardTouch(ghosts, { t: "pop", s: 0, to: 1, x: 500, rev: 2, ox: 520, orev: 2 }, 1000, { fright, knock });
      expect(ghosts.get(0).fadeUntil, look).toBe(0);
      expect(pose(ghosts.get(1), 1000 + POP_MS / 3).lift, look).toBeGreaterThan(5);
    }
  });
});

describe("the touch counters on the real room", () => {
  beforeEach(useFakeRuntime);
  afterEach(dropFakeRuntime);

  async function room() {
    const r = await openRoom(createLobbyRoom, turnGame(), { players: { min: 1, max: 4 } });
    const { ctx, connect, say } = r;
    ctx.keepAlive = true;
    const tokens = [await ctx.room.create({ code: "BCDFGH", nickname: "Sam", as: "player" })];
    for (const name of ["Sue", "Pat"]) tokens.push(await ctx.room.join({ nickname: name, as: "player" }));
    const screen = await ctx.room.join({ as: "screen" });
    const ws = [];
    for (const t of tokens) ws.push(await connect(t.token));
    ws.screen = await connect(screen.token);
    await settle();
    say(ws[0], { t: "look", c: "slime" });
    say(ws[1], { t: "look", c: "slime" });
    await settle();
    await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
    return { ...r, ws, core: ctx.room.core };
  }
  const mark = (...sockets) => sockets.map((ws) => ws.frames.length);
  const since = (ws, n) => ws.messages().slice(n);

  it("tells every page of a swallow the room saw by itself, with no page saying so, and moves the spat slime's socket copy", async () => {
    const { ctx, say, ws, core } = await room();
    await walkTo(say, ctx, ws[0], 0, 500);
    await walkTo(say, ctx, ws[1], 1, 640);
    await walkTo(say, ctx, ws[2], 2, ROOM.maxX - 10);
    await settle();
    say(ws[0], { t: "slime", k: "harden" });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    say(ws[0], { t: "slime", k: "absorb" });
    say(ws[1], { t: "slime", k: "harden" });
    await settle();
    const before = mark(ws[0], ws[1], ws.screen);
    // Sue walks into Sam and her phone goes quiet.
    say(ws[1], { t: "m", x: core.members[1].x, d: -1, r: core.members[1].rev });
    await vi.advanceTimersByTimeAsync(1000);
    for (const [i, page] of [ws[0], ws[1], ws.screen].entries()) expect(since(page, before[i]).find((m) => m.t === "goo"), `page ${i}`).toMatchObject({ k: "swallow", s: 0, to: 1 });
    expect(ctx.room.sockets.get(ws[1]).kept.piece).toMatchObject({ x: core.members[1].x, rev: core.members[1].rev });
  });
});
