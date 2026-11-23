// The hook's counters (the owner's round three, "Counters"; lobby/shared/robot.js): plant, ride the
// hook, cannonball, empty hook, cut the line, steal and tug of war. Their rules as numbers, the
// room's judgement of each (LobbyCore.judgeHook, bump, slime, fade), the two limits on all of them
// (a counter can be countered once, then it resolves; the windows are about a third of a second),
// what a page sends and draws, with every light on (nobody comes to rest in a light they never stood
// in), across a drop, a silent phone and a room switch, and on the real Durable Object class that
// each reaches every page and that a hand-written client cannot counter a pull that is not its own.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { BumpDraw } from "../public/bump-draw.js";
import { bumpPose, startFright, startKnock } from "../public/look3d/pieces.js";
import { heardCannon, heardCut, heardEmpty, heardVerdict } from "../public/move-state.js";
import { BUMP_REACH, IMPACT_MS, STUN_MS, knockLanding } from "../shared/bump.js";
import { LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { FADE_MS, SPOOK_LANDING, SPOOK_MS } from "../shared/ghost.js";
import { MOVED, slideLanding } from "../shared/moves.js";
import { Pilot } from "../shared/pilot.js";
import {
  COUNTER_LAG_MS, COUNTER_LATE_MS, COUNTER_WINDOW_MS, FREED_MS, HOOK_AIM_MS, HOOK_HOLD, PULL_MS, TUG_HOLD_MS, TUG_MS,
  chainInReach, counterable, freedPose, hookDrawn, pullAt, pullEase, tugPose,
} from "../shared/robot.js";
import { HARDEN_MS } from "../shared/slime.js";
import { boxFromManifest } from "../shared/vote.js";
import { POSITION_SLACK, ROOM, lightAt, posAt, wallOf } from "../shared/world.js";
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

/** A room of seated, connected players at 1000 ms (one box: its light is off for these tests' places, right of the room). */
function party(names) {
  const core = new LobbyCore({ ...coinWall(), seed: 7, code: "BCDFGH", now: 1000 });
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

/** Wakes the room every 5 ms from `from` to `to`, as its alarm would, and gathers what came of the hooks (and the moves it ended by itself). */
function run(core, from, to) {
  const out = [];
  for (let t = from; t <= to; t += 5) out.push(...[...core.dueHooks(t), ...core.drainMoves()].map((m) => ({ ...m, at: t })));
  return out;
}

/** Runs the room until the hook of seat `s` is judged; returns its word and when it came ({hk, at}). */
function judged(core, s, from) {
  for (let t = from; t <= from + 2000; t += 5) {
    const hk = core.dueHooks(t).find((m) => m.s === s);
    if (hk) return { hk, at: t };
  }
  return { hk: null, at: null };
}

/** The lit pools are off here: the coin wall's one box is lit, and these places keep clear of it, or the tests say so. */
const lights = (core) => [core.landingWall(), core.litPlaces()];

/** Rob (a robot) at 300 facing right throws his hook at seat 1, standing at 520. Returns when the room pulled it. */
function pulled(core, character = "pawn", now = 2000) {
  be(core, 0, "robot");
  be(core, 1, character);
  place(core, 0, 300, 1500, 1);
  place(core, 1, 520, 1500, -1);
  core.hook(0, now);
  const { hk, at } = judged(core, 0, now);
  expect(hk).toMatchObject({ o: "pull", to: 1 });
  return { hk, at };
}

describe("the hook's counters, as numbers", () => {
  it("keep every window about a third of a second: the pull and a moment after it", () => {
    expect(PULL_MS + COUNTER_LATE_MS).toBeGreaterThan(300);
    expect(PULL_MS + COUNTER_LATE_MS).toBeLessThan(420);
    expect(TUG_MS).toBeLessThan(200);
    // The player's window, on the clock of the phone that heard the pull; the room allows a round
    // trip of up to 300 ms more on its own clock, the same for every counter.
    expect(COUNTER_LAG_MS).toBeGreaterThanOrEqual(300);
    expect(COUNTER_WINDOW_MS).toBe(PULL_MS + COUNTER_LATE_MS + COUNTER_LAG_MS);
  });

  it("follow a pulled piece along its pull, eased as every page draws it", () => {
    const pull = { from: 500, to: 300, at: 1000 };
    expect(pullAt(pull, 900)).toBe(500);
    expect(pullAt(pull, 1000 + PULL_MS / 2)).toBeCloseTo(500 - 200 * pullEase(0.5));
    expect(pullAt(pull, 5000)).toBe(300);
  });

  it("let a pull be countered while it is in the air and a moment after, once, if nothing has moved the piece since", () => {
    const piece = { rev: 3, pull: { by: 0, from: 500, to: 300, at: 1000, rev: 3, countered: false } };
    expect(counterable(piece, 1000)).toBe(true);
    expect(counterable(piece, 1000 + COUNTER_WINDOW_MS)).toBe(true);
    expect(counterable(piece, 1000 + COUNTER_WINDOW_MS + 1)).toBe(false);
    expect(counterable({ ...piece, rev: 4 }, 1100)).toBe(false);
    expect(counterable({ ...piece, pull: { ...piece.pull, countered: true } }, 1100)).toBe(false);
  });

  it("find a chain within a kick's reach, either way the pawn faces", () => {
    expect(chainInReach(300, 450, 500, -1, BUMP_REACH, 20)).toBe(true);
    expect(chainInReach(300, 450, 700, -1, BUMP_REACH, 20)).toBe(false);
    expect(chainInReach(300, 450, 500, 1, BUMP_REACH, 20)).toBe(false);
    expect(chainInReach(300, 450, 200, 1, BUMP_REACH, 20)).toBe(true);
  });

  it("draw a freed piece stumbling to a stand and a tugged one stretched, both still drawn with less motion", () => {
    expect(freedPose(FREED_MS / 2, 500, 480, 1000).x).toBeCloseTo(490);
    expect(freedPose(FREED_MS + 10, 500, 480, 1000).state).toBe("safe");
    expect(freedPose(FREED_MS / 2, 500, 480, 1000, true).tilt).not.toBe(0);
    const tug = tugPose(TUG_HOLD_MS / 2, 500, 500, 1000);
    expect(tug.sx).toBeGreaterThan(1.2);
    expect(tugPose(TUG_HOLD_MS / 2, 500, 500, 1000, true).sx).toBeGreaterThan(1.2);
    expect(MOVED.freed.ms).toBe(FREED_MS);
    expect(MOVED.tug.ms).toBe(TUG_HOLD_MS);
  });

  it("draw a planted or tugging robot's chain held taut, then wound back", () => {
    const h = { at: 0, dir: 1 };
    expect(hookDrawn({ ...h, verdict: { at: 300, o: "plant", hitX: 520 } }, 400, 300)).toMatchObject({ state: "stuck", tip: 520 });
    expect(hookDrawn({ ...h, verdict: { at: 300, o: "tug", hitX: 520 } }, 300 + TUG_HOLD_MS - 10, 300)).toMatchObject({ state: "stuck", tip: 520 });
    expect(hookDrawn({ ...h, verdict: { at: 300, o: "tug", hitX: 520 } }, 300 + TUG_HOLD_MS + 20, 300).state).toBe("back");
  });
});

describe("plant: a robot up on its legs as the hook lands holds its ground", () => {
  it("drags the thrower to it along its chain, and its legs stay up", () => {
    const core = party(["Rob", "Ada"]);
    be(core, 0, "robot");
    be(core, 1, "robot");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 520, 1500, -1);
    core.hook(0, 2000);
    // Ada's legs go up as the hook flies (heard by the time it lands, with the late allowance).
    core.stilts(1, 2000 + HOOK_AIM_MS);
    const { hk, at } = judged(core, 0, 2000);
    const [wall, lit] = lights(core);
    expect(hk).toMatchObject({ o: "plant", to: 1, x: slideLanding(300, 520 - HOOK_HOLD, wall, lit) });
    expect(core.members[0]).toMatchObject({ x: hk.x, fright: "pull" });
    expect(core.members[1].x).toBe(520);
    expect(core.members[1].stiltsUntil).toBeGreaterThan(at);
  });

  it("does not count legs that went up after the hook landed (heard too late): the robot is pulled, its legs drop", () => {
    const core = party(["Rob", "Ada"]);
    be(core, 0, "robot");
    be(core, 1, "robot");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 520, 1500, -1);
    core.hook(0, 2000);
    // The tip reaches Ada about 260 ms on; her legs come 150 ms after that, past the allowance.
    core.stilts(1, 2000 + 410);
    const { hk } = judged(core, 0, 2000);
    expect(hk).toMatchObject({ o: "pull", to: 1 });
    expect(core.members[1].stiltsUntil).toBeLessThanOrEqual(core.members[1].t);
  });
});

