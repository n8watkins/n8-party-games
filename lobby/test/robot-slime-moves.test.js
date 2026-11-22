// The robot's and the slime's moves (lobby/shared/robot.js, slime.js, moves.js): their rules as
// numbers, the room's judgement of each (LobbyCore.hook, dueHooks, stilts, slime, shove, and the
// kick into a robot on its legs or a hardened slime), the vote they may never flip or stall, and on
// the real Durable Object class that each reaches every page, is refused to the sender only, and
// that a hand-written client cannot cheat any of it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { BumpDraw } from "../public/bump-draw.js";
import { resumeKnock } from "../public/look3d/pieces.js";
import { IMMUNE_MS, KNOCK_CLEAR, STUN_MS, landingGround } from "../shared/bump.js";
import { wallFor } from "../shared/rooms.js";
import { CHARACTERS, LOOK_COOLDOWN_MS, moveOf } from "../shared/characters.js";
import { FADE_MS } from "../shared/ghost.js";
import { HOOK_SCARE_MS, MOVED, movedPose, movedResumed, slideLanding, touchAt } from "../shared/moves.js";
import {
  BONK_MS, HOOK_AIM_MS, HOOK_COOLDOWN_MS, HOOK_FLIGHT_MS, HOOK_HAND, HOOK_HOLD, HOOK_LATE_MS, HOOK_RANGE, HOOK_SPEED, PULL_MS, STILT_COOLDOWN_MS, STILT_MS,
  firstCatch, hookDrawn, hookTipAt, jumpedOver, battedAway, pullPose, stiltPose,
} from "../shared/robot.js";
import { ABSORB_MS, ABSORB_TURN_MS, HARDEN_MS, HOLD_MS, SHOVE_AGAIN_MS, SHOVE_MS, SHOVE_STEP, SLIME_COOLDOWN_MS, shovePose, slimeLook } from "../shared/slime.js";
import { COUNT_MS, boxFromManifest } from "../shared/vote.js";
import { POSITION_SLACK, ROOM, boxCentre, lightAt, lightHalf, posAt } from "../shared/world.js";
import { TEST_WALL, WALL } from "../wall.js";
import { dropFakeRuntime, fakeCtx, fakeEnv, openRoom, settle, useFakeRuntime, walkTo } from "./fake-room.js";
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
  core.evaluate(now);
}

function be(core, seat, character, now = 1000) {
  core.members[seat].character = character;
  core.members[seat].lookAt = now - LOOK_COOLDOWN_MS * 10;
}

/** Wakes the room at each moment from `from` to `to`, as its alarm would, and gathers what the hooks did. */
function run(core, from, to) {
  const out = [];
  for (let t = from; t <= to; t += 5) out.push(...core.dueHooks(t));
  return out;
}

/** Where the tip of a hook from x0 facing dir reaches x: when the room judges it (the late allowance on top). */
const reachesAt = (at, x0, dir, x) => at + HOOK_AIM_MS + Math.ceil(((Math.abs(x - x0) - HOOK_HAND - 30) / HOOK_SPEED) * 1000 / 5) * 5 + HOOK_LATE_MS;

describe("the robot's and the slime's rules, as numbers", () => {
  it("are the owner's: one move button each, only the pawn kicks", () => {
    expect(CHARACTERS.map((c) => [c.id, moveOf(c.id)])).toEqual([["pawn", "kick"], ["ghost", "fade"], ["slime", "harden"], ["robot", "hook"]]);
  });

  it("make the hook a quick skill shot: a short tell, about four piece widths in under a fifth of a second, a 6 s cooldown", () => {
    // Round three: "faster, in the throw and in the snap" (wind-up 150 ms, round two's was 180).
    expect(HOOK_AIM_MS).toBe(150);
    expect(HOOK_RANGE).toBe(300);
    expect(HOOK_FLIGHT_MS).toBeLessThan(200);
    expect(HOOK_COOLDOWN_MS).toBe(6000);
    expect(PULL_MS).toBeLessThan(STUN_MS);
  });

  it("put the robot up on its legs for about a second, and harden or absorb the slime for a second on a 5 s cooldown", () => {
    expect(STILT_MS).toBeGreaterThanOrEqual(1000);
    expect(STILT_MS).toBeLessThan(1300);
    expect(STILT_COOLDOWN_MS).toBeGreaterThan(STILT_MS);
    expect(HARDEN_MS).toBe(1000);
    expect(ABSORB_MS).toBe(1000);
    expect(SLIME_COOLDOWN_MS).toBe(5000);
    expect(HOLD_MS).toBeLessThan(ABSORB_TURN_MS);
  });

  it("fly the tip straight out at its speed, to the end of its reach and no further", () => {
    const hook = { at: 0, x0: 500, dir: 1 };
    expect(hookTipAt(hook, 0)).toBe(500 + HOOK_HAND);
    expect(hookTipAt(hook, HOOK_AIM_MS)).toBe(500 + HOOK_HAND);
    expect(hookTipAt(hook, HOOK_AIM_MS + 100)).toBeCloseTo(500 + HOOK_HAND + 165);
    expect(hookTipAt(hook, 5000)).toBe(500 + HOOK_HAND + HOOK_RANGE);
    expect(hookTipAt({ ...hook, dir: -1 }, 5000)).toBe(500 - HOOK_HAND - HOOK_RANGE);
  });

  it("catch the first piece in the way, never one behind the robot, nothing past the reach", () => {
    const hook = { at: 0, x0: 500, dir: 1 };
    const still = (seat, x) => ({ seat, at: () => x });
    expect(firstCatch(hook, [still(1, 700), still(2, 640)], 0, 1000)?.seat).toBe(2);
    expect(firstCatch(hook, [still(1, 400)], 0, 1000)).toBeNull();
    expect(firstCatch(hook, [still(1, 500 + HOOK_HAND + HOOK_RANGE + 40)], 0, 1000)).toBeNull();
    // A piece walking into the line is caught where the tip meets it.
    const walking = { seat: 3, at: (t) => 1000 - (430 * t) / 1000 };
    const hit = firstCatch(hook, [walking], 0, 1000);
    expect(hit?.seat).toBe(3);
    expect(Math.abs(walking.at(hit.t) - hookTipAt(hook, hit.t))).toBeLessThan(40);
  });

  it("count a jump the room heard from a jump's length before the hook arrives to the late allowance after", () => {
    expect(jumpedOver(1000, 1000)).toBe(true);
    expect(jumpedOver(1000, 1000 - HOOK_LATE_MS)).toBe(true);
    expect(jumpedOver(1000, 1000 - HOOK_LATE_MS - 1)).toBe(false);
    expect(jumpedOver(1000, 1400)).toBe(true);
    expect(jumpedOver(1000, 1500)).toBe(false);
    expect(jumpedOver(undefined, 1000)).toBe(false);
  });

  it("bat the hook away only with a kick toward the robot, in time", () => {
    expect(battedAway(900, -1, 800, 600, 1000)).toBe(true);
    expect(battedAway(900, 1, 800, 600, 1000)).toBe(false);
    expect(battedAway(500, -1, 800, 600, 1000)).toBe(false);
    expect(battedAway(1090, -1, 800, 600, 1000)).toBe(true);
  });

  it("draw the hook out, waiting at the first piece in its way until the room's word, then winding back or dragging", () => {
    const h = { at: 0, dir: 1 };
    expect(hookDrawn(h, 50, 500).state).toBe("aim");
    expect(hookDrawn(h, 50, 500).aim).toBeGreaterThan(0);
    expect(hookDrawn(h, 200, 500).state).toBe("fly");
    expect(hookDrawn(h, 600, 500, 120)).toMatchObject({ state: "wait", tip: 500 + HOOK_HAND + 120 });
    expect(hookDrawn(h, 5000, 500)).toBeNull();
    const pulled = { ...h, verdict: { at: 400, o: "pull", hitX: 700 } };
    expect(hookDrawn(pulled, 400, 500).tip).toBeCloseTo(700);
    expect(hookDrawn(pulled, 400 + PULL_MS - 1, 500).tip).toBeLessThan(600);
    expect(hookDrawn(pulled, 400 + PULL_MS, 500)).toBeNull();
    const parried = { ...h, verdict: { at: 400, o: "parry", hitX: 700, from: 700 } };
    expect(hookDrawn(parried, 460, 500).y).toBeGreaterThan(hookDrawn(parried, 400, 500).y);
  });

  it("drag a hooked piece upright and never knock it over, and stand the robot on telescoping legs", () => {
    for (let ms = 0; ms < PULL_MS; ms += 20) {
      const pose = pullPose(ms, 800, 660, IMMUNE_MS);
      expect(Math.abs(pose.tilt)).toBeLessThan(20);
      expect(pose.lift).toBeGreaterThanOrEqual(0);
      expect(pose.scared).toBe(0);
    }
    expect(pullPose(PULL_MS - 1, 800, 660, IMMUNE_MS).x).toBeCloseTo(660, 0);
    expect(stiltPose(40).out).toBeLessThan(0);
    expect(stiltPose(500).out).toBeCloseTo(1, 1);
    expect(stiltPose(STILT_MS - 150).shake).not.toBe(0);
    expect(stiltPose(STILT_MS - 150, true).shake).toBe(0);
    expect(stiltPose(STILT_MS + 10)).toMatchObject({ out: 0, state: "landed" });
    expect(stiltPose(STILT_MS + 5000).state).toBe("down");
  });

  it("snap a slime hard and melt it soft again, and turn a held press soft", () => {
    expect(slimeLook(500, HARDEN_MS)).toEqual({ hard: 1, soft: 0 });
    expect(slimeLook(HARDEN_MS + 500, HARDEN_MS).hard).toBe(0);
    const held = slimeLook(HOLD_MS + 400, HARDEN_MS, HOLD_MS, ABSORB_MS);
    expect(held.hard).toBe(0);
    expect(held.soft).toBe(1);
    expect(shovePose(SHOVE_MS / 2, 600, 660, 0).x).toBeGreaterThan(600);
    expect(Math.abs(shovePose(SHOVE_MS / 2, 600, 660, 0).tilt)).toBeLessThan(10);
  });
});

