// The ghost's second half (lobby/shared/ghost.js): the fade, the scare and boo. Its rules as
// numbers, the room's judgement of each (LobbyCore.fade, boo, bump into a faded ghost, the vote
// that does not count a faded ghost), and on the real Durable Object class that each reaches every
// page, is refused to the sender only in the same style as a choice of piece, and costs a socket
// its rate limit when spammed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { BumpDraw } from "../public/bump-draw.js";
import { resumeKnock } from "../public/look3d/pieces.js";
import { COOLDOWN_SLACK_MS, IMMUNE_MS, IMPACT_MS, KNOCK_DISTANCE, STUN_MS, knockLanding } from "../shared/bump.js";
import { CHARACTERS, LOOK_COOLDOWN_MS, moveOf } from "../shared/characters.js";
import { BOO_LATE_MS, FADE_COOLDOWN_MS, FADE_MS, SCARE, SCARE_MS, SPOOK, SPOOK_AGAIN_MS, SPOOK_DISTANCE, SPOOK_FAR, SPOOK_LANDING, SPOOK_MOST, SPOOK_MS, SPOOK_REACH, SPOOK_SLACK, fadeFraction, fadeLeft, frightPose, frightResumed, frightState, isFaded, mayFade, maySpook } from "../shared/ghost.js";
import { MODE_COOLDOWN_MS } from "../shared/mode.js";
import { COUNT_MS, boxFromManifest } from "../shared/vote.js";
import { POSITION_SLACK, ROOM, boxCentre, lightAt, lightHalf } from "../shared/world.js";
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

const wall = () => ({ boxes: [boxFromManifest(coinFlipManifest, { test: true })], games: new Map([["coin-flip", coinFlip]]) });