describe("ride the hook: a pawn being pulled kicks before it arrives", () => {
  it("lands a flying kick: the robot is knocked over, away from the pawn, and the pawn lands where it was pulled to", () => {
    const core = party(["Rob", "Pat"]);
    const { hk, at } = pulled(core);
    const b = core.bump(1, at + 120);
    const [wall, lit] = lights(core);
    expect(b).toMatchObject({ t: "b", s: 1, to: 0, ride: 1, f: -1 });
    expect(b.x).toBe(knockLanding(300, -1, wall, lit));
    expect(core.members[0].stunUntil).toBe(at + 120 + STUN_MS);
    expect(core.members[1].x).toBe(hk.x);
    // Its cooldown is spent, as for any kick.
    expect(core.members[1].bumpAt).toBe(at + 120);
  });

  it("counts a kick the room hears a round trip after the player's window ended (the network), and not later", () => {
    // A phone on a 300 ms round trip that kicked at the last moment it could: the room hears it
    // PULL_MS + COUNTER_LATE_MS after the phone heard the pull, which was half a round trip after
    // the room judged it, and the kick takes another half to arrive.
    const late = party(["Rob", "Pat"]);
    const { at } = pulled(late);
    expect(late.bump(1, at + 150 + PULL_MS + COUNTER_LATE_MS + 150)).toMatchObject({ ride: 1, to: 0 });
    const later = party(["Rob", "Pat"]);
    const { at: at2 } = pulled(later);
    // Past the window it is a pawn that has just been pulled: still safe and getting up, and its kick goes nowhere.
    expect(later.bump(1, at2 + COUNTER_WINDOW_MS + 20)?.ride).toBeUndefined();
  });

  it("is a counter once: the pull answered, nothing more counters it, and a kick still cooling does not ride", () => {
    const core = party(["Rob", "Pat"]);
    core.members[1].bumpAt = 1500;
    const { at } = pulled(core);
    // Kicked 500 ms before the hook: still cooling, so no ride.
    expect(core.bump(1, at + 50)).toBeNull();
    const once = party(["Rob", "Pat"]);
    const { at: t } = pulled(once);
    once.bump(1, t + 50);
    expect(once.members[1].pull.countered).toBe(true);
    expect(counterable(once.members[1], t + 100)).toBe(false);
  });

  it("refuses what no pulled pawn can do: a kick from a pawn nobody pulled is a plain kick, and a game starting ends it", () => {
    const core = party(["Rob", "Pat"]);
    be(core, 0, "robot");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 520, 1500, -1);
    // A lying phone that kicks as if pulled: nothing pulled it, so the kick is a plain one (out of reach here).
    expect(core.bump(1, 2000)).toMatchObject({ to: -1 });
    expect(core.bump(1, 2000)?.ride).toBeUndefined();
    const game = party(["Rob", "Pat"]);
    const { at } = pulled(game);
    game.startGame("coin-flip", at + 20);
    expect(game.bump(1, at + 60)).toBeNull();
  });

  it("is lost when the room moves the pawn meanwhile (a room switch carries everyone, the pull with it)", () => {
    const core = party(["Rob", "Pat"]);
    const { at } = pulled(core);
    core.endMoves(core.members[1], at + 30);
    expect(core.bump(1, at + 60)?.ride).toBeUndefined();
    // Through the real switch: the host takes the party from the bar to the Star Lounge, whose
    // boxes hang elsewhere, so every piece is carried across (setRoom, carryAcross).
    const bar = new LobbyCore({ ...WALL, seed: 7, code: "BCDFGH", now: 1000 });
    for (const name of ["Rob", "Pat"]) bar.connect(bar.join(name, 1000).token, 1000);
    bar.room = "bar";
    const { at: t } = pulled(bar);
    expect(bar.setRoom(bar.hostToken, "ship", t + 30)).toMatchObject({ ok: true, moved: true });
    expect(counterable(bar.members[1], t + 60)).toBe(false);
    expect(bar.bump(1, t + 60)?.ride).toBeUndefined();
  });

  it("is the room's, not the socket's: a phone that drops and comes back mid-pull may still ride", () => {
    const core = party(["Rob", "Pat"]);
    const { at } = pulled(core);
    const token = core.members[1].token;
    core.disconnect(token, at + 40);
    core.connect(token, at + 80);
    expect(core.bump(1, at + 120)).toMatchObject({ ride: 1, to: 0 });
  });

  it("leaves nothing hanging when the pulled phone goes silent: it lands, the window closes, the robot is free", () => {
    const core = party(["Rob", "Pat"]);
    const { at } = pulled(core);
    const pull = core.members[1].pull;
    run(core, at, at + COUNTER_WINDOW_MS + 200);
    expect(core.members[1].x).toBe(pull.to);
    expect(counterable(core.members[1], at + COUNTER_WINDOW_MS + 200)).toBe(false);
    expect(core.members[0].hook).toBeNull();
    expect(core.members[0].stunUntil ?? 0).toBeLessThan(at);
    // Its next kick, when it comes, is a plain one.
    expect(core.bump(1, at + COUNTER_WINDOW_MS + 2000)?.ride).toBeUndefined();
  });
});