describe("a slide never puts a piece in another light (shared/moves.js)", () => {
  // The production wall (five boxes), the test wall (six), the Floor's coming four-box wall and a
  // single box, with every light on, every other one, a single pool, two pools far apart, and none:
  // a box with no pool (a coming-soon poster) is only more dark, so a pool is never assumed per box.
  const walls = [["production", WALL.boxes.length], ["test", TEST_WALL.boxes.length], ["four-box", 4], ["one box", 1]];
  for (const [name, n] of walls) {
    it(`on the ${name} wall (${n} boxes)`, () => {
      const faults = [];
      const every = Array.from({ length: n }, (_, i) => i);
      const lits = [every, every.filter((i) => i % 2 === 0), [n - 1], [...new Set([0, n - 1])], []];
      for (const lit of lits) {
        for (let from = ROOM.minX; from <= ROOM.maxX; from += 23) {
          for (let to = ROOM.minX; to <= ROOM.maxX; to += 37) {
            const at = slideLanding(from, to, n, lit);
            const own = lightAt(from, n);
            const there = lightAt(at, n);
            if (at < Math.min(from, to) - 1 || at > Math.max(from, to) + 1) faults.push(`${from}->${to}: ${at} is past it`);
            if (there !== -1 && lit.includes(there) && there !== own) faults.push(`${from}->${to}: ${at} is in light ${there}`);
          }
        }
      }
      expect(faults.slice(0, 5)).toEqual([]);
    });
  }

  // The bar's own walls (shared/rooms.js, wallFor): its pools under chosen painted frames, only
  // under the boxes that can be played, with as little as 79 units of dark between two.
  const barWalls = [["the bar, production boxes", wallFor("bar", WALL.boxes)], ["the bar, five pools", wallFor("bar", 5)], ["the bar, test boxes", wallFor("bar", TEST_WALL.boxes)]];
  for (const [name, wall] of barWalls) {
    it(`on ${name} (pools under boxes ${wall.pools.map((p) => p.i).join(", ")}; ${Math.round(wall.gap)} units of dark at the least)`, () => {
      const faults = [];
      const pools = wall.pools.map((p) => p.i);
      for (const lit of [pools, pools.slice(0, 1), pools.slice(-1), []]) {
        for (let from = ROOM.minX; from <= ROOM.maxX; from += 17) {
          for (let to = ROOM.minX; to <= ROOM.maxX; to += 29) {
            const at = slideLanding(from, to, wall, lit);
            const own = lightAt(from, wall);
            const there = lightAt(at, wall);
            if (at < Math.min(from, to) - 1 || at > Math.max(from, to) + 1) faults.push(`${from}->${to}: ${at} is past it`);
            if (there !== -1 && lit.includes(there) && there !== own) faults.push(`${from}->${to}: ${at} is in pool ${there}`);
          }
        }
      }
      expect(faults.slice(0, 5)).toEqual([]);
      // Between two pools some dark remains to come to rest in (about 11 units on the 79-unit gap).
      const ground = landingGround(wall, pools);
      for (let k = 1; k < wall.pools.length; k++) {
        const [a, b] = [wall.pools[k - 1], wall.pools[k]];
        const room = ground.filter(([s, e]) => s >= a.x + a.half - 0.5 && e <= b.x - b.half + 0.5).reduce((w, [s, e]) => Math.max(w, e - s), -1);
        const gap = b.x - b.half - (a.x + a.half);
        expect(room, `between pools ${a.i} and ${b.i}`).toBeGreaterThanOrEqual(Math.max(0, gap - 2 * KNOCK_CLEAR) - 1);
      }
    });
  }

  it("stops a piece dragged toward a lit light at its edge, in the dark, and lets one in a light stay in it", () => {
    const n = WALL.boxes.length;
    const c = boxCentre(2, n);
    const half = lightHalf(n);
    const all = [0, 1, 2, 3, 4];
    const at = slideLanding(c - half - 200, c, n, all);
    expect(lightAt(at, n)).toBe(-1);
    // Clear of the light by KNOCK_CLEAR, or by half the dark where the gap is narrower (this wall's is).
    const gap = boxCentre(1, n) - boxCentre(0, n) - 2 * half;
    expect(at).toBeLessThanOrEqual(c - half - Math.min(KNOCK_CLEAR, gap / 2) + 1);
    expect(at).toBeGreaterThan(c - half - 200);
    expect(slideLanding(c - 40, c + 40, n, all)).toBe(c + 40);
    // A light that is off is just more dark.
    expect(slideLanding(c - half - 200, c, n, [0, 1, 3, 4])).toBe(Math.round(c));
  });
});