/** A room of seated, connected players at 1000 ms. */
function party(...names) {
  const core = new LobbyCore({ ...wall(), seed: 7, code: "BCDFGH", now: 1000 });
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

function ghost(core, seat, now = 1000) {
  core.members[seat].character = "ghost";
  core.members[seat].lookAt = now;
}

describe("the ghost's rules, as numbers", () => {
  it("are the owner's: a fade of 2.5 s on an 8 s cooldown, a scare that stuns for about 0.75 s, a spook weaker than a kick", () => {
    expect(FADE_MS).toBe(2500);
    expect(FADE_COOLDOWN_MS).toBe(8000);
    // The start and the freeze together: "about 0.75 s", then the scurry.
    expect(SCARE.freeze + 160).toBe(750);
    expect(SCARE_MS).toBeGreaterThan(STUN_MS);
    expect(SPOOK_DISTANCE).toBeLessThan(KNOCK_DISTANCE);
    expect(SPOOK_MS).toBeLessThan(STUN_MS);
  });

  it("makes the ghost's move the fade, and every other character's the kick", () => {
    expect(moveOf("ghost")).toBe("fade");
    for (const c of CHARACTERS.filter((c) => c.id !== "ghost")) expect(moveOf(c.id), c.id).toBe("kick");
    expect(moveOf("not-a-character")).toBe("kick");
  });

  it("counts the cooldown from the start of a fade", () => {
    expect(fadeLeft(-Infinity, 0)).toBe(0);
    expect(fadeLeft(1000, 1000)).toBe(FADE_COOLDOWN_MS);
    expect(fadeLeft(1000, 1000 + FADE_COOLDOWN_MS)).toBe(0);
    expect(fadeFraction(FADE_COOLDOWN_MS)).toBe(0);
    expect(fadeFraction(0)).toBe(1);
    expect(isFaded({ fadedUntil: 5000 }, 4999)).toBe(true);
    expect(isFaded({ fadedUntil: 5000 }, 5000)).toBe(false);
    expect(isFaded({ fadedUntil: 5000 }, 4000, false)).toBe(false);
  });

  it("says why a fade is refused, and how long to wait when waiting will do", () => {
    const room = { fades: true, lobby: true, busy: null };
    expect(mayFade({}, 0, room)).toEqual({ ok: true });
    expect(mayFade({}, 0, { ...room, fades: false }).why).toMatch(/ghost/);
    expect(mayFade({}, 0, { ...room, lobby: false })).toMatchObject({ ok: false });
    expect(mayFade({}, 0, { ...room, busy: "Not during the count." })).toEqual({ ok: false, why: "Not during the count." });
    expect(mayFade({ stunUntil: 500 }, 0, room)).toMatchObject({ ok: false, wait: 500 });
    expect(mayFade({ fadeAt: 0 }, 1000, room)).toMatchObject({ ok: false, wait: FADE_COOLDOWN_MS - 1000 });
    // Two messages are never exactly as far apart as they were sent: a little early is allowed.
    expect(mayFade({ fadeAt: 0 }, FADE_COOLDOWN_MS - COOLDOWN_SLACK_MS, room).ok).toBe(true);
  });

  it("lets a faded ghost spook a piece it touches once, never a ghost, never one on the floor or just spooked", () => {
    const pawn = { seat: 1, x: 500, fades: false };
    expect(maySpook(500, pawn, 0).ok).toBe(true);
    expect(maySpook(500 + SPOOK_REACH + SPOOK_SLACK, pawn, 0).ok).toBe(true);
    expect(maySpook(500 + SPOOK_REACH + SPOOK_SLACK + 1, pawn, 0).why).toMatch(/far/);
    expect(maySpook(500, { ...pawn, fades: true }, 0).why).toMatch(/ghost/);
    expect(maySpook(500, pawn, 0, [1]).why).toMatch(/this fade/);
    expect(maySpook(500, { ...pawn, spookedUntil: 10 }, 0).ok).toBe(false);
    expect(maySpook(500, { ...pawn, stunUntil: 10 }, 0).ok).toBe(false);
    expect(maySpook(500, { ...pawn, immuneUntil: 10 }, 0).ok).toBe(false);
  });

  it("plays a scare as a start, a freeze and a scurry to where the room put the piece, and never knocks it over", () => {
    const states = [];
    for (let ms = 0; ms < SCARE_MS + IMMUNE_MS + 100; ms += 10) {
      const pose = frightPose(ms, 400, 190, SCARE, IMMUNE_MS);
      if (states.at(-1) !== pose.state) states.push(pose.state);
      for (const k of ["dx", "lift", "tilt", "sx", "sy", "scared", "pale"]) expect(Number.isFinite(pose[k]), `${k} at ${ms}`).toBe(true);
      // Upright the whole time: a lean, never a fall.
      expect(Math.abs(pose.tilt)).toBeLessThan(15);
      expect(pose.lift).toBeGreaterThanOrEqual(0);
    }
    expect(states).toEqual(["standing", "start", "frozen", "running", "safe", "up"]);
    // While the kick is on its way, the kicker is where it was; at the end of the scurry, where the room put it.
    expect(frightPose(IMPACT_MS - 1, 400, 190, SCARE, IMMUNE_MS).x).toBe(400);
    expect(frightPose(SCARE_MS - 1, 400, 190, SCARE, IMMUNE_MS).x).toBeCloseTo(190, 0);
    expect(frightState(SCARE_MS, SCARE, IMMUNE_MS)).toBe("safe");
    // It looks back at the ghost while frozen, and the way it runs while running.
    expect(frightPose(IMPACT_MS + 300, 400, 190, SCARE, IMMUNE_MS).face).toBe(1);
    expect(frightPose(SCARE_MS - 100, 400, 190, SCARE, IMMUNE_MS).face).toBe(-1);
  });

  it("does not shiver for a viewer who asked for less motion, and keeps its jump small", () => {
    for (let ms = IMPACT_MS; ms < SCARE_MS; ms += 7) {
      const calm = frightPose(ms, 400, 190, SCARE, IMMUNE_MS, true);
      expect(calm.dx, `at ${ms}`).toBe(0);
      expect(calm.lift).toBeLessThanOrEqual(SCARE.hop * 0.4 + 0.001);
    }
  });

  it("plays a spook at once, with no freeze, and done sooner than a knock", () => {
    expect(frightState(0, SPOOK, IMMUNE_MS)).toBe("start");
    expect(frightState(SPOOK_MS, SPOOK, IMMUNE_MS)).toBe("safe");
    expect(frightPose(SPOOK_MS - 1, 500, 640, SPOOK, IMMUNE_MS).x).toBeCloseTo(640, 0);
  });

  it("lands a spook in the dark, a shorter way than a kick", () => {
    const n = 1;
    const from = boxCentre(0, n);
    const spook = knockLanding(from, 1, n, null, { distance: SPOOK_DISTANCE, least: 60 });
    const kick = knockLanding(from, 1, n);
    expect(lightAt(spook, n)).toBe(-1);
    expect(spook - from).toBeLessThanOrEqual(kick - from);
  });

  it("never spooks a piece further than SPOOK_MOST, well under a kick, from anywhere in any room (the worst case was 214)", () => {
    expect(SPOOK_MOST).toBeLessThanOrEqual(KNOCK_DISTANCE * 0.75);
    let worst = 0;
    for (let n = 1; n <= 8; n++) {
      // Every light on, none on, and each one alone.
      const lits = [null, [], ...Array.from({ length: n }, (_, i) => [i])];
      for (const lit of lits) {
        const on = lit ?? Array.from({ length: n }, (_, i) => i);
        const dark = (x) => on.every((i) => Math.abs(x - boxCentre(i, n)) > lightHalf(n));
        for (let x = ROOM.minX; x <= ROOM.maxX; x += 3) {
          for (const dir of [-1, 1]) {
            const spook = knockLanding(x, dir, n, lit, SPOOK_LANDING);
            const kick = knockLanding(x, dir, n, lit);
            const went = Math.abs(spook - x);
            worst = Math.max(worst, went);
            const where = `n=${n} lit=${JSON.stringify(lit)} x=${x} dir=${dir}`;
            // In bounds, the way it was sent (or nowhere, against a wall), never further than a kick.
            expect(spook, where).toBeGreaterThanOrEqual(ROOM.minX);
            expect(spook, where).toBeLessThanOrEqual(ROOM.maxX);
            expect((spook - x) * dir, where).toBeGreaterThanOrEqual(0);
            expect(went, where).toBeLessThanOrEqual(SPOOK_MOST);
            expect(went, where).toBeLessThanOrEqual(Math.abs(kick - x));
            // Fair: in the dark whenever there is dark within its reach that way.
            if (!dark(spook)) {
              // (Clear of the light by more than a unit: it never lands teetering on its very edge.)
              for (let d = 0; d <= SPOOK_MOST - 2; d += 2) {
                const y = x + dir * d;
                if (y >= ROOM.minX && y <= ROOM.maxX) expect(dark(y), `${where}: dark at ${y}, landed in a light at ${spook}`).toBe(false);
              }
            }
          }
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(SPOOK_MOST);
  });
});

describe("the room's judgement", () => {
  it("fades a ghost for 2.5 s, refuses it again until 8 s after it began, and tells a page arriving in the middle", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    expect(core.fade(0, 2000)).toEqual({ ok: true, relay: { t: "fade", s: 0, for: FADE_MS } });
    expect(core.view(2500).members[0]).toMatchObject({ faded: FADE_MS - 500, fadeCool: FADE_COOLDOWN_MS - 500 });
    expect(core.view(2000 + FADE_MS).members[0].faded).toBeUndefined();
    expect(core.fade(0, 3000)).toMatchObject({ ok: false, wait: FADE_COOLDOWN_MS - 1000 });
    expect(core.fade(0, 2000 + FADE_COOLDOWN_MS).ok).toBe(true);
    // A pawn has no fade, and nothing about one in the view.
    expect(core.fade(1, 2000)).toMatchObject({ ok: false, why: "Only a ghost can fade." });
    expect(core.view(2500).members[1]).not.toHaveProperty("fadeCool");
  });

  it("takes a faded ghost's vote away: the light does not count it, and the count waits for it to turn solid", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    const mid = boxCentre(0, 1);
    place(core, 0, mid - 40, 2000);
    place(core, 1, mid + 40, 2000);
    core.count = null;
    core.fade(0, 2000);
    core.evaluate(2001);
    expect(core.standing(2001)[0]).toBeNull();
    expect(core.voteView(2001).waiting).toEqual([0]);
    expect(core.count).toBeNull();
    // The room wakes when the fade ends, and then the count starts.
    expect(core.nextWake(2001)).toBe(2000 + FADE_MS);
    core.evaluate(2000 + FADE_MS);
    expect(core.standing(2000 + FADE_MS)[0]).toBe("coin-flip");
    expect(core.count?.endsAt).toBe(2000 + FADE_MS + COUNT_MS);
  });

  it("never fades during a count, a coin toss, a game starting, the settings or at the Table", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    core.count = { endsAt: 99_999 };
    expect(core.fade(0, 2000)).toMatchObject({ ok: false, why: "Not during the count." });
    core.count = null;
    core.toss = { between: ["a", "b"], winner: "a", endsAt: 99_999 };
    expect(core.fade(0, 2000)).toMatchObject({ ok: false, why: "Not during the coin toss." });
    core.toss = null;
    core.starting = "coin-flip";
    expect(core.fade(0, 2000)).toMatchObject({ ok: false, why: "Not while a game starts." });
    core.starting = null;
    core.activity = { kind: "settings", id: "coin-flip", endsAt: 99_999 };
    expect(core.fade(0, 2000).ok).toBe(false);
    core.activity = { kind: "lobby" };
    core.mode = "turn-based";
    expect(core.plainRoom()).toBe(true);
    expect(core.fade(0, 2000).ok).toBe(false);
    core.mode = "party-games";
    expect(core.fade(0, 2000).ok).toBe(true);
  });

  it("does not let a ghost kick", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    place(core, 0, 400, 2000);
    place(core, 1, 460, 2000);
    expect(core.bump(0, 2100)).toBeNull();
    expect(core.bumpWait(0, 2100)).toBeNull();
  });

  it("scares a pawn that kicks a faded ghost: the kick passes through, and the pawn runs a kick's distance the other way", () => {
    const core = party("Ann", "Bo");
    ghost(core, 1);
    place(core, 0, 600, 2000, 1);
    place(core, 1, 660, 2000);
    core.fade(1, 2050);
    const ghostBefore = core.members[1].x;
    const hit = core.bump(0, 2100);
    expect(hit).toMatchObject({ t: "b", s: 0, f: 1, to: -1, sc: 1, x: knockLanding(600, -1, 1), rev: core.members[0].rev });
    expect(hit.x).toBeLessThan(600);
    // The ghost is where it was, untouched; the pawn cannot move until it has stopped running, then is safe for a while.
    expect(core.members[1].x).toBe(ghostBefore);
    expect(core.move(0, { x: hit.x, d: 1, r: hit.rev }, 2100 + SCARE_MS - 1)).toBeNull();
    expect(core.view(2100).members[0]).toMatchObject({ down: SCARE_MS, safe: SCARE_MS + IMMUNE_MS });
    expect(core.move(0, { x: hit.x, d: 1, r: hit.rev }, 2100 + SCARE_MS)).not.toBeNull();
    // A solid ghost is knocked as anyone is: it can be hit again the moment it turns solid.
    place(core, 0, 600, 2100 + SCARE_MS + IMMUNE_MS, 1);
    expect(core.bump(0, 2100 + SCARE_MS + IMMUNE_MS)).toMatchObject({ to: 1 });
  });

  it("spooks a piece a faded ghost drifts through, the way it was going, once a fade and not again for a while", () => {
    const core = party("Ann", "Bo", "Cy");
    ghost(core, 0);
    const mid = boxCentre(0, 1);
    place(core, 1, mid, 2000);
    place(core, 2, mid + 300, 2000);
    place(core, 0, mid - 30, 2000);
    expect(core.boo(0, 1, 2000)).toMatchObject({ ok: false, why: "Only a faded ghost can spook." });
    core.fade(0, 2000);
    core.move(0, { x: mid - 30, d: 1, r: core.members[0].rev }, 2000);
    const out = core.boo(0, 1, 2050);
    expect(out).toMatchObject({ ok: true, relay: { t: "spook", s: 0, to: 1, rev: 1 } });
    // Out of its light, into the dark, the way the ghost drifts.
    expect(out.relay.x).toBeGreaterThan(mid);
    expect(lightAt(out.relay.x, 1)).toBe(-1);
    expect(core.view(2050).members[1]).toMatchObject({ down: SPOOK_MS });
    // Its cap: the same piece again in this fade, or in the next, is refused.
    expect(core.boo(0, 1, 2100).ok).toBe(false);
    // Too far away to have touched it.
    expect(core.boo(0, 2, 2100)).toMatchObject({ ok: false, why: "Too far away." });
    // Nonsense is refused, not thrown.
    for (const bad of [0, -1, 9, "1", null, undefined, 1.5]) expect(core.boo(0, bad, 2100).ok, String(bad)).toBe(false);
    // A later fade, after the piece's own SPOOK_AGAIN_MS, may spook it again.
    const later = 2000 + Math.max(FADE_COOLDOWN_MS, SPOOK_AGAIN_MS);
    place(core, 1, mid, later);
    place(core, 0, mid - 20, later);
    core.fade(0, later);
    expect(core.boo(0, 1, later + 10).ok).toBe(true);
  });

  it("never lets a ghost spook another ghost, and never during a game", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0);
    ghost(core, 1);
    place(core, 0, 400, 2000);
    place(core, 1, 410, 2000);
    core.fade(0, 2000);
    expect(core.boo(0, 1, 2010)).toMatchObject({ ok: false, why: "A ghost cannot spook a ghost." });
    core.members[1].character = "pawn";
    core.activity = { kind: "game", id: "coin-flip", seats: [0, 1] };
    expect(core.boo(0, 1, 2010).ok).toBe(false);
  });

  it("makes a ghost that changes character mid-fade solid at once", () => {
    const core = party("Ann");
    ghost(core, 0, -10_000);
    core.fade(0, 2000);
    expect(core.faded(core.members[0], 2100)).toBe(true);
    expect(core.setLook(0, { c: "pawn" }, 2100)).toEqual({ ok: true, changed: true, unfaded: true });
    expect(core.faded(core.members[0], 2100)).toBe(false);
    // And back to a ghost: still solid, nothing about a fade in the view.
    expect(core.setLook(0, { c: "ghost" }, 2100 + LOOK_COOLDOWN_MS)).toEqual({ ok: true, changed: true });
    expect(core.faded(core.members[0], 2100 + LOOK_COOLDOWN_MS)).toBe(false);
    expect(core.view(2100 + LOOK_COOLDOWN_MS).members[0].faded).toBeUndefined();
  });

  it("does not boo at the Table, and a switch of waiting room ends a fade", () => {
    const core = party("Ann", "Bo");
    ghost(core, 1, -10_000);
    place(core, 0, 600, 2000);
    place(core, 1, 620, 2000);
    expect(core.fade(1, 2000).ok).toBe(true);
    // The host switches to the Table mid-fade: the ghost is solid, and has nobody to spook.
    expect(core.setMode(core.members[0].token, "turn-based", 2000 + MODE_COOLDOWN_MS).ok).toBe(true);
    const at = 2000 + MODE_COOLDOWN_MS + 10;
    expect(core.faded(core.members[1], at)).toBe(false);
    expect(core.view(at).members[1].faded).toBeUndefined();
    // Even a fade the room still had on the piece (written by hand here) does not boo at the Table.
    core.members[1].fadedUntil = at + 1000;
    core.members[0].x = core.members[1].x = 600;
    expect(core.boo(1, 0, at)).toMatchObject({ ok: false, why: "Nobody there to spook." });
    expect(core.members[0].stunUntil).toBe(0);
  });

  it("says which refused boos and fades no real page sends (they cost the socket), and which are honest ones a moment late", () => {
    const core = party("Ann", "Bo", "Cy");
    ghost(core, 0, -10_000);
    place(core, 0, 600, 2000);
    place(core, 1, 620, 2000);
    place(core, 2, 1700, 2000);
    // Never faded: no page boos then.
    expect(core.boo(0, 1, 2000)).toMatchObject({ ok: false, bad: true });
    // A pawn boos: no page does.
    expect(core.boo(1, 0, 2000)).toMatchObject({ ok: false, bad: true });
    core.fade(0, 2000);
    // Nonsense targets.
    for (const to of [-1, 0, 9, "1", null, 1.5]) expect(core.boo(0, to, 2010), String(to)).toMatchObject({ ok: false, bad: true });
    // Across the room: further than any position the room believes.
    expect(Math.abs(core.members[2].x - 600)).toBeGreaterThan(SPOOK_FAR);
    expect(core.boo(0, 2, 2010)).toMatchObject({ ok: false, why: "Too far away.", bad: true });
    // Honest refusals: a piece just kicked, one just spooked by another ghost, one a little too far by the room's reckoning.
    core.members[1].stunUntil = 2500;
    expect(core.boo(0, 1, 2020)).toMatchObject({ ok: false, bad: false });
    core.members[1].stunUntil = 0;
    core.members[1].spookedUntil = 5000;
    expect(core.boo(0, 1, 2030)).toMatchObject({ ok: false, bad: false });
    core.members[1].spookedUntil = 0;
    core.members[1].x = 600 + SPOOK_REACH + SPOOK_SLACK + 50;
    expect(core.boo(0, 1, 2040)).toMatchObject({ ok: false, why: "Too far away.", bad: false });
    // A boo just after the fade ended is honest; one long after is not.
    core.members[1].x = 620;
    expect(core.boo(0, 1, 2000 + FADE_MS + 50)).toMatchObject({ ok: false, bad: false });
    expect(core.boo(0, 1, 2000 + FADE_MS + BOO_LATE_MS + 1)).toMatchObject({ ok: false, bad: true });
    // A ghost that just became a pawn may have a boo on its way still.
    core.fade(0, 2000 + FADE_COOLDOWN_MS);
    core.setLook(0, { c: "pawn" }, 2000 + FADE_COOLDOWN_MS + 100);
    expect(core.boo(0, 1, 2000 + FADE_COOLDOWN_MS + 150)).toMatchObject({ ok: false, bad: false });
  });

  it("says which refused fades no real page asks for: far too soon, or not a ghost", () => {
    const core = party("Ann", "Bo");
    ghost(core, 0, -10_000);
    expect(core.fade(0, 2000).ok).toBe(true);
    // Far too soon costs; a moment too soon (the clocks) does not.
    expect(core.fade(0, 4000)).toMatchObject({ ok: false, cooling: true, bad: true });
    expect(core.fade(0, 2000 + FADE_COOLDOWN_MS - 400)).toMatchObject({ ok: false, bad: false });
    // Knocked over just as the button went down: honest.
    core.members[0].stunUntil = 2000 + FADE_COOLDOWN_MS + SCARE_MS;
    expect(core.fade(0, 2000 + FADE_COOLDOWN_MS)).toMatchObject({ ok: false, bad: false });
    // During the count: honest (it may have started on the way).
    core.members[0].stunUntil = 0;
    core.count = { endsAt: 99_999 };
    expect(core.fade(0, 2000 + FADE_COOLDOWN_MS)).toMatchObject({ ok: false, bad: false });
    // A pawn: no page asks.
    expect(core.fade(1, 2000)).toMatchObject({ ok: false, bad: true });
  });

  it("tells a page that arrives in the middle that a piece was scared or spooked, not knocked, and which pieces cannot be spooked yet", () => {
    const core = party("Ann", "Bo", "Cy");
    ghost(core, 1);
    place(core, 0, 600, 2000, 1);
    place(core, 1, 660, 2000);
    core.fade(1, 2050);
    core.bump(0, 2100);
    expect(core.view(2400).members[0]).toMatchObject({ fright: "scare", down: SCARE_MS - 300 });
    // Spooked: the same, and for SPOOK_AGAIN_MS nobody may spook it again.
    place(core, 2, 1200, 2000);
    place(core, 1, 1180, 2200);
    const out = core.boo(1, 2, 2200);
    expect(out.ok).toBe(true);
    expect(core.view(2300).members[2]).toMatchObject({ fright: "spook", down: SPOOK_MS - 100, spooked: SPOOK_AGAIN_MS - 100 });
    // Knocked by a kick after that: a knock again, no fright.
    const later = 2200 + SPOOK_AGAIN_MS + IMMUNE_MS;
    place(core, 0, core.members[2].x - 60, later, 1);
    expect(core.bump(0, later)).toMatchObject({ to: 2 });
    expect(core.view(later + 10).members[2].fright).toBeUndefined();
    expect(core.view(later + 10).members[2].spooked).toBeUndefined();
  });
});