describe("cannonball: a slime being pulled hardens in the air", () => {
  it("bowls the robot over, away from the slime, and keeps flying to where it was pulled", () => {
    const core = party(["Rob", "Sam"]);
    const { hk, at } = pulled(core, "slime");
    const out = core.slime(1, "harden", at + 100);
    const [wall, lit] = lights(core);
    expect(out).toMatchObject({ ok: true, relay: { t: "slime", s: 1, k: "harden", ct: "cannon", to: 0, x: knockLanding(300, -1, wall, lit) } });
    expect(core.members[0].stunUntil).toBe(at + 100 + STUN_MS);
    expect(core.members[1]).toMatchObject({ x: hk.x, hardUntil: at + 100 + HARDEN_MS });
  });

  it("does not turn an absorb in the air, nor a harden after the window, nor one still cooling", () => {
    const soft = party(["Rob", "Sam"]);
    const { at } = pulled(soft, "slime");
    expect(soft.slime(1, "absorb", at + 100)).toMatchObject({ ok: false });
    // After the window it has landed and stands: its harden is a plain one, no cannonball.
    const late = party(["Rob", "Sam"]);
    const { at: t } = pulled(late, "slime");
    const plain = late.slime(1, "harden", t + COUNTER_WINDOW_MS + 30);
    expect(plain).toMatchObject({ ok: true });
    expect(plain.relay.ct).toBeUndefined();
    expect(late.members[0].stunUntil ?? 0).toBeLessThan(t);
    const cool = party(["Rob", "Sam"]);
    cool.members[1].slimeAt = 1500;
    const { at: t2 } = pulled(cool, "slime");
    expect(cool.slime(1, "harden", t2 + 100)).toMatchObject({ ok: false, cooling: true });
  });
});

describe("the empty hook: a ghost being pulled fades", () => {
  it("slips the hook where it is in the air, and the robot is spooked away from it", () => {
    const core = party(["Rob", "Gus"]);
    core.members[1].fadeAt = -Infinity;
    const { at } = pulled(core, "ghost");
    const pull = core.members[1].pull;
    const now = at + 90;
    const out = core.fade(1, now);
    const [wall, lit] = lights(core);
    const gx = slideLanding(pull.from, Math.round(pullAt(pull, now)), wall, lit);
    expect(out).toMatchObject({ ok: true, relay: { t: "fade", s: 1, ct: "empty", gx, to: 0 } });
    // Short of where the pull would have put it.
    expect(Math.abs(gx - 520)).toBeLessThan(Math.abs(pull.to - 520));
    expect(core.members[1]).toMatchObject({ x: gx, fright: "freed" });
    expect(core.members[1].fadedUntil).toBe(now + FADE_MS);
    expect(out.relay.x).toBe(knockLanding(300, -1, wall, lit, SPOOK_LANDING));
    expect(core.members[0]).toMatchObject({ fright: "spook", stunUntil: now + SPOOK_MS });
  });

  it("is refused during the count (a fade never is then), and after the window is a plain fade", () => {
    const count = party(["Rob", "Gus"]);
    count.members[1].fadeAt = -Infinity;
    const { at } = pulled(count, "ghost");
    count.count = { endsAt: at + 5000 };
    expect(count.fade(1, at + 90)).toMatchObject({ ok: false, why: "Not during the count." });
    const late = party(["Rob", "Gus"]);
    late.members[1].fadeAt = -Infinity;
    const { hk, at: t } = pulled(late, "ghost");
    const plain = late.fade(1, t + COUNTER_WINDOW_MS + 30);
    expect(plain).toMatchObject({ ok: true });
    expect(plain.relay.ct).toBeUndefined();
    expect(late.members[1].x).toBe(hk.x);
  });
});