describe("the room's judgement of the hook", () => {
  it("pulls the first piece the tip reaches to the robot, judged when the tip gets there, and spends the cooldown", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 800, 1000);
    const out = core.hook(0, 2000);
    expect(out).toMatchObject({ ok: true, relay: { t: "hook", s: 0, f: 1, x: 600 } });
    const due = reachesAt(2000, 600, 1, 800);
    expect(core.nextWake(2001)).toBe(core.members[0].hook.judgeAt);
    expect(Math.abs(core.members[0].hook.judgeAt - due)).toBeLessThanOrEqual(5);
    expect(core.dueHooks(due - 20)).toEqual([]);
    const [hk] = run(core, due - 15, due + 10);
    expect(hk).toMatchObject({ t: "hk", s: 0, o: "pull", to: 1, x: 600 + HOOK_HOLD });
    expect(core.members[1].x).toBe(600 + HOOK_HOLD);
    expect(core.view(due + 50).members[1]).toMatchObject({ fright: "pull" });
    expect(core.members[0].hook).toBeNull();
    expect(core.hook(0, due + 100)).toMatchObject({ ok: false, why: "Your hook is not ready yet." });
    expect(core.hook(0, 2000 + HOOK_COOLDOWN_MS)).toMatchObject({ ok: true });
  });

  it("misses when nobody is within reach, and says so when the tip has reached its end", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    place(core, 0, 600, 1000, -1);
    place(core, 1, 900, 1000);
    core.hook(0, 2000);
    const out = run(core, 2000, 2000 + HOOK_AIM_MS + HOOK_FLIGHT_MS + HOOK_LATE_MS + 10);
    expect(out).toEqual([{ t: "hk", s: 0, o: "miss" }]);
    expect(core.members[1].x).toBe(900);
  });

  it("catches a piece that walks into the line while the hook flies", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 1000, 1000);
    core.hook(0, 2000);
    // Bo (out of reach when it was thrown) walks toward the robot as the tip flies.
    core.move(1, { x: 1000, d: -1, r: core.members[1].rev }, 2050);
    const out = run(core, 2050, 2600);
    expect(out[0]).toMatchObject({ o: "pull", to: 1 });
  });

  it("is dodged by a jump: the hook flies on and takes the piece behind", () => {
    const core = party(["Ann", "Bo", "Cy"]);
    be(core, 0, "robot");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 720, 1000);
    place(core, 2, 840, 1000);
    core.hook(0, 2000);
    core.move(1, { x: 720, d: 0, r: core.members[1].rev, j: 1 }, 2100);
    const out = run(core, 2100, 2700);
    expect(out[0]).toMatchObject({ o: "jumped", to: 1 });
    expect(out[1]).toMatchObject({ o: "pull", to: 2 });
    expect(core.members[1].x).toBe(720);
  });

  it("does not count jumps faster than a page can jump, and a robot's own jump never dodges", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    place(core, 1, 800, 1000);
    core.move(1, { x: 800, d: 0, r: core.members[1].rev, j: 1 }, 2000);
    core.move(1, { x: 800, d: 0, r: core.members[1].rev, j: 1 }, 2100);
    expect(core.members[1].jumpAt).toBe(2000);
    core.move(0, { x: core.members[0].x, d: 0, r: core.members[0].rev, j: 1 }, 2000);
    expect(core.members[0].jumpAt).toBeUndefined();
  });

  it("is batted away by a pawn's kick toward the robot as it arrives: nothing moves, the cooldown is spent", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 800, 1000, -1);
    core.hook(0, 2000);
    core.bump(1, 2150);
    const out = run(core, 2150, 2600);
    expect(out[0]).toMatchObject({ o: "parry", to: 1 });
    expect(core.members[1].x).toBe(800);
    expect(core.hook(0, 2700)).toMatchObject({ ok: false });
  });

  it("clangs off a hardened slime and sticks to an absorbing one, dragging the robot to it", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    be(core, 1, "slime");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 800, 1000);
    core.slime(1, "harden", 2000);
    core.hook(0, 2000);
    expect(run(core, 2000, 2600)[0]).toMatchObject({ o: "clang", to: 1 });
    expect(core.members[1].x).toBe(800);
    // Later: the slime holds its button, goes soft, and the next hook turns around.
    core.slime(1, "harden", 9000);
    expect(core.slime(1, "absorb", 9000 + HOLD_MS)).toMatchObject({ ok: true, relay: { t: "slime", k: "absorb", for: ABSORB_MS } });
    core.hook(0, 9000 + HOLD_MS);
    const [stuck] = run(core, 9000 + HOLD_MS, 9900);
    expect(stuck).toMatchObject({ o: "stuck", to: 1, x: 800 - HOOK_HOLD });
    expect(core.members[0].x).toBe(800 - HOOK_HOLD);
    expect(core.members[1].x).toBe(800);
    expect(core.view(9700).members[0]).toMatchObject({ fright: "pull" });
  });

  it("passes through a faded ghost, and the robot is scared off the other way", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    be(core, 1, "ghost");
    place(core, 0, 900, 1000, 1);
    place(core, 1, 1100, 1000);
    core.fade(1, 1900);
    core.hook(0, 2000);
    const [hk] = run(core, 2000, 2600);
    expect(hk).toMatchObject({ o: "scare", to: 1 });
    expect(core.members[0].x).toBeLessThan(900);
    expect(core.members[1].x).toBe(1100);
    expect(core.view(hk ? 2400 : 0).members[0]).toMatchObject({ fright: "hookscare" });
    expect(core.members[0].stunUntil - core.members[0].immuneUntil).toBe(-IMMUNE_MS);
    expect(HOOK_SCARE_MS).toBeGreaterThan(PULL_MS);
  });

  it("bonks two robots that hook each other: both yanked to the middle, both stunned, both cooldowns spent", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    be(core, 1, "robot");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 840, 1000, -1);
    core.hook(0, 2000);
    core.hook(1, 2010);
    const out = run(core, 2000, 2700);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ o: "bonk" });
    expect(Math.abs(core.members[0].x - 720)).toBeLessThanOrEqual(HOOK_HOLD / 2 + 1);
    expect(Math.abs(core.members[1].x - 720)).toBeLessThanOrEqual(HOOK_HOLD / 2 + 1);
    for (const m of core.members.slice(0, 2)) {
      expect(m.fright).toBe("bonk");
      expect(m.hook).toBeNull();
    }
    expect(core.hook(1, 3000)).toMatchObject({ ok: false, why: "Your hook is not ready yet." });
    expect(BONK_MS).toBeLessThan(STUN_MS);
  });

  it("folds a robot pulled while it drags a catch into a hook train: all three in a line", () => {
    const core = party(["Ann", "Bo", "Cy"]);
    be(core, 0, "robot");
    be(core, 1, "robot");
    // B at 400 facing right, A at 650 facing right, the pawn at 850.
    place(core, 1, 400, 1000, 1);
    place(core, 0, 650, 1000, 1);
    place(core, 2, 850, 1000);
    core.hook(0, 2000);
    const first = run(core, 2000, 2400);
    expect(first[0]).toMatchObject({ s: 0, o: "pull", to: 2 });
    const pulledAt = core.members[0].pulled.at;
    // B's hook reaches A while A is still dragging the pawn in.
    core.members[1].hookAt = -Infinity;
    core.hook(1, pulledAt - HOOK_AIM_MS - 60);
    const train = run(core, pulledAt - 100, pulledAt + 600);
    const hk = train.find((m) => m.s === 1);
    expect(hk).toMatchObject({ o: "pull", to: 0, tr: { s: 2 } });
    const xs = [1, 0, 2].map((s) => core.members[s].x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it("keeps a robot's own hook flying when it is pulled while it throws (hooked while hooking)", () => {
    const core = party(["Ann", "Bo", "Cy"]);
    be(core, 0, "robot");
    be(core, 1, "robot");
    place(core, 1, 300, 1000, 1);
    place(core, 0, 520, 1000, 1);
    place(core, 2, 700, 1000);
    core.hook(1, 2000);
    core.hook(0, 2060);
    const out = run(core, 2000, 2900);
    expect(out.map((m) => m.s)).toEqual([1, 0]);
    expect(out[0]).toMatchObject({ o: "pull", to: 0, x: 300 + HOOK_HOLD });
    // A's hook flew on from where A was dragged, and brought the pawn in behind it: all three in a line.
    expect(out[1]).toMatchObject({ o: "pull", to: 2, x: 300 + 2 * HOOK_HOLD });
  });

  it("hooks during the count without changing the vote, and pulls a piece out of its light, never into one", () => {
    const n = TEST_WALL.boxes.length;
    const core = party(["Ann", "Bo"], TEST_WALL);
    be(core, 0, "robot");
    const coin = TEST_WALL.boxes.findIndex((b) => b.id === "coin-flip");
    const mid = boxCentre(coin, n);
    // Both vote for Coin Flip: the count runs.
    place(core, 0, mid - 30, 1000, 1);
    place(core, 1, mid + 40, 1000);
    expect(core.count).not.toBeNull();
    // A hook is allowed during the count; it pulls Bo within the same light: the vote stands.
    core.hook(0, 2000);
    run(core, 2000, 2500);
    expect(lightAt(core.members[1].x, n)).toBe(coin);
    core.evaluate(2500);
    expect(core.count).not.toBeNull();
    // The robot steps out into the dark (the count stops) and hooks Bo out of the light: no count starts.
    place(core, 0, mid - lightHalf(n) - 140, 9000, 1);
    core.evaluate(9000);
    core.members[0].hookAt = -Infinity;
    place(core, 0, mid - lightHalf(n) - 140, 9001, 1);
    place(core, 1, mid - lightHalf(n) + 20, 9001);
    core.hook(0, 9100);
    run(core, 9100, 9600);
    expect(lightAt(core.members[1].x, n)).toBe(-1);
    core.evaluate(9600);
    expect(core.count).toBeNull();
  });

  it("stops the count rather than starting a game when a hook judged as the count ends takes a voter out of the light", () => {
    const n = TEST_WALL.boxes.length;
    const core = party(["Ann", "Bo"], TEST_WALL);
    be(core, 0, "robot");
    be(core, 1, "slime");
    const lit = core.litPlaces();
    const i = lit.find((k) => lit.includes(k + 1));
    // The robot at the right edge of one light, the slime at the left of the next: both vote, the count runs.
    place(core, 0, Math.round(boxCentre(i, n) + lightHalf(n) - 10), 1000, 1);
    place(core, 1, Math.round(boxCentre(i + 1, n) - lightHalf(n) + 30), 1000);
    expect(core.count).not.toBeNull();
    const endsAt = core.count.endsAt;
    // The slime goes soft, and the robot's hook sticks to it as the count ends: the robot is dragged
    // out of its light toward the slime, and never into the slime's light.
    // Soft before the hook is thrown, so it is soft when the tip gets there.
    core.slime(1, "harden", endsAt - 700);
    core.slime(1, "absorb", endsAt - 700 + HOLD_MS);
    core.hook(0, endsAt - 400);
    expect(core.members[0].hook.judgeAt).toBeLessThanOrEqual(endsAt);
    core.members[0].hook.judgeAt = endsAt;
    const out = core.tick(endsAt);
    expect(out.hooks[0]).toMatchObject({ o: "stuck" });
    expect(lightAt(core.members[0].x, n)).toBe(-1);
    expect(out.start).toBeNull();
    expect(out.changed).toBe(true);
    core.evaluate(endsAt);
    expect(core.count).toBeNull();
  });

  it("refuses a hook to a non-robot (a cheat), on its legs, during a game, and too soon (honest unless far too soon)", () => {
    const core = party(["Ann", "Bo"]);
    expect(core.hook(0, 2000)).toMatchObject({ ok: false, why: "Only a robot can hook.", bad: true });
    be(core, 0, "robot");
    core.stilts(0, 2000);
    expect(core.hook(0, 2100)).toMatchObject({ ok: false, why: "Not while you are up on your legs.", bad: false });
    const thrown = 2000 + STILT_MS;
    expect(core.hook(0, thrown)).toMatchObject({ ok: true });
    expect(core.hook(0, thrown + 50)).toMatchObject({ ok: false, why: "Your hook is still out.", bad: false });
    run(core, thrown, thrown + 1000);
    expect(core.hook(0, thrown + HOOK_COOLDOWN_MS - 400)).toMatchObject({ ok: false, bad: false });
    expect(core.hook(0, thrown + 1000)).toMatchObject({ ok: false, bad: true });
    // A robot that just became one may still have a hook on its way: honest.
    core.members[1].lookAt = 5000;
    expect(core.hook(1, 5100)).toMatchObject({ ok: false, bad: false });
  });

  it("drops a hook still out when its robot is knocked, becomes something else, or the party leaves the room", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 500, 1000, 1);
    core.hook(0, 2000);
    core.bump(1, 2050);
    expect(core.members[0].hook).toBeNull();
    expect(core.drainMoves()).toEqual([{ t: "hk", s: 0, o: "off" }]);
    core.members[0].hookAt = -Infinity;
    core.members[0].stunUntil = 0;
    core.members[0].immuneUntil = 0;
    core.hook(0, 9000);
    core.setLook(0, { c: "pawn" }, 9050);
    expect(core.members[0].hook).toBeNull();
    expect(core.drainMoves()).toEqual([{ t: "hk", s: 0, o: "off" }]);
  });
});

