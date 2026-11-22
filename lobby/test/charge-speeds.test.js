// The pawn's charged kick and each character's speed (the owner's round three, "Pawn charged kick"
// and "Speeds"; lobby/shared/bump.js and world.js): their rules as numbers, the room's judgement
// of each (LobbyCore.charge, bump, move, and the touches a floaty ghost makes), what a page sends
// (shared/pilot.js) and draws (move-state.js, both looks), and on the real Durable Object class that
// a hand-written client cannot cheat any of it. And the leftovers from #69's last review: a held
// touch is judged as it was, a stale stop settles its touches, a refused touch is looked at again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { BumpDraw } from "../public/bump-draw.js";
import { bumpPose, startFright, startKnock } from "../public/look3d/pieces.js";
import { attackDrawn, heardCharge, heardChargedKick, resumeMoves, startCharge, startRelease } from "../public/move-state.js";
import {
  BUMP_COOLDOWN_MS, BUMP_REACH, CHARGE_DASH, CHARGE_DASH_MIN, CHARGE_DOWN_MS, CHARGE_FULL_MS, CHARGE_HOLD_MS, CHARGE_MIN_MS, COOLDOWN_SLACK_MS, GETUP_MS, IMMUNE_MS, IMPACT_MS, KICK_CONTACT, KNOCK_DISTANCE, STUN_MS, WINDUP_MS,
  attackPose, chargeBounce, chargeDash, chargePose, chargePower, chargeThrow, knockLanding, knockPose, knockState,
} from "../shared/bump.js";
import { LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { BIG_SCARE_MS, FADE_MS, SCARE_MS, SPOOK_REACH } from "../shared/ghost.js";
import { MOVED, TOUCH_GRACE_MS, slideLanding } from "../shared/moves.js";
import { Pilot } from "../shared/pilot.js";
import { HOOK_AIM_MS, HOOK_HOLD, HOOK_LATE_MS, PULL_MS } from "../shared/robot.js";
import { SHOVE_AHEAD, SHOVE_REACH, SHOVE_STEP } from "../shared/slime.js";
import { boxFromManifest } from "../shared/vote.js";
import {
  FLOAT_MS, JUMP_HEIGHT, LOW_JUMP_HEIGHT, POSITION_SLACK, ROOM, SPEED_SHARE, WALK_SPEED, jumpHeight, jumpTopOf, posAt, velAt, walkChanges, walkSpeed,
} from "../shared/world.js";
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

/** A room of seated, connected players at 1000 ms, on `wall` (one box by default). */
function party(names, wall = coinWall()) {
  const core = new LobbyCore({ ...wall, seed: 7, code: "BCDFGH", now: 1000 });
  for (const name of names) core.connect(core.join(name, 1000).token, 1000);
  return core;
}

/** Puts a seat's piece at x, standing, facing `face`, in steps the room believes. */
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

const walk = (core, seat, x, d, now, v) => core.move(seat, { x, d, r: core.members[seat].rev, ...(v === undefined ? {} : { v }) }, now);

/** The room's dark and lit places, for working out where it puts a piece. */
const lights = (core) => [core.landingWall(), core.litPlaces()];

/** A spot in the widest stretch of dark of the room's wall, with room for `span` to its right. */
function darkSpot(core, span = 400) {
  const [wall, lit] = lights(core);
  let best = null;
  let from = ROOM.minX;
  for (const p of [...wall.pools.filter((q) => lit.includes(q.i)), { x: ROOM.maxX + 1000, half: 0 }]) {
    const to = p.x - p.half - 40;
    if (!best || to - from > best[1] - best[0]) best = [from, to];
    from = p.x + p.half + 40;
  }
  expect(best[1] - best[0]).toBeGreaterThan(span);
  return Math.round(best[0] + 10);
}

describe("speeds, as numbers (round three, 'Speeds')", () => {
  it("are the owner's guesses: pawn 110%, robot 100%, ghost 95%, slime 80% of today's walking speed", () => {
    expect(SPEED_SHARE).toEqual({ pawn: 1.1, robot: 1, ghost: 0.95, slime: 0.8 });
    expect(walkSpeed("pawn")).toBeCloseTo(473);
    expect(walkSpeed("slime")).toBeCloseTo(344);
    // A character this page or room does not know walks at the old speed.
    expect(walkSpeed("dragon")).toBe(WALK_SPEED);
    expect(walkSpeed(undefined)).toBe(WALK_SPEED);
  });

  it("carry each piece forward at its own speed", () => {
    for (const c of ["pawn", "robot", "ghost", "slime"]) expect(posAt({ x: 500, d: 1, t: 1000, character: c }, 2000)).toBeCloseTo(500 + walkSpeed(c));
    expect(posAt({ x: 500, d: -1, t: 0 }, 1000, "slime")).toBeCloseTo(500 - walkSpeed("slime"));
    expect(posAt({ x: 500, d: 1, t: 0, character: "pawn" }, 60_000)).toBe(ROOM.maxX);
  });

  it("give the pawn the highest jump", () => {
    expect(jumpTopOf("pawn")).toBe(JUMP_HEIGHT);
    for (const c of ["robot", "ghost", "slime"]) expect(jumpTopOf(c)).toBe(LOW_JUMP_HEIGHT);
    expect(JUMP_HEIGHT).toBeGreaterThan(LOW_JUMP_HEIGHT * 1.15);
    expect(jumpHeight(260, jumpTopOf("pawn"))).toBeCloseTo(JUMP_HEIGHT);
    expect(jumpHeight(260, jumpTopOf("slime"))).toBeCloseTo(LOW_JUMP_HEIGHT);
  });
});

describe("the floaty ghost: slow to stop and to turn", () => {
  const ghost = (x, t, d, v) => ({ x, t, d, v, vt: t, character: "ghost" });
  const speed = walkSpeed("ghost");

  it("drifts on as it stops, easing to a stand in FLOAT_MS", () => {
    const g = ghost(500, 0, 0, 1);
    expect(velAt(g, 0)).toBe(1);
    expect(velAt(g, FLOAT_MS / 2)).toBeCloseTo(0.5);
    expect(velAt(g, FLOAT_MS)).toBe(0);
    const drift = (speed * FLOAT_MS) / 2000;
    expect(posAt(g, FLOAT_MS)).toBeCloseTo(500 + drift);
    expect(posAt(g, 5000)).toBeCloseTo(500 + drift);
    expect(drift).toBeGreaterThan(40);
    expect(drift).toBeLessThan(70);
  });

  it("takes twice as long to turn, sliding on before it comes back", () => {
    const g = ghost(900, 0, -1, 1);
    expect(velAt(g, FLOAT_MS)).toBeCloseTo(0);
    expect(velAt(g, 2 * FLOAT_MS)).toBe(-1);
    const furthest = posAt(g, FLOAT_MS);
    expect(furthest).toBeGreaterThan(900);
    expect(posAt(g, 2 * FLOAT_MS)).toBeCloseTo(900);
    expect(posAt(g, 2 * FLOAT_MS + 1000)).toBeCloseTo(900 - speed);
  });

  it("starts easing up from a stand, and only a ghost floats", () => {
    expect(posAt(ghost(500, 0, 1, 0), FLOAT_MS)).toBeCloseTo(500 + (speed * FLOAT_MS) / 2000);
    // A pawn with the same record goes at once (it never floats).
    expect(posAt({ x: 500, t: 0, d: 1, v: 0, vt: 0, character: "pawn" }, 100)).toBeCloseTo(500 + walkSpeed("pawn") / 10);
  });

  it("forgets a `v` from any other moment than its last word: the room or a page moved it since", () => {
    expect(posAt({ x: 500, t: 100, d: 0, v: 1, vt: 0, character: "ghost" }, 2000)).toBe(500);
    expect(posAt({ x: 500, t: 100, d: 0, v: 1, character: "ghost" }, 2000)).toBe(500);
  });

  it("names the moments its walk changes speed: the easing (in steps) and the wall", () => {
    const g = ghost(500, 0, 1, 0);
    const cuts = walkChanges(g, 4);
    expect(cuts.slice(0, 4)).toEqual([FLOAT_MS / 4, FLOAT_MS / 2, (3 * FLOAT_MS) / 4, FLOAT_MS]);
    expect(posAt(g, cuts[4])).toBeCloseTo(ROOM.maxX);
    expect(walkChanges({ x: 500, t: 0, d: 0 })).toEqual([]);
  });

  it("is reckoned the same way by its own page, the room and every other page", () => {
    const sent = [];
    const p = new Pilot({ lights: 1, send: (m) => sent.push(m), x: 600, character: "ghost" });
    p.step(0);
    p.steer(1, 100);
    for (let t = 116; t <= 900; t += 16) p.step(t);
    p.steer(0, 900);
    const stop = sent.at(-1);
    // Said as it stops: where, and that it still goes at full speed.
    expect(stop).toMatchObject({ d: 0, v: 1 });
    for (let t = 916; t <= 1500; t += 16) p.step(t);
    // The room carries it from that word, the same way.
    const core = party(["Gus"]);
    be(core, 0, "ghost");
    place(core, 0, 600, 50);
    core.move(0, { ...sent[0], r: core.members[0].rev }, 100);
    const relay = core.move(0, { ...stop, r: core.members[0].rev }, 900).relay;
    expect(relay).toMatchObject({ d: 0, v: 1 });
    expect(Math.abs(posAt(core.members[0], 1500) - p.x)).toBeLessThan(1);
    expect(core.view(1000).members[0].v).toBeGreaterThan(0);
    expect(core.view(1500).members[0].v).toBeUndefined();
  });

  it("takes no more than full speed from a phone, and nothing from a piece that is not a ghost", () => {
    const core = party(["Gus", "Pat"]);
    be(core, 0, "ghost");
    place(core, 0, 600, 1500);
    place(core, 1, 600, 1500);
    walk(core, 0, 600, 0, 2000, 7);
    expect(core.members[0].v).toBe(1);
    // The most a lying phone gains: the drift of a stop at full speed, inside what the room believes anyway.
    expect(posAt(core.members[0], 5000) - 600).toBeCloseTo((walkSpeed("ghost") * FLOAT_MS) / 2000);
    walk(core, 1, 600, 0, 2000, 1);
    expect(posAt(core.members[1], 5000)).toBe(600);
    expect(walk(core, 1, 600, 1, 2100, -1).relay.v).toBeUndefined();
  });

  it("carries its easing through a sleep (the socket's copy), and wakes standing where it would have stopped", () => {
    const core = party(["Gus"]);
    be(core, 0, "ghost");
    place(core, 0, 600, 1500);
    walk(core, 0, 600, 0, 2000, 1);
    expect(core.pieceOf(0)).toMatchObject({ x: 600, d: 0, v: 1, vt: 2000 });
    const woken = LobbyCore.restore(coinWall(), structuredClone(core.serialize()), 9000);
    expect(woken.members[0].x).toBeCloseTo(600 + (walkSpeed("ghost") * FLOAT_MS) / 2000);
    expect(woken.members[0].d).toBe(0);
    woken.resume(woken.members[0].token, core.pieceOf(0));
    expect(woken.members[0]).toMatchObject({ v: 1, vt: 2000 });
  });

  it("spooks what it drifts into as it stops, judged along the drift (the room's own look)", () => {
    const core = party(["Gus", "Bo"]);
    be(core, 0, "ghost");
    core.members[0].fadeAt = -Infinity;
    place(core, 0, 500, 1000);
    // Bo just past where a stand would leave the ghost, inside where its drift takes it.
    const drift = (walkSpeed("ghost") * FLOAT_MS) / 2000;
    place(core, 1, Math.round(600 + SPOOK_REACH + drift * 0.6), 1000);
    core.fade(0, 2000);
    walk(core, 0, 500, 1, 2000);
    core.dueMoves(2000);
    // It says it stops at 600, still at full speed: the room works out when the drift reaches Bo.
    const stopAt = 2000 + Math.round((100 / walkSpeed("ghost")) * 1000);
    walk(core, 0, 600, 0, stopAt, 1);
    const due = core.nextTouch(stopAt);
    expect(due).toBeGreaterThan(stopAt);
    expect(due).toBeLessThan(stopAt + FLOAT_MS);
    // Where the ghost is then, exactly a spook's reach from Bo (the easing followed in steps).
    expect(Math.abs(core.members[1].x - posAt(core.members[0], due) - SPOOK_REACH)).toBeLessThan(1);
    // Worked out from the phone's word, not said by it: held for the grace, then counted, the way the ghost drifted.
    expect(core.dueMoves(Math.ceil(due) + 1)).toEqual([]);
    const out = core.dueMoves(Math.ceil(due + TOUCH_GRACE_MS) + 1);
    expect(out).toEqual([expect.objectContaining({ t: "spook", s: 0, to: 1 })]);
    expect(out[0].x).toBeGreaterThan(core.members[0].x);
  });
});

describe("the charged kick, as numbers (round three, 'Pawn charged kick')", () => {
  it("is a tap below CHARGE_MIN_MS, and full after about a second", () => {
    expect(chargePower(CHARGE_MIN_MS - 1)).toBe(0);
    expect(chargePower(CHARGE_MIN_MS)).toBe(0);
    expect(chargePower(CHARGE_FULL_MS)).toBe(1);
    expect(chargePower(5000)).toBe(1);
    expect(CHARGE_FULL_MS).toBe(1000);
    expect(chargeDash(0)).toBe(CHARGE_DASH_MIN);
    expect(chargeDash(1)).toBe(CHARGE_DASH);
    expect(chargeThrow(1).distance).toBeGreaterThan(KNOCK_DISTANCE * 1.5);
    expect(chargeBounce(1)).toMatchObject({ down: CHARGE_DOWN_MS });
    expect(chargeBounce(1).reach.distance).toBe(KNOCK_DISTANCE * 2);
  });

  it("draws the charge held back further and glowing more as it grows, and still with less motion", () => {
    const early = chargePose(CHARGE_MIN_MS, 1);
    const full = chargePose(CHARGE_FULL_MS + 200, 1);
    expect(early).toMatchObject({ state: "charging", charge: 0 });
    expect(full.charge).toBe(1);
    expect(full.lift).toBeGreaterThan(early.lift);
    expect(full.tilt).toBeGreaterThan(early.tilt);
    const calm = chargePose(CHARGE_FULL_MS + 200, 1, true);
    expect(calm.charge).toBe(1);
    expect(calm.lift).toBe(full.lift);
    expect(chargePose(CHARGE_FULL_MS + 217, 1, true).dx).toBe(calm.dx);
  });

  it("draws a released charge dashing from where it stood to where the room put it, then kicking there", () => {
    const lunge = { from: 500, to: 620, power: 1 };
    expect(attackPose(0, 1, true, lunge)).toMatchObject({ state: "dashing", x: 500 });
    expect(attackPose(WINDUP_MS / 2, 1, true, lunge).x).toBeGreaterThan(530);
    expect(attackPose(WINDUP_MS / 2, 1, true, lunge).x).toBeLessThan(590);
    for (const ms of [WINDUP_MS + 1, IMPACT_MS + 20, IMPACT_MS + 200]) expect(attackPose(ms, 1, true, lunge).x).toBe(620);
    expect(attackPose(5000, 1, true, lunge).state).toBe("idle");
    expect(attackPose(50, 1, true).x).toBeUndefined();
  });

  it("keeps a bounced kicker down CHARGE_DOWN_MS longer, in the drawing as in the room", () => {
    expect(knockState(STUN_MS + 10, IMMUNE_MS, 400)).toBe("down");
    expect(knockState(STUN_MS + 400 - GETUP_MS + 10, IMMUNE_MS, 400)).toBe("rising");
    expect(knockState(STUN_MS + 400 + 10, IMMUNE_MS, 400)).toBe("safe");
    expect(knockPose(STUN_MS + 400, 600, 300, IMMUNE_MS, 400).tilt).toBe(0);
  });
});

describe("the room's judgement of a charged kick", () => {
  /** Pat (a pawn) charging at `x`, with Bo `gap` in front of him, in the dark. */
  function setup(gap, others = ["Bo"]) {
    const core = party(["Pat", ...others]);
    const x = darkSpot(core, gap + 400);
    place(core, 0, x, 1000);
    place(core, 1, x + gap, 1000);
    return { core, x };
  }

  it("stops the pawn where it charges, tells everybody, and times the hold by its own clock", () => {
    const { core, x } = setup(200);
    walk(core, 0, x, 1, 1500);
    const out = core.charge(0, 1600);
    expect(out).toMatchObject({ ok: true, relay: { t: "kc", s: 0, f: 1 } });
    expect(Math.abs(out.relay.x - posAt({ x, d: 1, t: 1500, character: "pawn" }, 1600))).toBeLessThan(1);
    expect(core.members[0].d).toBe(0);
    expect(core.view(1700).members[0].charge).toBe(100 + CHARGE_MIN_MS);
    // Released 820 ms later: full power, however the phone says it.
    const b = core.bump(0, 1600 + 820, true);
    expect(b.c).toBe(1);
    expect(core.view(2500).members[0].charge).toBeUndefined();
  });

  it("dashes up to the piece it reaches, out of a kick's reach, and throws it further than a kick", () => {
    const { core, x } = setup(BUMP_REACH + 60);
    // A tap does not reach Bo.
    expect(core.bump(0, 2000)).toMatchObject({ to: -1 });
    core.charge(0, 2000 + BUMP_COOLDOWN_MS);
    const now = 2000 + BUMP_COOLDOWN_MS + 600;
    const b = core.bump(0, now, true);
    const power = chargePower(600 + CHARGE_MIN_MS);
    expect(b).toMatchObject({ t: "b", s: 0, to: 1, c: Math.round(power * 100) / 100 });
    expect(b.kx).toBe(Math.round(x + Math.min(chargeDash(power), BUMP_REACH + 60 - KICK_CONTACT)));
    expect(core.members[0]).toMatchObject({ x: b.kx, rev: b.kr });
    const [wall, lit] = lights(core);
    expect(b.x).toBe(knockLanding(x + BUMP_REACH + 60, 1, wall, lit, chargeThrow(power)));
    expect(b.x - (x + BUMP_REACH + 60)).toBeGreaterThan(KNOCK_DISTANCE);
  });

  it("dashes the whole way when it reaches nobody, and never into a light it does not stand in", () => {
    const core = party(["Pat", "Bo"]);
    const [wall, lit] = lights(core);
    const pool = wall.pools.find((p) => lit.includes(p.i));
    // Just left of a lit pool, facing it: the dash stops short of the light.
    const edge = Math.round(pool.x - pool.half - 50);
    place(core, 0, edge, 1500);
    place(core, 1, ROOM.maxX - 10, 1500);
    core.charge(0, 2000);
    const b = core.bump(0, 2000 + CHARGE_FULL_MS, true);
    expect(b.to).toBe(-1);
    expect(b.kx).toBe(slideLanding(edge, edge + CHARGE_DASH, wall, lit));
    expect(b.kx).toBeLessThan(pool.x - pool.half);
  });

  it("is punished harder by a hardened slime: thrown back further and down longer", () => {
    const { core, x } = setup(90, ["Cy"]);
    be(core, 1, "slime");
    core.charge(0, 2000);
    core.slime(1, "harden", 2300);
    const b = core.bump(0, 2000 + CHARGE_FULL_MS, true);
    const [wall, lit] = lights(core);
    expect(b).toMatchObject({ to: -1, bo: 1, c: 1, ke: CHARGE_DOWN_MS });
    expect(b.x).toBe(knockLanding(b.kx, -1, wall, lit, chargeBounce(1).reach));
    expect(core.members[0].stunUntil).toBe(2000 + CHARGE_FULL_MS + STUN_MS + CHARGE_DOWN_MS);
    expect(core.view(2000 + CHARGE_FULL_MS + 100).members[0]).toMatchObject({ ke: CHARGE_DOWN_MS });
    // A tap bounces as before.
    const tap = setup(90, ["Cy"]).core;
    be(tap, 1, "slime");
    tap.slime(1, "harden", 2000);
    expect(tap.bump(0, 2100)).toMatchObject({ bo: 1 });
    expect(tap.members[0].stunUntil).toBe(2100 + STUN_MS);
    expect(x).toBeGreaterThan(0);
  });

  it("is punished harder by a faded ghost: frozen longer, and as far as the charge would throw", () => {
    const { core } = setup(100, ["Gus"]);
    be(core, 1, "ghost");
    core.members[1].fadeAt = -Infinity;
    core.charge(0, 2000);
    core.fade(1, 2200);
    const now = 2000 + CHARGE_FULL_MS;
    const b = core.bump(0, now, true);
    expect(b).toMatchObject({ to: -1, sc: 1, c: 1 });
    expect(core.members[0]).toMatchObject({ stunUntil: now + BIG_SCARE_MS, fright: "bigscare" });
    expect(BIG_SCARE_MS).toBeGreaterThan(SCARE_MS + 400);
    expect(core.view(now + 100).members[0].fright).toBe("bigscare");
    expect(MOVED.bigscare.ms).toBe(BIG_SCARE_MS);
  });

  it("cannot be made harder than the room timed it: a release with no charge, or one held too long ago, is a tap", () => {
    const { core } = setup(BUMP_REACH + 60);
    // A phone that says `c` without charging first: a tap.
    expect(core.bump(0, 2000, true)).toMatchObject({ to: -1 });
    expect(core.bump(0, 2000, true)?.c).toBeUndefined();
    // A charge the room heard the release of only long after (a phone that stalled): a tap.
    core.charge(0, 2000 + BUMP_COOLDOWN_MS);
    const late = core.bump(0, 2000 + BUMP_COOLDOWN_MS + CHARGE_HOLD_MS + COOLDOWN_SLACK_MS + 50, true);
    expect(late.c).toBeUndefined();
    expect(late.to).toBe(-1);
  });

  it("refuses a charge to the sender: not a pawn, cooling, down, twice, or not the room's own time", () => {
    const core = party(["Pat", "Rob"]);
    be(core, 1, "robot");
    expect(core.charge(1, 2000)).toMatchObject({ ok: false, bad: true });
    core.bump(0, 2000);
    expect(core.charge(0, 2100)).toMatchObject({ ok: false, cooling: true });
    expect(core.charge(0, 2000 + BUMP_COOLDOWN_MS - 400)).toMatchObject({ ok: false, cooling: true, bad: false });
    expect(core.charge(0, 2000 + BUMP_COOLDOWN_MS)).toMatchObject({ ok: true });
    expect(core.charge(0, 2000 + BUMP_COOLDOWN_MS + 100)).toMatchObject({ ok: false, why: "Already winding up." });
    // Knocked over meanwhile: it cannot charge until it is up.
    const down = party(["Pat", "Bo"]);
    place(down, 0, 400, 1000);
    place(down, 1, 460, 1000, -1);
    down.bump(1, 2000);
    expect(down.charge(0, 2100)).toMatchObject({ ok: false });
    // A game on: not the pieces' time.
    const game = party(["Pat", "Bo"]);
    game.startGame("coin-flip", 2000);
    expect(game.charge(0, 2100)).toMatchObject({ ok: false });
  });

  it("is lost when the pawn walks, is knocked, pulled or drops: its release is a plain kick", () => {
    for (const [what, interrupt] of [
      ["walks", (core, now) => walk(core, 0, core.members[0].x, 1, now)],
      ["is knocked", (core, now) => core.bump(1, now)],
      ["drops", (core, now) => core.disconnect(core.members[0].token, now)],
    ]) {
      const { core } = setup(BUMP_REACH - 20);
      core.members[1].face = -1;
      core.charge(0, 2000);
      interrupt(core, 2300);
      expect(core.members[0].chargeAt ?? null, what).toBeNull();
      expect(core.view(2400).members[0].charge, what).toBeUndefined();
    }
    // Pulled by a robot's hook mid-charge.
    const { core, x } = setup(250, ["Rob"]);
    be(core, 1, "robot");
    place(core, 1, x + 250, 1500, -1);
    core.charge(0, 2000);
    core.hook(1, 2000);
    for (let t = 2000; t <= 2000 + HOOK_AIM_MS + 400; t += 5) core.dueHooks(t);
    expect(core.members[0].fright).toBe("pull");
    expect(core.members[0].chargeAt ?? null).toBeNull();
    expect(core.bump(0, 2000 + HOOK_AIM_MS + PULL_MS + 600, true)?.c).toBeUndefined();
  });

  it("is forgotten when a game starts, and the room does not wake for it", () => {
    const { core } = setup(300);
    core.charge(0, 2000);
    const wake = core.nextWake(2000);
    // Nothing in the room's wake-ups comes from the charge (no alarm for a held button).
    core.members[0].chargeAt = null;
    expect(core.nextWake(2000)).toBe(wake);
    core.charge(0, 2000 + BUMP_COOLDOWN_MS);
    core.startGame("coin-flip", 2000 + BUMP_COOLDOWN_MS + 100);
    expect(core.view(2000 + BUMP_COOLDOWN_MS + 200).members[0].charge).toBeUndefined();
    expect(core.bump(0, 2000 + BUMP_COOLDOWN_MS + 300, true)).toBeNull();
  });

  it("bats a hook away on its release, as a kick does", () => {
    const { core, x } = setup(250, ["Rob"]);
    be(core, 1, "robot");
    place(core, 1, x + 250, 1500, -1);
    core.charge(0, 1700);
    core.hook(1, 2000);
    // The hook reaches Pat about HOOK_AIM_MS + 120 ms on: Pat lets go 100 ms before.
    core.bump(0, 2000 + HOOK_AIM_MS + 40, true);
    const out = [];
    for (let t = 2000; t <= 2000 + HOOK_AIM_MS + 400 + HOOK_LATE_MS; t += 5) out.push(...core.dueHooks(t));
    expect(out.find((m) => m.t === "hk")).toMatchObject({ o: "parry" });
  });

  it("settles two pawns charging into each other by which release the room hears first, either way round", () => {
    for (const first of [0, 1]) {
      const core = party(["Pat", "Sue"]);
      const x = darkSpot(core, 600);
      place(core, 0, x, 1000, 1);
      place(core, 1, x + 220, 1000, -1);
      core.charge(0, 2000);
      core.charge(1, 2000);
      const a = core.bump(first, 2600, true);
      const b = core.bump(1 - first, 2600, true);
      expect(a).toMatchObject({ s: first, to: 1 - first });
      // The other is on the floor: its release does nothing (the room keeps it down).
      expect(b).toBeNull();
      expect(core.members[1 - first].stunUntil).toBe(2600 + STUN_MS);
    }
  });
});

describe("what a page sends for the charged kick (shared/pilot.js)", () => {
  it("charges, stands still, and lets go with `c`; a knock loses the charge", () => {
    const sent = [];
    const p = new Pilot({ lights: 1, send: (m) => sent.push(m), x: 500 });
    p.step(0);
    p.steer(1, 10);
    expect(p.charge(200)).toBe(true);
    expect(sent.slice(-2)).toEqual([expect.objectContaining({ t: "m", d: 0 }), { t: "kc" }]);
    p.steer(1, 300);
    expect(p.d).toBe(0);
    expect(p.charge(300)).toBe(false);
    expect(p.bump(900)).toBe(true);
    expect(sent.at(-1)).toEqual({ t: "b", c: 1 });
    // Walks again, and the next press is a tap once its cooldown is over.
    p.steer(1, 950);
    expect(p.d).toBe(1);
    expect(p.mayKick(900 + BUMP_COOLDOWN_MS - 10)).toBe(false);
    expect(p.mayKick(900 + BUMP_COOLDOWN_MS)).toBe(true);
    expect(p.charge(900 + BUMP_COOLDOWN_MS)).toBe(true);
    p.knock(700, 3, 900 + BUMP_COOLDOWN_MS + 100);
    expect(p.chargeAt).toBeNull();
    p.bump(900 + BUMP_COOLDOWN_MS + STUN_MS + 200);
    expect(sent.at(-1)).toEqual({ t: "b" });
  });

  it("walks at its character's speed from the moment it changes character", () => {
    const p = new Pilot({ lights: 1, send: () => {}, x: 500, character: "slime" });
    p.step(0);
    p.steer(1, 0);
    p.step(1000);
    expect(p.x).toBeCloseTo(500 + walkSpeed("slime"));
    p.setCharacter("pawn", 1000);
    p.step(2000);
    expect(p.x).toBeCloseTo(500 + walkSpeed("slime") + walkSpeed("pawn"));
  });
});

describe("the charged kick, drawn in both looks (move-state.js)", () => {
  const piece = (x = 500) => ({ seat: 1, rx: x, face: 1, net: { x, d: 0, t: 0 }, rev: 0, attack: null, g: { parentNode: null } });

  it("draws everyone's charge from the room's word, and the release dashing to where the room put it", () => {
    const pieces = new Map([[1, piece()]]);
    heardCharge(pieces, 0, { t: "kc", s: 1, f: 1, x: 510 }, 1000);
    const p = pieces.get(1);
    expect(p.net).toMatchObject({ x: 510, d: 0 });
    expect(attackDrawn(p, 1000 + 500, false)).toMatchObject({ state: "charging" });
    expect(attackDrawn(p, 1000 + 500, false).charge).toBeGreaterThan(0.5);
    p.rx = 510;
    const began = heardChargedKick(p, { t: "b", s: 1, f: 1, c: 0.8, kx: 620, kr: 4, to: 2 }, 1700, false);
    expect(began).toBe(1700);
    expect(p.rev).toBe(4);
    expect(attackDrawn(p, 1700 + WINDUP_MS / 2, false).x).toBeGreaterThan(520);
    expect(attackDrawn(p, 1700 + IMPACT_MS + 10, false).x).toBe(620);
  });

  it("draws the viewer's own charge from its press, and its dash at once, ending where the room says", () => {
    const p = piece();
    p.attack = { at: 1000, dir: 1, landed: false };
    startCharge(p, 1000 + CHARGE_MIN_MS);
    expect(p.attack).toMatchObject({ at: 1000, charging: true });
    startRelease(p, 1, 1900, 650);
    expect(attackDrawn(p, 1900, false)).toMatchObject({ state: "dashing", x: 500 });
    heardChargedKick(p, { t: "b", s: 0, f: 1, c: 1, kx: 610, kr: 2, to: -1 }, 1950, true);
    expect(attackDrawn(p, 1900 + IMPACT_MS + 10, false).x).toBe(610);
  });

  it("puts away a charge the room says is over, and one it never hears the release of", () => {
    const p = piece();
    resumeMoves(p, { charge: 400 }, 1000);
    expect(p.attack).toMatchObject({ at: 600, charging: true });
    resumeMoves(p, {}, 1200);
    expect(p.attack).toBeNull();
    resumeMoves(p, { charge: 400 }, 1000);
    expect(attackDrawn(p, 1000 + CHARGE_HOLD_MS + 2000, false)).toBeNull();
  });

  it("puts a knocked or frightened kicker's charge away in both looks, and draws its kick where it dashed to until the blow", () => {
    // The flat look's drawing, without a page: its own methods, with the bursts and dust it would draw left out.
    const bumps = { burst() {}, dust() {} };
    const flat = BumpDraw.prototype;
    for (const [look, knock, fright, pose] of [
      ["flat", (p, to, at, extra, from) => flat.knock.call(bumps, p, to, at, extra, from), (p, to, at, kind, from) => flat.fright.call(bumps, p, to, at, kind, from), (p, now) => flat.pose.call(bumps, p, now)],
      ["3D", startKnock, startFright, (p, now) => bumpPose(p, now)],
    ]) {
      const p = piece();
      p.attack = { at: 900, dir: 1, landed: false, charging: true };
      knock(p, 300, 1000, 0, 500);
      expect(p.attack, look).toBeNull();
      // A bounced charged kick: its dash and kick drawn first, at where it dashed to, then the knock back.
      const q = piece(500);
      startRelease(q, 1, 2000, 600);
      knock(q, 250, 2000, CHARGE_DOWN_MS, 600);
      expect(pose(q, 2000 + WINDUP_MS / 2).x, look).toBeGreaterThan(520);
      expect(pose(q, 2000 + IMPACT_MS - 10).x, look).toBe(600);
      expect(pose(q, 2000 + STUN_MS + CHARGE_DOWN_MS - GETUP_MS - 20).state, look).toBe("down");
      // A charged kick into a faded ghost: frozen in its big scare.
      const r = piece(500);
      fright(r, 200, 3000, "bigscare", 600);
      expect(pose(r, 3000 + IMPACT_MS + 200 + 700).scared, look).toBe(1);
    }
  });
});

describe("leftovers from #69's last review", () => {
  /** The room knocks a piece down where it stands, as a kick does (a new rev: its phone's older words are out of date). */
  const knockDown = (core, seat, t) => {
    core.throwPiece(core.members[seat], -1, t);
    Object.assign(core.members[seat], { stunUntil: t + STUN_MS, immuneUntil: t + STUN_MS + IMMUNE_MS, fright: null });
  };

  it("judges a held shove as it was: a slime whose phone drops inside the grace still pushes once, as a stalled one does", () => {
    for (const [what, after] of [
      ["drops", (core, t) => core.disconnect(core.members[0].token, t)],
      // As a kick from behind does it (LobbyCore.bump): thrown back and down.
      ["is knocked down", (core, t) => knockDown(core, 0, t)],
    ]) {
      const core = party(["Sam", "Bo"]);
      be(core, 0, "slime");
      place(core, 0, 600, 1000);
      place(core, 1, 760, 1000);
      walk(core, 0, 600, 1, 2000);
      core.dueMoves(2000);
      const touched = 2000 + ((760 - SHOVE_REACH - 600) / walkSpeed("slime")) * 1000;
      expect(core.dueMoves(Math.round(touched + 30))).toEqual([]);
      after(core, Math.round(touched + 60));
      expect(core.members[0].d, what).toBe(0);
      const out = core.dueMoves(Math.ceil(touched + TOUCH_GRACE_MS));
      // A step on (where that is not in another light), as the slime's own shove at the touch would have pushed him.
      const [wall, lit] = lights(core);
      expect(out.filter((m) => m.t === "shove"), what).toEqual([expect.objectContaining({ s: 0, to: 1, x: slideLanding(760, 760 + SHOVE_STEP, wall, lit) })]);
      expect(core.dueMoves(Math.ceil(touched + 3000)).filter((m) => m.t === "shove"), what).toEqual([]);
    }
  });

  it("settles a held touch at once on a stop sent before the phone heard the room move its slime", () => {
    const touched = 2000 + ((760 - SHOVE_REACH - 600) / walkSpeed("slime")) * 1000;
    const setup = () => {
      const core = party(["Sam", "Bo"]);
      be(core, 0, "slime");
      place(core, 0, 600, 1000);
      place(core, 1, 760, 1000);
      walk(core, 0, 600, 1, 2000);
      core.dueMoves(2000);
      core.dueMoves(Math.round(touched + 20));
      expect(core.pending).toHaveLength(1);
      const rev = core.members[0].rev;
      // The room moves Sam (a new rev); Sam's phone, not yet told, then says where it stopped.
      knockDown(core, 0, Math.round(touched + 40));
      expect(core.members[0].rev).toBe(rev + 1);
      return { core, rev };
    };
    // Past the touch: it counts now, on that word.
    const { core, rev } = setup();
    const out = core.move(0, { x: 700, d: 0, r: rev }, Math.round(touched + 60));
    expect(out).toMatchObject({ relay: null, fix: null, touches: [expect.objectContaining({ t: "shove", to: 1 })] });
    expect(core.pending).toHaveLength(0);
    // Short of it: dropped at once, not counted at the end of the grace.
    const short = setup();
    expect(short.core.move(0, { x: 680, d: 0, r: short.rev }, Math.round(touched + 60))).toBeNull();
    expect(short.core.pending).toHaveLength(0);
    expect(short.core.dueMoves(Math.ceil(touched + 2000)).filter((m) => m.t === "shove")).toEqual([]);
  });

  it("does not mark a refused touch as touching: the pair is looked at again while they stay in reach", () => {
    const core = party(["Sam", "Bo", "Pat"]);
    be(core, 0, "slime");
    place(core, 0, 600, 1000);
    place(core, 1, 760, 1000);
    place(core, 2, 840, 1000, -1);
    walk(core, 0, 600, 1, 2000);
    const touched = 2000 + ((760 - SHOVE_REACH - 600) / walkSpeed("slime")) * 1000;
    core.dueMoves(2000);
    core.dueMoves(Math.round(touched + 20));
    expect(core.pending).toHaveLength(1);
    // The room moves Bo itself before the held touch counts (Pat's kick): the touch is refused, not shoved on top.
    const kicked = core.bump(2, Math.round(touched + 40));
    expect(kicked.to).toBe(1);
    expect(core.dueMoves(Math.ceil(touched + TOUCH_GRACE_MS)).filter((m) => m.t === "shove")).toEqual([]);
    expect(core.members[1].x).toBe(kicked.x);
    expect(core.touching.has("0>1")).toBe(false);
  });

  it("never counts a touch at a moment it may not happen, however many reasons push it on", () => {
    // Bo is down, then safe, then shoved a moment ago, then up on robot legs, each ending as the
    // next begins: the touch is when the last ends, or nothing.
    const core = party(["Sam", "Bo"]);
    be(core, 0, "slime");
    be(core, 1, "robot");
    place(core, 0, 600, 1000);
    place(core, 1, 760, 1000);
    const m = core.members[1];
    Object.assign(m, { stunUntil: 2100, immuneUntil: 2200, shovedUntil: 2300, stiltAt: 2300, stiltsUntil: 2400 });
    walk(core, 0, 600, 1, 2000);
    const t = core.touchOf("shove", core.members[0], m, 2000, 4000);
    expect(t).toBeGreaterThanOrEqual(2400);
    expect(core.touchedFrom("shove", core.members[0], m, t)).toBeLessThanOrEqual(t);
  });
});

describe("the charged kick on the real room", () => {
  beforeEach(useFakeRuntime);
  afterEach(dropFakeRuntime);

  /** Pat and Bo (pawns), and a screen, on the real room. */
  async function room() {
    const r = await openRoom(createLobbyRoom, turnGame(), { players: { min: 1, max: 4 } });
    const { ctx, connect, say } = r;
    ctx.keepAlive = true;
    const tokens = [await ctx.room.create({ code: "BCDFGH", nickname: "Pat", as: "player" }), await ctx.room.join({ nickname: "Bo", as: "player" })];
    const screen = await ctx.room.join({ as: "screen" });
    const ws = [];
    for (const t of tokens) ws.push(await connect(t.token));
    ws.screen = await connect(screen.token);
    await settle();
    const strikes = (i) => ctx.room.sockets.get(ws[i]).bucket.strikes;
    return { ...r, ws, strikes, core: ctx.room.core };
  }
  const mark = (...sockets) => sockets.map((ws) => ws.frames.length);
  const since = (ws, n) => ws.messages().slice(n);

  it("tells every page of a charge and of the charged kick, and moves the kicker's socket copy", async () => {
    const { ctx, say, ws, core } = await room();
    const x = darkSpot(core, 500);
    await walkTo(say, ctx, ws[0], 0, x);
    await walkTo(say, ctx, ws[1], 1, x + 220);
    say(ws[0], { t: "m", x, d: 1, r: core.members[0].rev });
    say(ws[0], { t: "m", x, d: 0, r: core.members[0].rev });
    await settle();
    const before = mark(ws[0], ws[1], ws.screen);
    say(ws[0], { t: "kc" });
    await settle();
    for (const [i, page] of [ws[0], ws[1], ws.screen].entries()) expect(since(page, before[i]).find((m) => m.t === "kc")).toMatchObject({ t: "kc", s: 0, x });
    await vi.advanceTimersByTimeAsync(CHARGE_FULL_MS);
    say(ws[0], { t: "b", c: 1 });
    await settle();
    for (const [i, page] of [ws[0], ws[1], ws.screen].entries()) expect(since(page, before[i]).find((m) => m.t === "b")).toMatchObject({ s: 0, to: 1, c: 1 });
    const b = since(ws.screen, before[2]).find((m) => m.t === "b");
    expect(ctx.room.sockets.get(ws[0]).kept.piece).toMatchObject({ x: b.kx, rev: b.kr });
  });

  it("refuses a charge to the sender only, and counts a script's against its socket", async () => {
    const { say, ws, core, strikes } = await room();
    say(ws[0], { t: "b" });
    await settle();
    const before = mark(ws[0], ws[1]);
    const struck = strikes(0);
    say(ws[0], { t: "kc" });
    await settle();
    expect(since(ws[0], before[0]).find((m) => m.t === "kc-no")).toMatchObject({ why: "Not ready yet." });
    expect(since(ws[1], before[1]).some((m) => m.t === "kc" || m.t === "kc-no")).toBe(false);
    expect(strikes(0)).toBeGreaterThan(struck);
    expect(core.members[0].chargeAt ?? null).toBeNull();
  });
});