describe("cut the line: a pawn kicks the chain while a friend is pulled", () => {
  /** Rob pulls Bo from 520; Pat stands just past Bo (the hook meets Bo first), facing the chain. */
  function setup() {
    const core = party(["Rob", "Bo", "Pat"]);
    place(core, 2, 545, 1400, -1);
    const { at } = pulled(core);
    return { core, at };
  }

  it("frees them where they are in the air, and the chain snaps back", () => {
    const { core, at } = setup();
    const pull = core.members[1].pull;
    const now = at + 60;
    const b = core.bump(2, now);
    const [wall, lit] = lights(core);
    expect(b).toMatchObject({ t: "b", s: 2, to: -1, cut: 1, by: 0, x: slideLanding(pull.from, Math.round(pullAt(pull, now)), wall, lit) });
    expect(core.members[1]).toMatchObject({ x: b.x, fright: "freed", stunUntil: now + FREED_MS, pull: null });
    expect(core.members[0].pulled).toBeNull();
  });

  it("does nothing to a chain out of reach, behind the pawn, or once the piece has arrived", () => {
    const far = party(["Rob", "Bo", "Pat"]);
    place(far, 2, 900, 1400, -1);
    const { at } = pulled(far);
    expect(far.bump(2, at + 60)?.cut).toBeUndefined();
    const behind = party(["Rob", "Bo", "Pat"]);
    place(behind, 2, 545, 1400, 1);
    const { at: t } = pulled(behind);
    expect(behind.bump(2, t + 60)?.cut).toBeUndefined();
    const arrived = setup();
    expect(arrived.core.bump(2, arrived.at + PULL_MS + COUNTER_LAG_MS + 20)?.cut).toBeUndefined();
    // A kick made while the chain was in reach (60 ms into the pull) and heard a round trip later
    // still cuts it, freeing them where the chain had them then.
    const late = setup();
    const pull = late.core.members[1].pull;
    const cut = late.core.bump(2, late.at + 60 + COUNTER_LAG_MS - 20);
    expect(cut).toMatchObject({ cut: 1 });
    expect(Math.abs(cut.x - pullAt(pull, late.at + 60))).toBeLessThan(25);
  });

  it("keeps a robot's own hook flying from where it is when it is freed while hooking", () => {
    // Ada (300) hooks Cy (520), who has just thrown his own hook to the right; Pat behind Ada cuts
    // Ada's chain: Cy stumbles to a stand where he is, and his hook flies on from there (the review's
    // probe: its origin stayed 95 units behind where every page draws him).
    const core = party(["Ada", "Cy", "Pat"]);
    be(core, 0, "robot");
    be(core, 1, "robot");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 520, 1500, 1);
    place(core, 2, 250, 1500, 1);
    core.hook(0, 2000);
    core.hook(1, 2120);
    let pullAt = null;
    for (let t = 2000; t <= 2600 && pullAt === null; t += 5) for (const m of [...core.dueHooks(t), ...core.drainMoves()]) if (m.s === 0 && m.o === "pull") pullAt = t;
    expect(pullAt).not.toBeNull();
    const cy = core.members[1];
    expect(core.bump(2, pullAt + 40, 1)).toMatchObject({ cut: 1 });
    expect(cy.hook).not.toBeNull();
    expect(Math.abs(cy.hook.x0 - cy.x)).toBeLessThan(1);
  });
});

describe("steal: a robot hooks a piece another robot is pulling (the later hook takes it)", () => {
  /** Rob at 300 and Ada at 680, both facing Bo at 520; Rob throws first, Ada `lag` later. */
  function setup(lag) {
    const core = party(["Rob", "Bo", "Ada"]);
    be(core, 0, "robot");
    be(core, 2, "robot");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 520, 1500, -1);
    place(core, 2, 680, 1500, -1);
    core.hook(0, 2000);
    core.hook(2, 2000 + lag);
    return core;
  }

  it("takes it out of the air toward the later robot; the first robot's hook snaps back empty", () => {
    // Ada's tip reaches Bo while Rob's pull has him in the air (later than TUG_MS after Rob's).
    const core = setup(250);
    const out = run(core, 2000, 3000);
    const robs = out.find((m) => m.s === 0);
    const adas = out.find((m) => m.s === 2);
    expect(robs).toMatchObject({ o: "pull", to: 1 });
    expect(adas).toMatchObject({ o: "pull", to: 1, st: 0 });
    expect(core.members[1].x).toBeGreaterThan(core.members[2].x - HOOK_HOLD - 2);
    expect(core.members[1].pull).toMatchObject({ by: 2, countered: true });
    expect(core.members[0].pulled).toBeNull();
  });

  it("is a counter itself: the stolen pull cannot be ridden, cut or stolen again", () => {
    const core = setup(250);
    const out = run(core, 2000, 3000);
    const at = out.find((m) => m.s === 2).at;
    expect(counterable(core.members[1], at + 50)).toBe(false);
    expect(core.bump(1, at + 50)?.ride).toBeUndefined();
  });

  it("lets a piece that has arrived be: a hook that reaches it after its pull passes over it", () => {
    const core = setup(420);
    const out = run(core, 2000, 3200);
    expect(out.find((m) => m.s === 0)).toMatchObject({ o: "pull", to: 1 });
    expect(out.find((m) => m.s === 2 && m.o === "pull")).toBeUndefined();
  });
});