describe("the room's own wall (the bar's placed pools, #58)", () => {
  it("lands every slide by the room's wall itself, not a count of boxes", () => {
    const core = party(["Ann", "Bo"], WALL);
    expect(typeof core.landingWall()).toBe("object");
    expect(core.landingWall()).toEqual(core.wall);
    expect(core.wall.pools.length).toBeGreaterThan(0);
  });

  it("ends every move when the party moves to a room that hangs its boxes elsewhere (a hook out is dropped)", () => {
    const core = party(["Ann", "Bo"], WALL);
    be(core, 0, "robot");
    be(core, 1, "slime");
    expect(core.room).toBe("bar");
    place(core, 0, 400, 1000, 1);
    core.hook(0, 2000);
    core.slime(1, "harden", 2000);
    const host = core.hostToken;
    const before = core.wall;
    const out = core.setRoom(host, "ship", 2050);
    expect(out).toMatchObject({ ok: true, moved: true });
    expect(before.placed && !core.wall.placed).toBe(true);
    expect(core.members[0].hook).toBeNull();
    expect(core.members[1].hardUntil).toBe(2050);
    expect(core.drainMoves()).toEqual([{ t: "hk", s: 0, o: "off" }]);
    expect(core.dueHooks(3000)).toEqual([]);
  });
});