describe("a page that arrives in the middle of a fright", () => {
  it("draws a scare as a scare and a spook as a spook, in both looks, already where the room put it", () => {
    const now = 10_000;
    for (const [fright, how, ms] of [["scare", SCARE, SCARE_MS], ["spook", SPOOK, SPOOK_MS]]) {
      const down = 300;
      const safe = down + IMMUNE_MS;
      expect(frightResumed(700, down, safe, fright, now)).toEqual({ at: now - (ms - down), from: 700, to: 700, how, safeFor: IMMUNE_MS });
      const flat = { rx: 700 };
      BumpDraw.prototype.resume.call(null, flat, 700, down, safe, now, fright);
      expect(flat.knock).toBeUndefined();
      expect(flat.fright).toMatchObject({ how, from: 700, to: 700 });
      const solid = { rx: 700 };
      resumeKnock(solid, 700, down, safe, now, fright);
      expect(solid.knock).toBeUndefined();
      expect(solid.fright).toMatchObject({ how, from: 700, to: 700 });
      // It finishes the story: scared or running, then safe, then up.
      expect(frightState(now - solid.fright.at, how, solid.fright.safeFor)).not.toBe("up");
      expect(frightState(now + down + IMMUNE_MS + 1 - solid.fright.at, how, solid.fright.safeFor)).toBe("up");
    }
    // A knock is still a knock.
    const knocked = { rx: 700 };
    BumpDraw.prototype.resume.call(null, knocked, 700, 300, 300 + IMMUNE_MS, now);
    expect(knocked.knock).toBeTruthy();
    expect(knocked.fright).toBeUndefined();
  });
});