describe("the hook's counters with every light on: nobody comes to rest in a light they never stood in", () => {
  /** Eight lit boxes (narrow pools, every one lit), and seated players at 1000 ms. */
  function lit(names) {
    const boxes = Array.from({ length: 8 }, (_, i) => ({ ...boxFromManifest(coinFlipManifest, { test: true }), id: `coin-${i}` }));
    const core = new LobbyCore({ boxes, games: new Map([["coin-flip", coinFlip]]), seed: 7, code: "BCDFGH", now: 1000 });
    for (const name of names) core.connect(core.join(name, 1000).token, 1000);
    return core;
  }
  /** Whether x stands in a lit pool other than `home`'s. */
  const strayLight = (core, x, home) => {
    const i = lightAt(x, core.landingWall());
    return i !== -1 && core.litPlaces().includes(i) && i !== lightAt(home, core.landingWall());
  };
  const pool3 = () => wallOf(lit(["a"]).landingWall()).pools[3];

  it("lands a stolen piece in the dark or its own light, never over the pool it was being pulled across", () => {
    // Ada pulls Bo out of his pool, across pool 3 toward the dark; Cy, just past where Bo stood,
    // takes him in the air over pool 3 (the review's case: Bo came to rest at 898, inside it).
    const pool = pool3();
    let steals = 0;
    for (const cyAt of [962, 982, 1002, 1022]) {
      for (let lag = 150; lag <= 400; lag += 10) {
        const core = lit(["Ada", "Bo", "Cy"]);
        be(core, 0, "robot");
        be(core, 2, "robot");
        const bo = Math.round(pool.x + pool.half + 40);
        place(core, 0, Math.round(pool.x - pool.half - 100), 1500, 1);
        place(core, 1, bo, 1500, -1);
        place(core, 2, cyAt, 1500, -1);
        core.hook(0, 2000);
        core.hook(2, 2000 + lag);
        const out = run(core, 2000, 3500);
        const cy = out.find((m) => m.s === 2 && m.o !== "off");
        if (cy?.st !== undefined) steals++;
        expect(strayLight(core, core.members[1].x, bo), `Cy at ${cyAt}, ${lag} ms after Ada: Bo rests at ${core.members[1].x} (${JSON.stringify(out.filter((m) => m.o !== "off").map(({ s, o, x, st }) => ({ s, o, x, st })))})`).toBe(false);
      }
    }
    expect(steals).toBeGreaterThan(0);
  });

  it("lands a freed (cut), slipped (empty hook) or riding piece in the dark or its own light", () => {
    const pool = pool3();
    const bo = Math.round(pool.x + pool.half + 40);
    const robAt = Math.round(pool.x - pool.half - 100);
    for (const what of ["cut", "empty hook", "ride"]) {
      let countered = 0;
      for (let dt = 20; dt <= PULL_MS; dt += 20) {
        const core = lit(["Rob", "Bo", "Pat"]);
        be(core, 0, "robot");
        if (what === "empty hook") {
          be(core, 1, "ghost");
          core.members[1].fadeAt = -Infinity;
        }
        place(core, 0, robAt, 1500, 1);
        place(core, 1, bo, 1500, -1);
        // Pat (a pawn) just behind Rob, facing the chain, for the cut.
        place(core, 2, robAt - 30, 1500, 1);
        core.hook(0, 2000);
        const { hk, at } = judged(core, 0, 2000);
        expect(hk, what).toMatchObject({ o: "pull", to: 1 });
        const out = what === "cut" ? core.bump(2, at + dt, 1) : what === "ride" ? core.bump(1, at + dt, -1) : core.fade(1, at + dt);
        if (out?.cut !== undefined || out?.ride || out?.relay?.ct === "empty" || out?.ct === "empty") countered++;
        run(core, at + dt, at + 2000);
        expect(strayLight(core, core.members[1].x, bo), `${what} ${dt} ms into the pull: Bo rests at ${core.members[1].x}`).toBe(false);
      }
      expect(countered, what).toBeGreaterThan(0);
    }
  });

  it("holds a tugged piece where it stands, which is its own place", () => {
    const pool = pool3();
    const core = lit(["Rob", "Bo", "Ada"]);
    be(core, 0, "robot");
    be(core, 2, "robot");
    place(core, 0, Math.round(pool.x - 220), 1500, 1);
    place(core, 1, Math.round(pool.x), 1500, -1);
    place(core, 2, Math.round(pool.x + 220), 1500, -1);
    core.hook(0, 2000);
    core.hook(2, 2000);
    const out = run(core, 2000, 3000);
    expect(out.filter((m) => m.o === "tug")).toHaveLength(2);
    expect(core.members[1].x).toBe(Math.round(pool.x));
  });
});