describe("found in review of #69", () => {
  /** Rob (a robot) in the second pool facing left, Pat at the first pool's right edge, Sam beside Rob: all three vote, the count runs. */
  function countWithHook() {
    const n = TEST_WALL.boxes.length;
    const core = party(["Rob", "Pat", "Sam"], TEST_WALL);
    be(core, 0, "robot");
    const [c0, c1] = [boxCentre(0, n), boxCentre(1, n)];
    expect(core.litPlaces().slice(0, 2)).toEqual([0, 1]);
    place(core, 1, Math.round(c0 + 17), 1000);
    place(core, 2, Math.round(c1 + 63), 1000);
    place(core, 0, Math.round(c1 - 17), 1000, -1);
    expect(core.count).not.toBeNull();
    return { core, n, endsAt: core.count.endsAt };
  }

  for (const before of [293, 252]) {
    it(`stops the count for a hook that reaches a voter ${before} ms before the count ends (the count waits for it to be judged)`, () => {
      const { core, n, endsAt } = countWithHook();
      core.hook(0, endsAt - before);
      const judgeAt = core.members[0].hook.judgeAt;
      expect(judgeAt - HOOK_LATE_MS).toBeLessThanOrEqual(endsAt);
      expect(judgeAt).toBeGreaterThan(endsAt);
      // The count's own moment comes first: the room waits, and wakes for the hook instead.
      const atEnd = core.tick(endsAt);
      expect(atEnd.start).toBeNull();
      expect(core.count).not.toBeNull();
      expect(core.nextWake(endsAt)).toBe(judgeAt);
      // The hook pulls Pat out of his light, toward Rob's (never into it): the count stops, no game starts.
      const out = core.tick(judgeAt);
      expect(out.hooks[0]).toMatchObject({ o: "pull", to: 1 });
      expect(lightAt(core.members[1].x, n)).toBe(-1);
      expect(out.start).toBeNull();
      core.evaluate(judgeAt);
      expect(core.count).toBeNull();
      expect(core.activity.kind).toBe("lobby");
    });
  }

  it("still ends the count on time for a hook that reaches its voter only after the end", () => {
    const { core, endsAt } = countWithHook();
    core.hook(0, endsAt - 100);
    expect(core.members[0].hook.judgeAt - HOOK_LATE_MS).toBeGreaterThan(endsAt);
    expect(core.tick(endsAt).start).toBe(core.boxes[1].id);
  });

  it("judges a hook by what the piece was doing when the tip reached it: a harden heard 144 ms after that is too late", () => {
    const core = party(["Rob", "Sam"]);
    be(core, 0, "robot");
    be(core, 1, "slime");
    place(core, 0, 1200, 1000, 1);
    place(core, 1, 1500, 1000);
    core.hook(0, 2000);
    const judgeAt = core.members[0].hook.judgeAt;
    // Sam walks into the line 20 ms after the throw: the tip meets him sooner than the room worked out at the throw.
    core.move(1, { x: 1500, d: -1, r: core.members[1].rev }, 2020);
    const strike = firstCatch(core.members[0].hook, [{ seat: 1, at: (t) => posAt(core.members[1], t) }], 2000, 3000).t;
    expect(strike + HOOK_LATE_MS).toBeLessThan(judgeAt);
    core.slime(1, "harden", strike + 144);
    const [hk] = run(core, strike + 145, judgeAt + 10);
    expect(hk).toMatchObject({ o: "pull", to: 1 });
    // Heard within the allowance, a harden still clangs.
    const again = party(["Rob", "Sam"]);
    be(again, 0, "robot");
    be(again, 1, "slime");
    place(again, 0, 1200, 1000, 1);
    place(again, 1, 1500, 1000);
    again.hook(0, 2000);
    again.move(1, { x: 1500, d: -1, r: again.members[1].rev }, 2020);
    again.slime(1, "harden", strike + 60);
    expect(run(again, strike + 61, judgeAt + 10)[0]).toMatchObject({ o: "clang" });
  });

  it("drags a hook train's catch only if nothing has moved it since it was caught, and by the rules of a pull", () => {
    const core = party(["Ann", "Bo", "Cy"]);
    be(core, 0, "robot");
    be(core, 1, "robot");
    place(core, 1, 400, 1000, 1);
    place(core, 0, 650, 1000, 1);
    place(core, 2, 850, 1000);
    core.hook(0, 2000);
    run(core, 2000, 2400);
    const pulledAt = core.members[0].pulled.at;
    // The catch is knocked by something else before Bo's hook reaches Ann: it is not dragged along.
    core.throwPiece(core.members[2], 1, pulledAt + 10);
    const kickedTo = core.members[2].x;
    core.members[1].hookAt = -Infinity;
    core.hook(1, pulledAt - HOOK_AIM_MS - 60);
    const hk = run(core, pulledAt - 100, pulledAt + 600).find((m) => m.s === 1);
    expect(hk).toMatchObject({ o: "pull", to: 0 });
    expect(hk.tr).toBeUndefined();
    expect(core.members[2].x).toBe(kickedTo);
  });
});

describe("on a wall whose pools are only some of its boxes (coming-soon posters have none)", () => {
  /** A wall of four boxes of which only the playable ones (`playable`, by place) have a light. */
  function wallOf(playable) {
    const boxes = [0, 1, 2, 3].map((i) =>
      playable.includes(i)
        ? boxFromManifest({ ...coinFlipManifest, id: `play-${i}`, players: { min: 1, max: 4 } }, { test: true })
        : boxFromManifest({ id: `soon-${i}`, name: `Soon ${i}`, players: { min: 1, max: 4 }, devices: { phone: true } }, { soon: true }),
    );
    return { boxes, games: new Map(boxes.filter((b) => b.id.startsWith("play")).map((b) => [b.id, coinFlip])) };
  }
  for (const [name, playable] of [["one pool", [1]], ["two pools", [0, 3]]]) {
    it(`never pulls or shoves a piece into a pool (${name}), and lets it rest under a poster with none`, () => {
      const core = party(["Ann", "Bo"], wallOf(playable));
      expect(core.litPlaces()).toEqual(playable);
      be(core, 0, "robot");
      const n = 4;
      // A pull from the dark toward a robot standing in the first pool: it stops in the dark short of it.
      const pool = boxCentre(playable[0], n);
      const half = lightHalf(n);
      place(core, 0, Math.round(pool), 1000, -1);
      place(core, 1, Math.round(pool - half - 140), 1000);
      core.hook(0, 2000);
      run(core, 2000, 2600);
      expect(lightAt(core.members[1].x, n) === -1 || !playable.includes(lightAt(core.members[1].x, n))).toBe(true);
      expect(core.members[1].x).toBeLessThan(pool - half);
      // A piece under an unlit poster is in the dark: a hook may leave it there.
      const unlit = [0, 1, 2, 3].find((i) => !playable.includes(i));
      core.members[0].hookAt = -Infinity;
      Object.assign(core.members[1], { stunUntil: 0, immuneUntil: 0 });
      place(core, 0, Math.round(boxCentre(unlit, n)), 9000, 1);
      place(core, 1, Math.round(boxCentre(unlit, n) + 180), 9000);
      core.hook(0, 9100);
      expect(run(core, 9100, 9700)[0]).toMatchObject({ o: "pull", x: Math.round(boxCentre(unlit, n)) + HOOK_HOLD });
    });
  }
});