describe("the ghost's moves on the real room", () => {
  beforeEach(useFakeRuntime);
  afterEach(dropFakeRuntime);

  async function room() {
    const r = await openRoom(createLobbyRoom, turnGame());
    const { ctx, connect } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const screen = await ctx.room.join({ as: "screen" });
    const ws = { ann: await connect(ann.token), bo: await connect(bo.token), screen: await connect(screen.token) };
    await settle();
    r.say(ws.ann, { t: "look", c: "ghost" });
    await settle();
    return { ...r, ws };
  }
  const mark = (...sockets) => sockets.map((ws) => ws.frames.length);
  const since = (ws, n) => ws.messages().slice(n);

  it("tells every page and the screen of a fade, and refuses one too soon to the sender only, with the wait", async () => {
    const { say, ws } = await room();
    const [a, b, s] = mark(ws.ann, ws.bo, ws.screen);
    say(ws.ann, { t: "fade" });
    await settle();
    for (const [page, n] of [[ws.ann, a], [ws.bo, b], [ws.screen, s]]) expect(since(page, n).find((m) => m.t === "fade")).toEqual({ t: "fade", s: 0, for: FADE_MS });
    const [a2, b2] = mark(ws.ann, ws.bo);
    await vi.advanceTimersByTimeAsync(1000);
    say(ws.ann, { t: "fade" });
    await settle();
    const no = since(ws.ann, a2).find((m) => m.t === "fade-no");
    expect(no).toMatchObject({ t: "fade-no", why: "Your fade is not ready yet." });
    expect(no.wait).toBeGreaterThan(FADE_COOLDOWN_MS - 1100);
    expect(since(ws.bo, b2).some((m) => m.t === "fade" || m.t === "fade-no")).toBe(false);
    // A pawn asking is told why, and so is a screen (which has no piece) told nothing at all.
    say(ws.bo, { t: "fade" });
    say(ws.screen, { t: "fade" });
    await settle();
    expect(since(ws.bo, b2).find((m) => m.t === "fade-no")).toMatchObject({ why: "Only a ghost can fade." });
  });

  it("closes a socket that spams the ghost's moves", async () => {
    const { say, ws } = await room();
    say(ws.ann, { t: "fade" });
    for (let i = 0; i < 40 && !ws.ann.closed; i++) {
      say(ws.ann, { t: "fade" });
      say(ws.ann, { t: "boo", to: 1 });
    }
    await settle();
    expect(ws.ann.closed).not.toBeNull();
    expect(ws.bo.closed).toBeNull();
  });

  it("refuses a fade during the count, and a kick into a faded ghost scares the kicker on every page", async () => {
    const { ctx, say, ws } = await room();
    const core = ctx.room.core;
    const mid = boxCentre(0, core.boxes.length);
    // Both in the light: the count starts.
    for (const [page, seat, x] of [[ws.ann, 0, mid + 40], [ws.bo, 1, mid - 20]]) {
      const m = core.members[seat];
      while (Math.abs(m.x - x) > 1) {
        say(page, { t: "m", x: Math.abs(x - m.x) > POSITION_SLACK ? m.x + Math.sign(x - m.x) * (POSITION_SLACK - 10) : x, d: 0, r: m.rev });
        await vi.advanceTimersByTimeAsync(20);
      }
    }
    expect(core.count).not.toBeNull();
    const [a] = mark(ws.ann);
    say(ws.ann, { t: "fade" });
    await settle();
    expect(since(ws.ann, a).find((m) => m.t === "fade-no")).toMatchObject({ why: "Not during the count." });
    expect(core.count).not.toBeNull();
    // Bo walks out, the count stops; Ann fades; Bo comes back facing her and kicks.
    say(ws.bo, { t: "m", x: mid - 300, d: 0, r: core.members[1].rev });
    await settle();
    expect(core.count).toBeNull();
    say(ws.ann, { t: "fade" });
    await settle();
    say(ws.bo, { t: "m", x: mid - 20, d: 1, r: core.members[1].rev });
    say(ws.bo, { t: "m", x: mid - 20, d: 0, r: core.members[1].rev });
    await settle();
    // The ghost is faded: no count, though both stand in the light.
    expect(core.count).toBeNull();
    const [a3, b3, s3] = mark(ws.ann, ws.bo, ws.screen);
    say(ws.bo, { t: "b" });
    await settle();
    for (const [page, n] of [[ws.ann, a3], [ws.bo, b3], [ws.screen, s3]]) expect(since(page, n).find((m) => m.t === "b")).toMatchObject({ s: 1, to: -1, sc: 0 });
    expect(core.members[1].x).toBeLessThan(mid - 20);
  });

  it("ends a fade on every page and starts the count at once when a ghost becomes a pawn mid-fade, and a ghost again is solid", async () => {
    const { ctx, say, ws } = await room();
    const core = ctx.room.core;
    const mid = boxCentre(0, core.boxes.length);
    await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
    say(ws.ann, { t: "fade" });
    await settle();
    await walkTo(say, ctx, ws.ann, 0, mid + 40);
    await walkTo(say, ctx, ws.bo, 1, mid - 20);
    // Both in the light, but the ghost is faded: no count.
    expect(core.count).toBeNull();
    const [a, b, s] = mark(ws.ann, ws.bo, ws.screen);
    const changedAt = Date.now();
    say(ws.ann, { t: "look", c: "pawn" });
    await settle();
    for (const [page, n] of [[ws.ann, a], [ws.bo, b], [ws.screen, s]]) {
      const heard = since(page, n);
      expect(heard.find((m) => m.t === "fade")).toEqual({ t: "fade", s: 0, for: 0 });
      // The count starts with the change, not when the fade would have ended.
      expect(heard.find((m) => m.t === "vote" && m.vote.count)).toBeTruthy();
    }
    expect(core.count?.endsAt).toBe(changedAt + COUNT_MS);
    // Out of the light, and back to a ghost: solid, and the room view says nothing of a fade.
    await walkTo(say, ctx, ws.bo, 1, mid - 500);
    await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
    const [b2] = mark(ws.bo);
    say(ws.ann, { t: "look", c: "ghost" });
    await settle();
    const view = since(ws.bo, b2).findLast((m) => m.room)?.room.members[0];
    expect(view).toMatchObject({ character: "ghost" });
    expect(view.faded).toBeUndefined();
  });
});