describe("tug of war: two robots hook the same piece at once (nobody wins)", () => {
  /** Rob at 300 and Ada at 740, Bo halfway: their tips reach him at the same moment. */
  function setup(adaLag = 0) {
    const core = party(["Rob", "Bo", "Ada"]);
    be(core, 0, "robot");
    be(core, 2, "robot");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 520, 1500, -1);
    place(core, 2, 740, 1500, -1);
    return { core, throw: (first) => (first === 0 ? (core.hook(0, 2000), core.hook(2, 2000 + adaLag)) : (core.hook(2, 2000 + adaLag), core.hook(0, 2000))) };
  }

  for (const first of [0, 2]) {
    it(`holds it where it stands, stretched, both hooks back and both cooldowns spent (${first === 0 ? "Rob" : "Ada"} thrown first)`, () => {
      const { core, throw: go } = setup();
      go(first);
      const out = run(core, 2000, 3000);
      const tugs = out.filter((m) => m.o === "tug");
      expect(tugs.map((m) => m.s).sort()).toEqual([0, 2]);
      expect(tugs.every((m) => m.to === 1 && m.x === 520)).toBe(true);
      expect(out.some((m) => m.o === "pull")).toBe(false);
      expect(core.members[1]).toMatchObject({ x: 520, fright: "tug" });
      expect(core.members[0].hook).toBeNull();
      expect(core.members[2].hook).toBeNull();
      expect(core.members[0].hookAt).toBe(2000);
      expect(core.members[2].hookAt).toBe(2000);
    });
  }

  it("is a steal, not a tug, when the second tip comes later than TUG_MS", () => {
    // Ada nearer Bo and later: her tip reaches him a good while after Rob's, while he is in the air.
    const core = party(["Rob", "Bo", "Ada"]);
    be(core, 0, "robot");
    be(core, 2, "robot");
    place(core, 0, 300, 1500, 1);
    place(core, 1, 520, 1500, -1);
    place(core, 2, 680, 1500, -1);
    core.hook(0, 2000);
    core.hook(2, 2250);
    const out = run(core, 2000, 3000);
    expect(out.some((m) => m.o === "tug")).toBe(false);
    expect(out.find((m) => m.s === 2)).toMatchObject({ o: "pull", st: 0 });
  });

  it("is no tug when the other hook would not pull it (Bo jumps Ada's)", () => {
    const { core, throw: go } = setup();
    go(0);
    // A jump heard as both tips arrive clears both: neither pulls, nobody tugs.
    core.move(1, { x: 520, d: 0, r: core.members[1].rev, j: 1 }, 2000 + HOOK_AIM_MS + 50);
    const out = run(core, 2000, 3000);
    expect(out.some((m) => m.o === "tug")).toBe(false);
  });
});

describe("what a page does for the hook's counters", () => {
  it("lets a pawn kick, a slime harden and a ghost fade while it is in the air on a chain, and not after", () => {
    const sent = [];
    const p = new Pilot({ lights: 1, send: (m) => sent.push(m), x: 500 });
    p.pulled(400, 2, 1000, PULL_MS, 1000 + PULL_MS + COUNTER_LATE_MS);
    expect(p.down(1100)).toBe(true);
    expect(p.mayKick(1100)).toBe(true);
    expect(p.bump(1100)).toBe(true);
    // (Its facing rides with it, as every kick's does: facing.test.js.)
    expect(sent.at(-1)).toEqual({ t: "b", f: 1 });
    const s = new Pilot({ lights: 1, send: (m) => sent.push(m), x: 500, character: "slime" });
    s.pulled(400, 2, 1000, PULL_MS, 1000 + PULL_MS + COUNTER_LATE_MS);
    expect(s.slime("harden", 1100)).toBe(true);
    const g = new Pilot({ lights: 1, send: (m) => sent.push(m), x: 500, character: "ghost" });
    g.pulled(400, 2, 1000, PULL_MS, 1000 + PULL_MS + COUNTER_LATE_MS);
    expect(g.fade(1100)).toBe(true);
    // A knock (not a pull) gives no such leave.
    const k = new Pilot({ lights: 1, send: () => {}, x: 500 });
    k.knock(400, 2, 1000);
    expect(k.mayKick(1100)).toBe(false);
  });

  it("draws each counter on every piece it moves, in both looks", () => {
    const flat = BumpDraw.prototype;
    const fx = { burst() {}, dust() {} };
    for (const [look, fright, knock, pose] of [
      ["flat", (p, x, at, kind) => flat.fright.call(fx, p, x, at, kind), (p, x, at) => flat.knock.call(fx, p, x, at), (p, now) => flat.pose.call(fx, p, now)],
      ["3D", startFright, startKnock, (p, now) => bumpPose(p, now)],
    ]) {
      const piece = (seat, x) => ({ seat, rx: x, face: 1, net: { x, d: 0, t: 0 }, rev: 0, hook: null });
      const drawing = { fright, knock, spark() {} };
      // Cut: the freed piece stumbles to where the room set it down; the chain snaps back.
      const pieces = new Map([[0, piece(0, 300)], [1, piece(1, 450)]]);
      pieces.get(0).hook = { at: 0, dir: 1, verdict: { at: 200, o: "pull", hitX: 520 } };
      heardCut(pieces, { t: "b", s: 2, cut: 1, by: 0, x: 440, rev: 4 }, 300, drawing);
      expect(pieces.get(1).fright.kind, look).toBe("freed");
      expect(pieces.get(0).hook.verdict.o, look).toBe("off");
      expect(pose(pieces.get(1), 300 + FREED_MS / 2).x, look).toBeLessThan(450);
      // Cannonball: the robot knocked over at once.
      const c = new Map([[0, piece(0, 300)], [1, piece(1, 380)]]);
      heardCannon(c, { t: "slime", s: 1, ct: "cannon", to: 0, x: 90, rev: 5 }, 1000, drawing);
      expect(pose(c.get(0), 1000 + 100).state, look).toBe("flying");
      // Empty hook: the ghost set down where it was, the robot spooked.
      const e = new Map([[0, piece(0, 300)], [1, piece(1, 450)]]);
      heardEmpty(e, { t: "fade", s: 1, ct: "empty", gx: 455, grev: 2, to: 0, x: 180, rev: 3 }, 2000, drawing);
      expect(e.get(1).fright.kind, look).toBe("freed");
      expect(e.get(0).fright.kind, look).toBe("spook");
      // Tug: held stretched where it is.
      const t = new Map([[0, piece(0, 300)], [1, piece(1, 520)], [2, piece(2, 740)]]);
      heardVerdict(t, { t: "hk", s: 0, to: 1, o: "tug", hx: 520, x: 520, rev: 2, with: 2 }, 3000, drawing);
      heardVerdict(t, { t: "hk", s: 2, to: 1, o: "tug", hx: 520, x: 520, rev: 2, with: 0 }, 3000, drawing);
      expect(pose(t.get(1), 3000 + TUG_HOLD_MS / 2).sx, look).toBeGreaterThan(1.2);
    }
  });

  it("draws a pawn riding the hook kicking as it slides, in both looks", () => {
    const flat = BumpDraw.prototype;
    const fx = { burst() {}, dust() {} };
    for (const [look, pose] of [
      ["flat", (p, now) => flat.pose.call(fx, p, now)],
      ["3D", (p, now) => bumpPose(p, now)],
    ]) {
      const p = { seat: 1, rx: 520, face: -1, rev: 1 };
      flat.fright.call(fx, p, 364, 1000, "pull");
      // Kicked a moment into the pull: the blow lands before it arrives.
      p.attack = { at: 1020, dir: -1, landed: true };
      const drawn = pose(p, 1020 + IMPACT_MS);
      expect(drawn.state, look).toBe("striking");
      expect(drawn.x, look).toBeLessThan(520);
      expect(drawn.x, look).toBeGreaterThan(364);
    }
  });
});