describe("the room's judgement of the legs, the harden and the shove", () => {
  it("lets a kick swing under a robot up on its legs, and land once they are down", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 1, "robot");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 660, 1000);
    expect(core.stilts(1, 2000)).toMatchObject({ ok: true, relay: { t: "stilts", s: 1, for: STILT_MS } });
    expect(core.bump(0, 2100)).toMatchObject({ to: -1 });
    expect(core.members[1].x).toBe(660);
    expect(core.bump(0, 2000 + STILT_MS + 2600)).toMatchObject({ to: 1 });
    expect(core.stilts(1, 2000 + 400)).toMatchObject({ ok: false, why: "Not while you are knocked over." });
  });

  it("refuses legs to anyone but a robot, and while its hook is out; allows them during the count", () => {
    const core = party(["Ann", "Bo"]);
    expect(core.stilts(0, 2000)).toMatchObject({ ok: false, why: "Only a robot has stilt legs.", bad: true });
    be(core, 0, "robot");
    core.hook(0, 2000);
    expect(core.stilts(0, 2050)).toMatchObject({ ok: false, why: "Your hook is still out." });
  });

  it("bounces a kick off a hardened slime: the kicker is knocked back, the slime stays", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 1, "slime");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 680, 1000);
    core.slime(1, "harden", 2000);
    const hit = core.bump(0, 2100);
    expect(hit).toMatchObject({ t: "b", s: 0, to: -1, bo: 1 });
    expect(core.members[0].x).toBeLessThan(600);
    expect(core.members[1].x).toBe(680);
    expect(core.members[0].stunUntil).toBe(2100 + STUN_MS);
    // Once soft again it can be kicked: the window to be hit.
    core.members[0].bumpAt = -Infinity;
    Object.assign(core.members[0], { stunUntil: 0, immuneUntil: 0 });
    place(core, 0, 600, 2000 + HARDEN_MS + 10, 1);
    expect(core.bump(0, 2000 + HARDEN_MS + 10)).toMatchObject({ to: 1 });
  });

  it("turns only a fresh harden soft (the held press), on the same cooldown", () => {
    const core = party(["Ann"]);
    be(core, 0, "slime");
    expect(core.slime(0, "absorb", 2000)).toMatchObject({ ok: false });
    core.slime(0, "harden", 2000);
    expect(core.slime(0, "absorb", 2000 + ABSORB_TURN_MS + 10)).toMatchObject({ ok: false });
    expect(core.slime(0, "harden", 2500)).toMatchObject({ ok: false, why: "Not ready yet.", bad: true });
    expect(core.slime(0, "harden", 2000 + SLIME_COOLDOWN_MS)).toMatchObject({ ok: true });
    expect(core.slime(0, "absorb", 2000 + SLIME_COOLDOWN_MS + HOLD_MS)).toMatchObject({ ok: true });
    expect(core.slime(0, "absorb", 2000 + SLIME_COOLDOWN_MS + HOLD_MS + 20)).toMatchObject({ ok: false });
    expect(core.slime(0, "sneeze", 9000)).toMatchObject({ ok: false, bad: true });
    be(core, 0, "pawn");
    expect(core.slime(0, "harden", 20000)).toMatchObject({ ok: false, bad: true });
  });

  it("shoves a piece a step on when a walking slime touches it, not again for a moment, and never a slime, a robot up, or a faded ghost", () => {
    const core = party(["Ann", "Bo", "Cy"]);
    be(core, 0, "slime");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 660, 1000);
    core.move(0, { x: 600, d: 1, r: core.members[0].rev }, 2000);
    const out = core.shove(0, 1, 2000);
    expect(out).toMatchObject({ ok: true, relay: { t: "shove", s: 0, to: 1, x: 660 + SHOVE_STEP } });
    expect(core.shove(0, 1, 2000 + SHOVE_AGAIN_MS - 10)).toMatchObject({ ok: false, bad: false });
    expect(core.view(2050).members[1]).toMatchObject({ fright: "shove" });
    // Nobody shoves a slime; a robot on its legs is stepped over; a faded ghost is not touched.
    for (const [character, setup] of [["slime", () => {}], ["robot", (now) => core.stilts(2, now)], ["ghost", (now) => core.fade(2, now)]]) {
      be(core, 2, character);
      Object.assign(core.members[2], { stiltAt: -Infinity, fadeAt: -Infinity });
      place(core, 2, 900, 3000);
      place(core, 0, 850, 3000, 1);
      setup(3000);
      core.move(0, { x: 850, d: 1, r: core.members[0].rev }, 3000);
      expect(core.shove(0, 2, 3010), character).toMatchObject({ ok: false, bad: false });
      expect(core.members[2].x).toBe(900);
    }
    // A hardened slime does not shove; a pawn never shoves (a cheat).
    core.slime(0, "harden", 3100);
    expect(core.shove(0, 1, 3150)).toMatchObject({ ok: false, bad: false });
    expect(core.shove(1, 0, 3150)).toMatchObject({ ok: false, bad: true });
    // Across the room: a cheat.
    place(core, 0, 400, 9000, 1);
    place(core, 1, 1700, 9000);
    core.move(0, { x: 400, d: 1, r: core.members[0].rev }, 9000);
    expect(core.shove(0, 1, 9010)).toMatchObject({ ok: false, bad: true });
    expect(core.members[1].x).toBe(1700);
  });

  it("never shoves a piece into another light, on the production wall and the test wall", () => {
    for (const wall of [WALL, TEST_WALL]) {
      const core = party(["Ann", "Bo"], wall);
      be(core, 0, "slime");
      // The room's own wall: its pools where it hangs them (only the boxes that can be played have one).
      const lit = core.litPlaces();
      const pool = core.wall.pools.find((p) => lit.includes(p.i));
      const edge = pool.x - pool.half;
      place(core, 1, Math.round(edge - KNOCK_CLEAR - 5), 1000);
      place(core, 0, Math.round(edge - KNOCK_CLEAR - 65), 1000, 1);
      core.move(0, { x: core.members[0].x, d: 1, r: core.members[0].rev }, 2000);
      core.shove(0, 1, 2000);
      expect(lightAt(core.members[1].x, core.wall)).toBe(-1);
    }
  });
});

describe("the room's own look along the floor (sweep): a slow phone cannot walk through anyone", () => {
  /** A seat starts walking at x in direction d at `now`, as its page says. */
  const walk = (core, seat, x, d, now) => core.move(seat, { x, d, r: core.members[seat].rev }, now);

  it("touchAt finds where a gap first comes into a touch, even when it jumps right across in one step", () => {
    expect(touchAt(50, 30, 0, 70)).toBe(0);
    expect(touchAt(170, 70, 0, 70)).toBe(1);
    expect(touchAt(170, -130, 0, 70)).toBeCloseTo(100 / 300);
    expect(touchAt(-100, 100, -46, 46)).toBeCloseTo(54 / 200);
    expect(touchAt(170, 120, 0, 70)).toBeNull();
    expect(touchAt(-10, -200, 0, 70)).toBeNull();
  });

  it("shoves a piece once that a slime's walk jumped right across between two looks, and puts it ahead of the slime", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "slime");
    place(core, 0, 600, 1000);
    place(core, 1, 700, 1000);
    walk(core, 0, 600, 1, 2000);
    expect(core.dueMoves(2000)).toEqual([]);
    // 400 ms with no word from the slime's phone: the room has it at 772, past Bo at 700.
    const out = core.dueMoves(2400);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ t: "shove", s: 0, to: 1 });
    expect(core.members[1].x).toBeGreaterThan(posAt(core.members[0], 2400));
    expect(core.members[1]).toMatchObject({ fright: "shove" });
    // Its page's own word on the same touch, coming late, is refused quietly.
    expect(core.shove(0, 1, 2410)).toMatchObject({ ok: false, bad: false });
    // Looked at again a moment later: not shoved twice for the one touch.
    expect(core.dueMoves(2450)).toEqual([]);
  });

  it("spooks a piece once that a faded ghost drifted right through in one step, and never twice in the fade, however often its path crosses her", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "ghost");
    core.members[0].fadeAt = -Infinity;
    place(core, 0, 500, 1000);
    place(core, 1, 600, 1000);
    expect(core.fade(0, 2000)).toMatchObject({ ok: true });
    walk(core, 0, 500, 1, 2000);
    expect(core.dueMoves(2000)).toEqual([]);
    // 500 ms with no boo from the ghost's phone: it is at 715, through Ann at 600.
    const out = core.dueMoves(2500);
    expect(out).toEqual([expect.objectContaining({ t: "spook", s: 0, to: 1 })]);
    // Its phone's boo about her after is refused quietly: the room heard it already.
    expect(core.boo(0, 1, 2510)).toMatchObject({ ok: false, why: "Already spooked by this fade.", bad: false });
    // Back through where she is now, and on through again: never a second spook in this fade.
    const there = core.members[1].x;
    walk(core, 0, posAt(core.members[0], 2600), Math.sign(there - posAt(core.members[0], 2600)) || -1, 2600);
    expect(core.dueMoves(3100)).toEqual([]);
    walk(core, 0, posAt(core.members[0], 3100), -core.members[0].d, 3100);
    expect(core.dueMoves(3600)).toEqual([]);
  });

  it("does not spook after the fade is over, and never shoves or spooks a piece a page would not (a slime, a ghost, a robot up)", () => {
    const core = party(["Ann", "Bo", "Cy"]);
    be(core, 0, "ghost");
    core.members[0].fadeAt = -Infinity;
    place(core, 0, 300, 1000);
    place(core, 1, 300 + 430 * (FADE_MS / 1000) + 200, 1000);
    // Cy behind the ghost, out of its way.
    place(core, 2, 150, 1000);
    core.fade(0, 2000);
    walk(core, 0, 300, 1, 2000);
    core.dueMoves(2000);
    // It reaches Bo only after its fade has ended: nothing.
    expect(core.dueMoves(2000 + FADE_MS + 1000)).toEqual([]);
    for (const [now, character, setup] of [[20_000, "slime", () => {}], [30_000, "robot", (t) => core.stilts(2, t)], [40_000, "ghost", (t) => core.fade(2, t)]]) {
      be(core, 1, "slime");
      be(core, 2, character);
      Object.assign(core.members[2], { stiltAt: -Infinity, fadeAt: -Infinity });
      place(core, 1, 600, now);
      place(core, 2, 700, now);
      setup(now);
      walk(core, 1, 600, 1, now);
      core.dueMoves(now);
      expect(core.dueMoves(now + 400), character).toEqual([]);
    }
  });

  it("wakes the room when a walking slime or faded ghost will reach someone, and not for a piece it is already against", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "slime");
    place(core, 0, 600, 1000);
    place(core, 1, 800, 1000);
    walk(core, 0, 600, 1, 2000);
    // 200 apart, a touch at 70: 130 units at 430 a second.
    expect(core.nextTouch(2000)).toBeCloseTo(2000 + (130 / 430) * 1000, 0);
    expect(core.nextWake(2000)).toBeLessThanOrEqual(core.nextTouch(2000));
    walk(core, 0, 600, 0, 2100);
    expect(core.nextTouch(2100)).toBeNull();
  });

  it("never shoves a piece into another light along the path, on the production wall and the test wall", () => {
    for (const wall of [WALL, TEST_WALL]) {
      const core = party(["Ann", "Bo"], wall);
      be(core, 0, "slime");
      const lit = core.litPlaces();
      const pool = core.wall.pools.find((p) => lit.includes(p.i));
      const edge = pool.x - pool.half;
      place(core, 1, Math.round(edge - KNOCK_CLEAR - 5), 1000);
      place(core, 0, Math.max(ROOM.minX, Math.round(edge - KNOCK_CLEAR - 200)), 1000);
      walk(core, 0, core.members[0].x, 1, 2000);
      core.dueMoves(2000);
      // One look, well after the slime walked through where Bo stood.
      const past = 2000 + Math.round(((core.members[1].x - core.members[0].x + 40) / 430) * 1000);
      expect(core.dueMoves(past)).toEqual([expect.objectContaining({ t: "shove", s: 0, to: 1 })]);
      expect(lightAt(core.members[1].x, core.wall)).toBe(-1);
    }
  });
});

