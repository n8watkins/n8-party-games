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
    const at = IMPACT_MS + curlReaches(dist, 260 - CURL_CONTACT);
    expect(b.cv).toMatchObject({ to: 2, at, x: knockLanding(650, 1, wall, lit) });
    expect(core.members[2].stunUntil).toBe(now + at - IMPACT_MS + STUN_MS);
    // The stone: past Bo, in the dark.
    expect(b.cu.x).toBe(knockLanding(390, 1, wall, lit, { distance: dist, least: 260 + CURL_CONTACT }));
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