describe("the hook's counters on the real room", () => {
  beforeEach(useFakeRuntime);
  afterEach(dropFakeRuntime);

  /** Rob a robot, Pat a pawn, Sam a slime, and a screen, on the real room. */
  async function room() {
    const r = await openRoom(createLobbyRoom, turnGame(), { players: { min: 1, max: 4 } });
    const { ctx, connect, say } = r;
    ctx.keepAlive = true;
    const tokens = [await ctx.room.create({ code: "BCDFGH", nickname: "Rob", as: "player" })];
    for (const name of ["Pat", "Sam"]) tokens.push(await ctx.room.join({ nickname: name, as: "player" }));
    const screen = await ctx.room.join({ as: "screen" });
    const ws = [];
    for (const t of tokens) ws.push(await connect(t.token));
    ws.screen = await connect(screen.token);
    await settle();
    say(ws[0], { t: "look", c: "robot" });
    say(ws[2], { t: "look", c: "slime" });
    await settle();
    await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
    return { ...r, ws, core: ctx.room.core };
  }
  const mark = (...sockets) => sockets.map((ws) => ws.frames.length);
  const since = (ws, n) => ws.messages().slice(n);

  it("tells every page of a ride: the hook's pull, then the flying kick that knocks the robot over", async () => {
    const { ctx, say, ws, core } = await room();
    await walkTo(say, ctx, ws[0], 0, 300);
    say(ws[0], { t: "m", x: 300, d: 1, r: core.members[0].rev });
    say(ws[0], { t: "m", x: 300, d: 0, r: core.members[0].rev });
    await walkTo(say, ctx, ws[1], 1, 520);
    await walkTo(say, ctx, ws[2], 2, ROOM.maxX - 10);
    await settle();
    const before = mark(ws[0], ws[1], ws.screen);
    say(ws[0], { t: "hook" });
    await settle();
    // Until the pull: then Pat's page kicks while it is in the air.
    for (let i = 0; i < 100 && !since(ws[1], before[1]).some((m) => m.t === "hk"); i++) await vi.advanceTimersByTimeAsync(5);
    expect(since(ws[1], before[1]).find((m) => m.t === "hk")).toMatchObject({ o: "pull", to: 1 });
    await vi.advanceTimersByTimeAsync(80);
    say(ws[1], { t: "b" });
    await settle();
    for (const [i, page] of [ws[0], ws[1], ws.screen].entries()) expect(since(page, before[i]).find((m) => m.t === "b")).toMatchObject({ s: 1, to: 0, ride: 1 });
    expect(ctx.room.sockets.get(ws[0]).kept.piece).toMatchObject({ x: core.members[0].x, rev: core.members[0].rev });
  });

  it("tells every page of a cannonball, and moves the robot's socket copy", async () => {
    const { ctx, say, ws, core } = await room();
    await walkTo(say, ctx, ws[0], 0, 300);
    say(ws[0], { t: "m", x: 300, d: 1, r: core.members[0].rev });
    say(ws[0], { t: "m", x: 300, d: 0, r: core.members[0].rev });
    await walkTo(say, ctx, ws[2], 2, 520);
    await walkTo(say, ctx, ws[1], 1, ROOM.maxX - 10);
    await settle();
    const before = mark(ws[0], ws[2], ws.screen);
    say(ws[0], { t: "hook" });
    await settle();
    for (let i = 0; i < 100 && !since(ws[2], before[1]).some((m) => m.t === "hk"); i++) await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(60);
    say(ws[2], { t: "slime", k: "harden" });
    await settle();
    for (const [i, page] of [ws[0], ws[2], ws.screen].entries()) expect(since(page, before[i]).find((m) => m.t === "slime")).toMatchObject({ s: 2, ct: "cannon", to: 0 });
    expect(ctx.room.sockets.get(ws[0]).kept.piece).toMatchObject({ x: core.members[0].x, rev: core.members[0].rev });
    expect(posAt(core.members[0], Date.now())).toBeLessThan(300);
  });

  /** Places Rob (a robot) at 300 facing right, and the others where asked, then throws Rob's hook and waits for its word. */
  async function hookAt(r, places) {
    const { ctx, say, ws, core } = r;
    await walkTo(say, ctx, ws[0], 0, 300);
    say(ws[0], { t: "m", x: 300, d: 1, r: core.members[0].rev });
    say(ws[0], { t: "m", x: 300, d: 0, r: core.members[0].rev });
    for (const [seat, x, face] of places) {
      await walkTo(say, ctx, ws[seat], seat, x);
      say(ws[seat], { t: "m", x, d: face, r: core.members[seat].rev });
      say(ws[seat], { t: "m", x, d: 0, r: core.members[seat].rev });
    }
    await settle();
    const before = mark(ws[0], ws[1], ws[2], ws.screen);
    say(ws[0], { t: "hook" });
    await settle();
    for (let i = 0; i < 200 && !since(ws.screen, before[3]).some((m) => m.t === "hk" && m.s === 0); i++) await vi.advanceTimersByTimeAsync(5);
    return before;
  }

  it("tells every page of a cut: Pat kicks Rob's chain while Sam is pulled, and Sam is set down", async () => {
    const r = await room();
    const { say, ws } = r;
    const before = await hookAt(r, [[2, 520, -1], [1, 545, -1]]);
    expect(since(ws.screen, before[3]).find((m) => m.t === "hk" && m.s === 0)).toMatchObject({ o: "pull", to: 2 });
    await vi.advanceTimersByTimeAsync(40);
    say(ws[1], { t: "b", f: -1 });
    await settle();
    for (const [i, page] of [ws[0], ws[1], ws[2], ws.screen].entries()) expect(since(page, before[i]).find((m) => m.t === "b")).toMatchObject({ s: 1, to: -1, cut: 2, by: 0 });
    expect(r.ctx.room.sockets.get(ws[2]).kept.piece).toMatchObject({ x: r.core.members[2].x, rev: r.core.members[2].rev });
  });

  it("tells every page of a plant, a tug and a steal between two robots", async () => {
    // Plant: Sam becomes a robot and puts his legs up; Rob's hook meets him there.
    {
      const r = await room();
      const { say, ws } = r;
      say(ws[2], { t: "look", c: "robot" });
      await settle();
      await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
      await walkTo(say, r.ctx, ws[2], 2, 520);
      say(ws[2], { t: "stilts" });
      await settle();
      const before = await hookAt(r, [[1, ROOM.maxX - 10, -1]]);
      expect(since(ws.screen, before[3]).find((m) => m.t === "hk" && m.s === 0)).toMatchObject({ o: "plant", to: 2 });
      expect(r.ctx.room.sockets.get(ws[0]).kept.piece).toMatchObject({ x: r.core.members[0].x, rev: r.core.members[0].rev });
    }
    // Tug: Sam (a robot at 740) throws at the same moment as Rob; Pat at 520 between them.
    {
      const r = await room();
      const { say, ws } = r;
      say(ws[2], { t: "look", c: "robot" });
      await settle();
      await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
      await walkTo(say, r.ctx, ws[2], 2, 740);
      say(ws[2], { t: "m", x: 740, d: -1, r: r.core.members[2].rev });
      say(ws[2], { t: "m", x: 740, d: 0, r: r.core.members[2].rev });
      await walkTo(say, r.ctx, ws[0], 0, 300);
      say(ws[0], { t: "m", x: 300, d: 1, r: r.core.members[0].rev });
      say(ws[0], { t: "m", x: 300, d: 0, r: r.core.members[0].rev });
      await walkTo(say, r.ctx, ws[1], 1, 520);
      await settle();
      const before = mark(ws.screen);
      say(ws[0], { t: "hook" });
      say(ws[2], { t: "hook" });
      await settle();
      for (let i = 0; i < 300 && since(ws.screen, before[0]).filter((m) => m.t === "hk").length < 2; i++) await vi.advanceTimersByTimeAsync(5);
      const tugs = since(ws.screen, before[0]).filter((m) => m.t === "hk");
      expect(tugs.map((m) => m.o)).toEqual(["tug", "tug"]);
      expect(tugs.map((m) => m.s).sort()).toEqual([0, 2]);
    }
    // Steal: Sam (a robot at 680) throws 250 ms after Rob, and takes Pat out of the air.
    {
      const r = await room();
      const { say, ws } = r;
      say(ws[2], { t: "look", c: "robot" });
      await settle();
      await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
      await walkTo(say, r.ctx, ws[2], 2, 680);
      say(ws[2], { t: "m", x: 680, d: -1, r: r.core.members[2].rev });
      say(ws[2], { t: "m", x: 680, d: 0, r: r.core.members[2].rev });
      await walkTo(say, r.ctx, ws[0], 0, 300);
      say(ws[0], { t: "m", x: 300, d: 1, r: r.core.members[0].rev });
      say(ws[0], { t: "m", x: 300, d: 0, r: r.core.members[0].rev });
      await walkTo(say, r.ctx, ws[1], 1, 520);
      await settle();
      const before = mark(ws.screen);
      say(ws[0], { t: "hook" });
      await vi.advanceTimersByTimeAsync(250);
      say(ws[2], { t: "hook" });
      await settle();
      for (let i = 0; i < 300 && !since(ws.screen, before[0]).some((m) => m.t === "hk" && m.s === 2); i++) await vi.advanceTimersByTimeAsync(5);
      expect(since(ws.screen, before[0]).find((m) => m.t === "hk" && m.s === 2)).toMatchObject({ o: "pull", to: 1, st: 0 });
      expect(r.ctx.room.sockets.get(ws[1]).kept.piece).toMatchObject({ x: r.core.members[1].x, rev: r.core.members[1].rev });
    }
  });

  it("lets no hand-written client counter a pull that is not its own: a kick from a pawn nobody pulled is a plain kick", async () => {
    const r = await room();
    const { say, ws } = r;
    // Sam (the slime) is pulled; Pat, far off and nobody's catch, kicks (and says `c` and `ride` it is not owed).
    const before = await hookAt(r, [[2, 520, -1], [1, ROOM.maxX - 10, -1]]);
    expect(since(ws.screen, before[3]).find((m) => m.t === "hk" && m.s === 0)).toMatchObject({ o: "pull", to: 2 });
    say(ws[1], { t: "b", f: -1, c: 1, ride: 1 });
    await settle();
    const kick = since(ws.screen, before[3]).find((m) => m.t === "b" && m.s === 1);
    expect(kick).toMatchObject({ to: -1 });
    expect(kick.ride).toBeUndefined();
    expect(kick.c).toBeUndefined();
    expect(r.core.members[0].stunUntil ?? 0).toBeLessThan(Date.now());
  });
});