describe("what a page that arrives in the middle is told, and draws", () => {
  it("tells it of a hook out, legs up, a harden or an absorb, and every cooldown", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 0, "robot");
    be(core, 1, "slime");
    place(core, 0, 600, 1000, -1);
    core.hook(0, 2000);
    expect(core.view(2100).members[0]).toMatchObject({ hook: { in: 100, f: -1 }, hookCool: HOOK_COOLDOWN_MS - 100 });
    run(core, 2000, 2600);
    core.stilts(0, 3000);
    expect(core.view(3200).members[0]).toMatchObject({ stilts: 200, stiltCool: STILT_COOLDOWN_MS - 200 });
    core.slime(1, "harden", 3000);
    expect(core.view(3200).members[1]).toMatchObject({ hard: HARDEN_MS - 200, slimeCool: SLIME_COOLDOWN_MS - 200 });
    core.slime(1, "absorb", 3000 + HOLD_MS);
    expect(core.view(3400).members[1]).toMatchObject({ soft: ABSORB_MS - (400 - HOLD_MS) });
    expect(core.view(3400).members[1].hard).toBeUndefined();
  });

  it("draws a pull, a shove, a bonk and a robot's scare as themselves in both looks, already where the room put them", () => {
    const now = 10_000;
    for (const kind of ["pull", "shove", "bonk", "hookscare"]) {
      const down = 100;
      const safe = down + 500;
      const flat = { rx: 700 };
      BumpDraw.prototype.resume.call(null, flat, 700, down, safe, now, kind);
      expect(flat.knock, kind).toBeUndefined();
      expect(flat.fright).toMatchObject({ how: MOVED[kind].how, from: 700, to: 700, kind });
      const solid = { rx: 700 };
      resumeKnock(solid, 700, down, safe, now, kind);
      expect(solid.knock).toBeUndefined();
      expect(solid.fright).toMatchObject({ how: MOVED[kind].how, kind });
      expect(movedPose(solid.fright, now - solid.fright.at).state).not.toBe("up");
      expect(movedPose(solid.fright, now + safe + 1 - solid.fright.at).state).toBe("up");
      expect(movedResumed(700, down, safe, kind, now).at).toBe(now - (MOVED[kind].ms - down));
    }
  });
});