describe("the rate limit and the ghost's honest refusals", () => {
  beforeEach(useFakeRuntime);
  afterEach(dropFakeRuntime);

  /** Two ghosts (Ann, Bo) and two pawns (Cy, Di) on the real room, with sockets that keep what they hear. */
  async function fourRoom() {
    const r = await openRoom(createLobbyRoom, turnGame());
    const { ctx, connect, say } = r;
    ctx.keepAlive = true;
    const tokens = [await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" })];
    for (const name of ["Bo", "Cy", "Di"]) tokens.push(await ctx.room.join({ nickname: name, as: "player" }));
    const ws = [];
    for (const t of tokens) ws.push(await connect(t.token));
    await settle();
    say(ws[0], { t: "look", c: "ghost" });
    say(ws[1], { t: "look", c: "ghost" });
    await settle();
    await vi.advanceTimersByTimeAsync(LOOK_COOLDOWN_MS);
    const strikes = (i) => ctx.room.sockets.get(ws[i]).bucket.strikes;
    return { ...r, ws, strikes, core: ctx.room.core };
  }

  it("never strikes two honest ghosts over a long session of fades, boos and kicking pawns", async () => {
    const { ctx, say, ws, strikes, core } = await fourRoom();
    // Well clear of the one light on the wall, so no count starts.
    const base = boxCentre(0, core.boxes.length) - 500;
    const refusals = [0, 0];
    const boo = (g, to) => {
      const n = ws[g].frames.length;
      say(ws[g], { t: "boo", to });
      const heard = ws[g].messages().slice(n);
      if (heard.some((m) => m.t === "boo-no")) refusals[g] += 1;
      return heard.find((m) => m.t === "spook" || m.t === "boo-no");
    };
    const kinds = new Set();
    for (let round = 0; round < 16; round++) {
      // Cy faces Di and kicks her; the ghosts stand on them.
      await walkTo(say, ctx, ws[2], 2, base);
      await walkTo(say, ctx, ws[3], 3, base + 60);
      say(ws[2], { t: "m", x: base, d: 1, r: core.members[2].rev });
      say(ws[2], { t: "m", x: base, d: 0, r: core.members[2].rev });
      // The ghosts stand behind Cy, out of the kick's way, then come up to him.
      await walkTo(say, ctx, ws[0], 0, base - 200);
      await walkTo(say, ctx, ws[1], 1, base - 200);
      say(ws[2], { t: "b" });
      await settle();
      expect(core.members[3].stunUntil).toBeGreaterThan(Date.now());
      await walkTo(say, ctx, ws[0], 0, base);
      say(ws[0], { t: "fade" });
      say(ws[1], { t: "fade" });
      await settle();
      // Ann's page heard of the kick a moment late: Di is down.
      kinds.add(boo(0, 3)?.why);
      // The pieces' news a moment old: Bo's page saw Cy a little nearer than the room does.
      await walkTo(say, ctx, ws[1], 1, base + (round % 2 ? 1 : -1) * (SPOOK_REACH + SPOOK_SLACK + 60));
      kinds.add(boo(1, 2)?.why);
      // Ann spooks Cy; Bo's page had not heard yet, and asks too.
      expect(boo(0, 2)?.t).toBe("spook");
      await walkTo(say, ctx, ws[1], 1, core.members[2].x);
      kinds.add(boo(1, 2)?.why);
      // A boo that reaches the room just after the fade ended there.
      await vi.advanceTimersByTimeAsync(FADE_MS + 200);
      kinds.add(boo(0, 3)?.why);
      kinds.add(boo(1, 3)?.why);
      // And everyone waits for the fade to be ready again.
      await vi.advanceTimersByTimeAsync(FADE_COOLDOWN_MS - FADE_MS);
    }
    // Every kind of honest refusal came up.
    for (const why of ["Knocked over, or just up.", "Only a faded ghost can spook.", "Spooked a moment ago.", "Too far away."]) expect(kinds).toContain(why);
    // Enough refusals that two strikes each would have closed both sockets long ago.
    expect(refusals[0] + refusals[1]).toBeGreaterThan(60);
    expect(strikes(0)).toBe(0);
    expect(strikes(1)).toBe(0);
    for (const socket of ws) expect(socket.closed).toBeNull();
  });

  it("still closes a script that boos without a fade, from a pawn, about nobody, or across the room", async () => {
    for (const abuse of ["unfaded", "pawn", "nobody", "far"]) {
      const { ctx, say, ws, core } = await fourRoom();
      const base = boxCentre(0, core.boxes.length) - 700;
      await walkTo(say, ctx, ws[0], 0, base);
      await walkTo(say, ctx, ws[2], 2, base + 900);
      if (abuse === "far") {
        say(ws[0], { t: "fade" });
        await settle();
      }
      for (let i = 0; i < 40 && !ws[abuse === "pawn" ? 2 : 0].closed; i++) {
        if (abuse === "pawn") say(ws[2], { t: "boo", to: 0 });
        else say(ws[0], { t: "boo", to: abuse === "nobody" ? 9 : 2 });
        await vi.advanceTimersByTimeAsync(60);
      }
      expect(ws[abuse === "pawn" ? 2 : 0].closed, abuse).not.toBeNull();
      expect(ws[1].closed, abuse).toBeNull();
      dropFakeRuntime();
      useFakeRuntime();
    }
  });
});