describe("the robot's and the slime's moves on the real room", () => {
  beforeEach(useFakeRuntime);
  afterEach(dropFakeRuntime);

  /** Ann a robot, Bo a slime, Cy a pawn, and a screen, on the real room. */
  async function room() {
    // A game for one to four, so its light is on for the three of them.
    const r = await openRoom(createLobbyRoom, turnGame(), { players: { min: 1, max: 4 } });
    const { ctx, connect, say } = r;
    ctx.keepAlive = true;
    const tokens = [await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" })];
    for (const name of ["Bo", "Cy"]) tokens.push(await ctx.room.join({ nickname: name, as: "player" }));
    const screen = await ctx.room.join({ as: "screen" });
    const ws = [];
    for (const t of tokens) ws.push(await connect(t.token));
    ws.screen = await connect(screen.token);
    await settle();
    say(ws[0], { t: "look", c: "robot" });
    say(ws[1], { t: "look", c: "slime" });
    await settle();
    await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
    const strikes = (i) => ctx.room.sockets.get(ws[i]).bucket.strikes;
    return { ...r, ws, strikes, core: ctx.room.core };
  }
  const mark = (...sockets) => sockets.map((ws) => ws.frames.length);
  const since = (ws, n) => ws.messages().slice(n);

  it("tells every page of a hook, then wakes when it lands and tells every page what came of it", async () => {
    const { ctx, say, ws, core } = await room();
    await walkTo(say, ctx, ws[0], 0, 600);
    say(ws[0], { t: "m", x: 600, d: 1, r: core.members[0].rev });
    say(ws[0], { t: "m", x: 600, d: 0, r: core.members[0].rev });
    await walkTo(say, ctx, ws[2], 2, 820);
    await settle();
    const before = mark(ws[0], ws[1], ws[2], ws.screen);
    say(ws[0], { t: "hook" });
    await settle();
    for (const [i, page] of [ws[0], ws[1], ws[2], ws.screen].entries()) expect(since(page, before[i]).find((m) => m.t === "hook")).toMatchObject({ t: "hook", s: 0, f: 1, x: 600 });
    // Nothing has landed yet: the room wakes for it.
    expect(since(ws[2], before[2]).some((m) => m.t === "hk")).toBe(false);
    expect(ctx.alarmAt ?? ctx.room.alarmAt).toBeTruthy();
    await vi.advanceTimersByTimeAsync(HOOK_AIM_MS + HOOK_FLIGHT_MS + HOOK_LATE_MS + 50);
    for (const [i, page] of [ws[0], ws[1], ws[2], ws.screen].entries()) expect(since(page, before[i]).find((m) => m.t === "hk")).toMatchObject({ s: 0, o: "pull", to: 2, x: 600 + HOOK_HOLD });
    expect(core.members[2].x).toBe(600 + HOOK_HOLD);
  });

  it("shoves Cy when Bo's slime walks into him though Bo's phone never says so: the room wakes for the touch and tells every page", async () => {
    const { ctx, say, ws, core } = await room();
    await walkTo(say, ctx, ws[2], 2, 900);
    await walkTo(say, ctx, ws[1], 1, 600);
    await settle();
    const before = mark(ws[0], ws[1], ws[2], ws.screen);
    // Bo starts walking right, and his phone goes quiet: no shove, no stop.
    say(ws[1], { t: "m", x: core.members[1].x, d: 1, r: core.members[1].rev });
    await settle();
    expect(since(ws[2], before[2]).some((m) => m.t === "shove")).toBe(false);
    await vi.advanceTimersByTimeAsync(Math.ceil(((900 - 600) / 430) * 1000) + 100);
    for (const [i, page] of [ws[0], ws[1], ws[2], ws.screen].entries()) expect(since(page, before[i]).find((m) => m.t === "shove"), `page ${i}`).toMatchObject({ t: "shove", s: 1, to: 2 });
    expect(core.members[2].x).toBeGreaterThan(900);
  });

  it("refuses moves to the sender only, with the wait, and says nothing of a shove it did not take", async () => {
    const { say, ws } = await room();
    say(ws[0], { t: "hook" });
    await settle();
    const before = mark(ws[0], ws[1]);
    say(ws[0], { t: "hook" });
    say(ws[1], { t: "slime", k: "harden" });
    say(ws[1], { t: "slime", k: "harden" });
    say(ws[1], { t: "shove", to: 2 });
    await settle();
    const no = since(ws[0], before[0]).find((m) => m.t === "hook-no");
    expect(no.why).toMatch(/still out|not ready/);
    expect(since(ws[1], before[1]).find((m) => m.t === "slime-no")).toMatchObject({ why: "Not ready yet.", k: "harden" });
    expect(since(ws[1], before[1]).some((m) => m.t === "shove-no")).toBe(false);
    expect(since(ws[1], before[1]).some((m) => m.t === "hook-no")).toBe(false);
  });

  it("closes a socket that spams the moves it does not have, or far too soon", async () => {
    const { say, ws } = await room();
    for (let i = 0; i < 40 && !ws[2].closed; i++) {
      say(ws[2], { t: "hook" });
      say(ws[2], { t: "shove", to: 0 });
    }
    await settle();
    expect(ws[2].closed).not.toBeNull();
    say(ws[1], { t: "slime", k: "harden" });
    for (let i = 0; i < 40 && !ws[1].closed; i++) say(ws[1], { t: "slime", k: "harden" });
    await settle();
    expect(ws[1].closed).not.toBeNull();
    expect(ws[0].closed).toBeNull();
  });

  it("never strikes an honest robot and slime over a long session of hooks, legs, hardens and shoves", async () => {
    const { ctx, say, ws, strikes, core } = await room();
    for (let round = 0; round < 6; round++) {
      await walkTo(say, ctx, ws[0], 0, 500);
      await walkTo(say, ctx, ws[1], 1, 680);
      await walkTo(say, ctx, ws[2], 2, 760);
      // The robot throws when its own cooldown is over, goes up when its legs are ready.
      if (core.members[0].hookAt === undefined || Date.now() - core.members[0].hookAt >= HOOK_COOLDOWN_MS) say(ws[0], { t: "hook" });
      await vi.advanceTimersByTimeAsync(600);
      if (Date.now() - (core.members[0].stiltAt ?? -Infinity) >= STILT_COOLDOWN_MS) say(ws[0], { t: "stilts" });
      // The slime presses and holds, and walks into the pawn.
      if (Date.now() - (core.members[1].slimeAt ?? -Infinity) >= SLIME_COOLDOWN_MS) {
        say(ws[1], { t: "slime", k: "harden" });
        await vi.advanceTimersByTimeAsync(HOLD_MS);
        say(ws[1], { t: "slime", k: "absorb" });
      }
      await vi.advanceTimersByTimeAsync(ABSORB_MS + 50);
      const m = core.members[1];
      say(ws[1], { t: "m", x: Math.round(posAt(m, Date.now())), d: 1, r: m.rev });
      say(ws[1], { t: "shove", to: 2 });
      say(ws[1], { t: "shove", to: 2 });
      await vi.advanceTimersByTimeAsync(400);
      say(ws[1], { t: "m", x: Math.round(posAt(core.members[1], Date.now())), d: 0, r: core.members[1].rev });
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(strikes(0)).toBe(0);
    expect(strikes(1)).toBe(0);
    expect(ws[0].closed).toBeNull();
    expect(ws[1].closed).toBeNull();
  });

  it("winds a robot's hook back on every page when it becomes something else mid-throw", async () => {
    const { say, ws } = await room();
    say(ws[0], { t: "hook" });
    await settle();
    await vi.advanceTimersByTimeAsync(10);
    const before = mark(ws[1]);
    // The look's own cooldown has long passed: the change is taken at once.
    say(ws[0], { t: "look", c: "pawn" });
    await settle();
    expect(since(ws[1], before[0]).find((m) => m.t === "hk")).toEqual({ t: "hk", s: 0, o: "off" });
  });

  it("never lets the count stall or be flipped: the count still ends and starts the game with hooks, legs and hardens going", async () => {
    const { ctx, say, ws, core } = await room();
    const mid = boxCentre(0, core.boxes.length);
    await walkTo(say, ctx, ws[0], 0, mid - 40);
    await walkTo(say, ctx, ws[1], 1, mid);
    await walkTo(say, ctx, ws[2], 2, mid + 40);
    expect(core.count).not.toBeNull();
    const endsAt = core.count.endsAt;
    say(ws[0], { t: "stilts" });
    say(ws[1], { t: "slime", k: "harden" });
    await settle();
    expect(core.count?.endsAt).toBe(endsAt);
    // A hook within the light pulls nobody out: the count runs on and the game starts on time.
    say(ws[0], { t: "m", x: mid - 40, d: 1, r: core.members[0].rev });
    say(ws[0], { t: "m", x: mid - 40, d: 0, r: core.members[0].rev });
    await vi.advanceTimersByTimeAsync(STILT_MS + 20);
    say(ws[0], { t: "hook" });
    await vi.advanceTimersByTimeAsync(COUNT_MS);
    expect(core.activity.kind).not.toBe("lobby");
    expect(Date.now() - endsAt).toBeLessThan(COUNT_MS);
  });
});

describe("the count's last moment on the real room (review of #69, reproduction B)", () => {
  beforeEach(useFakeRuntime);
  afterEach(dropFakeRuntime);

  for (const lead of [293, 252]) {
    it(`a hook thrown ${lead} ms before the count ends, reaching a voter before it, stops the count: no game starts`, async () => {
      // The local wall (Coin Flip and the rest), its first two lights on, with three players.
      const Room = createLobbyRoom(() => TEST_WALL);
      const ctx = fakeCtx();
      ctx.keepAlive = true;
      ctx.room = new Room(ctx, fakeEnv());
      await settle();
      const say = (ws, msg) => ctx.room.webSocketMessage(ws, JSON.stringify(msg));
      const connect = async (token) => {
        const res = await ctx.room.fetch(new Request("https://room/ws", { headers: { Upgrade: "websocket" } }));
        expect(res.status).toBe(101);
        const ws = ctx.sockets.at(-1);
        say(ws, { t: "hello", token });
        return ws;
      };
      const tokens = [await ctx.room.create({ code: "BCDFGH", nickname: "Rob", as: "player" })];
      for (const name of ["Pat", "Sam"]) tokens.push(await ctx.room.join({ nickname: name, as: "player" }));
      const ws = [];
      for (const t of tokens) ws.push(await connect(t.token));
      await settle();
      say(ws[0], { t: "look", c: "robot" });
      await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
      const core = ctx.room.core;
      const n = core.boxes.length;
      const [c0, c1] = [boxCentre(0, n), boxCentre(1, n)];
      await walkTo(say, ctx, ws[1], 1, Math.round(c0 + 17));
      await walkTo(say, ctx, ws[2], 2, Math.round(c1 + 63));
      await walkTo(say, ctx, ws[0], 0, Math.round(c1 - 17));
      say(ws[0], { t: "m", x: Math.round(c1 - 17), d: -1, r: core.members[0].rev });
      say(ws[0], { t: "m", x: Math.round(c1 - 17), d: 0, r: core.members[0].rev });
      await settle();
      expect(core.count).not.toBeNull();
      const endsAt = core.count.endsAt;
      await vi.advanceTimersByTimeAsync(endsAt - lead - Date.now());
      const from = ws[1].frames.length;
      say(ws[0], { t: "hook" });
      await vi.advanceTimersByTimeAsync(lead + 600);
      const heard = ws[1].messages().slice(from);
      expect(heard.find((m) => m.t === "hk")).toMatchObject({ o: "pull", to: 1 });
      expect(heard.some((m) => m.t === "start")).toBe(false);
      expect(core.activity.kind).toBe("lobby");
      expect(core.count).toBeNull();
      expect(lightAt(core.members[1].x, n)).toBe(-1);
    });
  }
});

describe("faded ghosts and the new moves", () => {
  it("keeps a ghost's fade as it was: a kick into a faded ghost still scares (the pawn and the ghost behave as before)", () => {
    const core = party(["Ann", "Bo"]);
    be(core, 1, "ghost");
    place(core, 0, 600, 1000, 1);
    place(core, 1, 660, 1000);
    core.fade(1, 2000);
    expect(core.bump(0, 2100)).toMatchObject({ to: -1, sc: 1 });
    expect(FADE_MS).toBe(2500);
  });
});
