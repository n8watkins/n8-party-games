// The bump's rules, timings, states and poses (lobby/shared/bump.js), and how a player's own
// piece (lobby/shared/pilot.js) lives through one. No drawing and no clock: plain numbers.
import { describe, expect, it } from "vitest";
import {
  BUMP_BEHIND,
  BUMP_COOLDOWN_MS,
  BUMP_REACH,
  COOLDOWN_SLACK_MS,
  DOWN_MS,
  FLIGHT_MS,
  GETUP_MS,
  HIT_PAUSE_MS,
  IMMUNE_MS,
  IMPACT_MS,
  KNOCK_CLEAR,
  KNOCK_DISTANCE,
  KNOCK_MIN,
  RECOVER_MS,
  STUN_MS,
  WINDUP_MS,
  attackPose,
  attackState,
  bumpTarget,
  cooldownFraction,
  cooldownLeft,
  impactPoint,
  isDown,
  isSafe,
  knockLanding,
  landingGround,
  knockPose,
  knockState,
  knocked,
  mayBump,
} from "../shared/bump.js";
import { Pilot } from "../shared/pilot.js";
import { ROOM, boxCentre, lightAt, lightHalf } from "../shared/world.js";

describe("who a bump lands on", () => {
  it("is the nearest piece in front, within reach", () => {
    const others = [
      { seat: 1, x: 560 },
      { seat: 2, x: 530 },
      { seat: 3, x: 400 },
    ];
    expect(bumpTarget(500, 1, others)).toBe(2);
    expect(bumpTarget(500, -1, others)).toBe(3);
    expect(bumpTarget(500, 1, [{ seat: 1, x: 500 + BUMP_REACH + 1 }])).toBe(-1);
    expect(bumpTarget(500, 1, [{ seat: 1, x: 500 + BUMP_REACH }])).toBe(1);
  });

  it("counts a piece standing on top of the bumper, and nothing behind its back", () => {
    expect(bumpTarget(500, 1, [{ seat: 1, x: 500 - BUMP_BEHIND }])).toBe(1);
    expect(bumpTarget(500, 1, [{ seat: 1, x: 500 - BUMP_BEHIND - 1 }])).toBe(-1);
    expect(bumpTarget(500, 1, [])).toBe(-1);
  });
});

describe("where a knocked piece lands", () => {
  it("is thrown a long way in the direction of the blow, and stops at the walls", () => {
    // By the far wall, past the last light, there is nothing but dark: the full distance.
    expect(knockLanding(1810, -1, 5)).toBe(1810 - KNOCK_DISTANCE);
    expect(knockLanding(200, -1, 5)).toBe(ROOM.minX);
    expect(knockLanding(1800, 1, 5)).toBe(ROOM.maxX);
    expect(knockLanding(ROOM.maxX, 1, 5)).toBe(ROOM.maxX);
  });

  it("lands in the dark between the lights, near the middle of it when there is little", () => {
    const gap = (boxCentre(0, 5) + boxCentre(1, 5)) / 2;
    expect(knockLanding(boxCentre(0, 5), 1, 5)).toBe(Math.round(gap));
    expect(knockLanding(boxCentre(1, 5), -1, 5)).toBe(Math.round(gap));
    expect(landingGround(5).length).toBe(6);
    expect(landingGround(5)[0]).toEqual([ROOM.minX, boxCentre(0, 5) - lightHalf(5) - Math.min(KNOCK_CLEAR, (boxCentre(1, 5) - boxCentre(0, 5)) / 2 - lightHalf(5))]);
  });

  it("always puts a piece out of its light and into the dark, wherever it stood and however many boxes hang", () => {
    let [least, most] = [Infinity, 0];
    for (const n of [1, 2, 3, 4, 5, 6, 8]) {
      for (let x = ROOM.minX; x <= ROOM.maxX; x += 3) {
        for (const dir of [-1, 1]) {
          const to = knockLanding(x, dir, n);
          const what = `n=${n} x=${x} dir=${dir} -> ${to}`;
          expect(lightAt(to, n), what).toBe(-1);
          // Not teetering on the edge of a light either: clear of every one by the margin, or in the middle of a narrow gap.
          const margin = Math.min(KNOCK_CLEAR, n > 1 ? (boxCentre(1, n) - boxCentre(0, n)) / 2 - lightHalf(n) : Infinity);
          for (let i = 0; i < n; i++) expect(Math.abs(to - boxCentre(i, n)), what).toBeGreaterThanOrEqual(lightHalf(n) + margin - 1);
          expect(to >= ROOM.minX && to <= ROOM.maxX, what).toBe(true);
          const far = (to - x) * dir;
          expect(far, what).toBeGreaterThanOrEqual(0);
          // Thrown a real distance, unless a wall is in the way.
          const room = dir > 0 ? ROOM.maxX - x : x - ROOM.minX;
          if (room >= KNOCK_DISTANCE) {
            expect(far, what).toBeGreaterThanOrEqual(KNOCK_MIN - 1);
            least = Math.min(least, far);
            most = Math.max(most, far);
          }
        }
      }
    }
    expect(least).toBeGreaterThanOrEqual(KNOCK_MIN - 1);
    // Never a throw across half the room: at most over one whole light.
    expect(most).toBeLessThan(430);
  });
});

describe("what is fair", () => {
  it("has a cooldown that runs hit or miss, with a little slack for the network", () => {
    expect(mayBump({ bumpAt: -Infinity }, 0)).toEqual({ ok: true, wait: 0 });
    expect(mayBump({}, 0).ok).toBe(true);
    expect(mayBump({ bumpAt: 1000 }, 1500)).toEqual({ ok: false, wait: BUMP_COOLDOWN_MS - 500 });
    expect(mayBump({ bumpAt: 1000 }, 1000 + BUMP_COOLDOWN_MS - COOLDOWN_SLACK_MS - 1).ok).toBe(false);
    expect(mayBump({ bumpAt: 1000 }, 1000 + BUMP_COOLDOWN_MS - COOLDOWN_SLACK_MS).ok).toBe(true);
    expect(cooldownLeft(1000, 1000)).toBe(BUMP_COOLDOWN_MS);
    expect(cooldownLeft(1000, 1000 + BUMP_COOLDOWN_MS + 5)).toBe(0);
    expect(cooldownFraction(BUMP_COOLDOWN_MS)).toBe(0);
    expect(cooldownFraction(BUMP_COOLDOWN_MS / 4)).toBe(0.75);
    expect(cooldownFraction(0)).toBe(1);
    expect(cooldownFraction(-50)).toBe(1);
  });

  it("puts a knocked piece on the floor briefly and then keeps it safe for longer", () => {
    const piece = knocked(5000);
    expect(piece).toEqual({ stunUntil: 5000 + STUN_MS, immuneUntil: 5000 + STUN_MS + IMMUNE_MS });
    expect(isDown(piece, 5000 + STUN_MS - 1)).toBe(true);
    expect(isDown(piece, 5000 + STUN_MS)).toBe(false);
    expect(isSafe(piece, 5000)).toBe(true);
    expect(isSafe(piece, 5000 + STUN_MS + IMMUNE_MS - 1)).toBe(true);
    expect(isSafe(piece, 5000 + STUN_MS + IMMUNE_MS)).toBe(false);
    expect(isDown({}, 0) || isSafe({}, 0)).toBe(false);
    // On the floor it cannot bump either.
    expect(mayBump(piece, 5100)).toEqual({ ok: false, wait: STUN_MS - 100 });
  });

  it("keeps the numbers fair: a short stun, a longer safe time, and a cooldown longer than both", () => {
    expect(STUN_MS).toBe(IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS + DOWN_MS + GETUP_MS);
    expect(STUN_MS).toBeLessThan(800);
    expect(IMMUNE_MS).toBeGreaterThanOrEqual(2 * STUN_MS);
    expect(BUMP_COOLDOWN_MS - COOLDOWN_SLACK_MS).toBeGreaterThan(STUN_MS + IMMUNE_MS);
    // Even with three bumpers taking turns, a player is down for less than a third of the time.
    expect(STUN_MS / (STUN_MS + IMMUNE_MS)).toBeLessThan(1 / 3);
  });
});

describe("the bumper's states", () => {
  it("winds up, strikes and recovers", () => {
    expect(attackState(-1)).toBe("idle");
    expect(attackState(0)).toBe("winding");
    expect(attackState(WINDUP_MS - 1)).toBe("winding");
    expect(attackState(WINDUP_MS)).toBe("striking");
    expect(attackState(IMPACT_MS)).toBe("recovering");
    expect(attackState(IMPACT_MS + RECOVER_MS)).toBe("idle");
  });

  it("holds the blow for a moment when it lands", () => {
    expect(attackState(IMPACT_MS, true)).toBe("striking");
    expect(attackState(IMPACT_MS + HIT_PAUSE_MS - 1, true)).toBe("striking");
    expect(attackState(IMPACT_MS + HIT_PAUSE_MS, true)).toBe("recovering");
    expect(attackState(IMPACT_MS + HIT_PAUSE_MS + RECOVER_MS, true)).toBe("idle");
    const a = attackPose(IMPACT_MS, 1, true);
    const b = attackPose(IMPACT_MS + HIT_PAUSE_MS - 1, 1, true);
    expect(b).toEqual(a);
  });

  it("lifts and leans back, then slams forward the way it faces", () => {
    const up = attackPose(WINDUP_MS - 1, 1);
    expect(up.state).toBe("winding");
    expect(up.lift).toBeGreaterThan(30);
    expect(up.dx).toBeLessThan(-15);
    expect(up.tilt).toBeLessThan(-12);
    const slam = attackPose(IMPACT_MS - 1, 1);
    expect(slam.dx).toBeGreaterThan(40);
    expect(slam.tilt).toBeGreaterThan(15);
    expect(slam.lift).toBeLessThan(15);
    // Facing left it is the mirror image.
    const left = attackPose(IMPACT_MS - 1, -1);
    expect(left.dx).toBeCloseTo(-slam.dx);
    expect(left.tilt).toBeCloseTo(-slam.tilt);
    expect(left.lift).toBeCloseTo(slam.lift);
    expect(attackPose(5000, 1)).toEqual({ state: "idle", dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1 });
    const start = attackPose(0, 1);
    expect(Math.abs(start.dx) + Math.abs(start.lift) + Math.abs(start.tilt)).toBe(0);
  });

  it("never jumps from one frame to the next", () => {
    for (const landed of [false, true]) {
      let last = attackPose(0, 1, landed);
      for (let ms = 4; ms < 700; ms += 4) {
        const pose = attackPose(ms, 1, landed);
        expect(Math.abs(pose.dx - last.dx), `dx at ${ms}`).toBeLessThan(30);
        expect(Math.abs(pose.tilt - last.tilt), `tilt at ${ms}`).toBeLessThan(16);
        last = pose;
      }
    }
  });
});

describe("the knocked piece's states", () => {
  it("stands, is hit, flies, lies, rises and is then safe for a while", () => {
    expect(knockState(0)).toBe("standing");
    expect(knockState(IMPACT_MS - 1)).toBe("standing");
    expect(knockState(IMPACT_MS)).toBe("hit");
    expect(knockState(IMPACT_MS + HIT_PAUSE_MS)).toBe("flying");
    expect(knockState(IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS)).toBe("down");
    expect(knockState(STUN_MS - GETUP_MS)).toBe("rising");
    expect(knockState(STUN_MS)).toBe("safe");
    expect(knockState(STUN_MS + IMMUNE_MS - 1)).toBe("safe");
    expect(knockState(STUN_MS + IMMUNE_MS)).toBe("up");
    expect(knockState(STUN_MS, 0)).toBe("up");
    expect(knockState(-1)).toBe("up");
  });

  it("is thrown from where it stood to where it lands, tips right over, and rights itself", () => {
    const [from, to] = [500, 710];
    expect(knockPose(IMPACT_MS - 1, from, to)).toMatchObject({ state: "standing", x: from, tilt: 0, lift: 0 });
    const squashed = knockPose(IMPACT_MS + HIT_PAUSE_MS - 1, from, to);
    expect(squashed.state).toBe("hit");
    expect(squashed.sx).toBeLessThan(0.9);
    expect(squashed.sy).toBeGreaterThan(1.05);
    const mid = knockPose(IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS / 2, from, to);
    expect(mid.state).toBe("flying");
    expect(mid.x).toBeGreaterThan(from + 100);
    expect(mid.x).toBeLessThan(to);
    expect(mid.lift).toBeGreaterThan(30);
    expect(mid.tilt).toBeGreaterThan(30);
    const flat = knockPose(STUN_MS - GETUP_MS - 1, from, to);
    expect(flat).toMatchObject({ state: "down", x: to, tilt: 90 });
    expect(flat.lift).toBeLessThan(0);
    const up = knockPose(STUN_MS, from, to);
    expect(up).toEqual({ state: "safe", x: to, dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1 });
    // Thrown to the left it tips the other way.
    expect(knockPose(STUN_MS - GETUP_MS - 1, 710, 500).tilt).toBe(-90);
  });

  it("moves without a jump from one frame to the next, and ends exactly where the room put it", () => {
    const [from, to] = [500, 710];
    let last = knockPose(0, from, to);
    for (let ms = 4; ms <= STUN_MS + 40; ms += 4) {
      const pose = knockPose(ms, from, to);
      expect(Math.abs(pose.x - last.x), `x at ${ms}`).toBeLessThan(28);
      expect(Math.abs(pose.tilt - last.tilt), `tilt at ${ms}`).toBeLessThan(12);
      expect(Math.abs(pose.lift - last.lift), `lift at ${ms}`).toBeLessThan(14);
      expect(pose.x).toBeGreaterThanOrEqual(from);
      expect(pose.x).toBeLessThanOrEqual(to);
      last = pose;
    }
    expect(last.x).toBe(to);
  });

  it("puts the burst between the two pieces", () => {
    expect(impactPoint(400, 460)).toEqual({ x: 430, y: ROOM.floorY - 70 });
  });
});

describe("a player's own piece through a bump", () => {
  function pilot(x = 500) {
    const sent = [];
    return { sent, p: new Pilot({ lights: 5, send: (m) => sent.push(m), x }) };
  }

  it("asks the room for a bump and then waits out the cooldown", () => {
    const { sent, p } = pilot();
    expect(p.cooling(2000)).toBe(0);
    expect(p.bump(2000)).toBe(true);
    expect(sent).toEqual([{ t: "b" }]);
    expect(p.cooling(2100)).toBe(BUMP_COOLDOWN_MS - 100);
    expect(p.bump(2100)).toBe(false);
    expect(p.bump(2000 + BUMP_COOLDOWN_MS - 1)).toBe(false);
    expect(p.bump(2000 + BUMP_COOLDOWN_MS)).toBe(true);
    expect(sent.length).toBe(2);
  });

  it("takes the room's word on the cooldown", () => {
    const { sent, p } = pilot();
    p.cool(1800, 1000);
    expect(p.cooling(1000)).toBe(1800);
    expect(p.bump(2000)).toBe(false);
    expect(p.bump(2800)).toBe(true);
    p.cool(0, 3000);
    expect(p.bump(3000)).toBe(true);
    expect(sent.length).toBe(2);
  });

  it("lies where it was knocked, sends nothing, and walks on by itself if the key is still held", () => {
    const { sent, p } = pilot();
    p.steer(1, 1000);
    expect(sent.length).toBe(1);
    p.knock(900, 4, 1100);
    expect(p).toMatchObject({ x: 900, rev: 4, d: 0 });
    expect(p.down(1100 + STUN_MS - 1)).toBe(true);
    // The player keeps the key down and mashes the others: nothing moves and nothing is sent.
    for (let t = 1116; t < 1100 + STUN_MS; t += 16) {
      p.steer(1, t);
      expect(p.jump(t)).toBe(false);
      expect(p.bump(t)).toBe(false);
      p.step(t);
    }
    expect(p.x).toBe(900);
    expect(sent.length).toBe(1);
    // Up: the held key walks it on, with the room's new revision.
    p.steer(1, 1100 + STUN_MS);
    expect(p.down(1100 + STUN_MS)).toBe(false);
    expect(sent.at(-1)).toEqual({ t: "m", x: 900, d: 1, r: 4 });
    expect(p.bump(1100 + STUN_MS)).toBe(true);
  });

  it("knows which light it was knocked into or out of without a word to the room", () => {
    const { sent, p } = pilot(boxCentre(1, 5));
    expect(p.zone).toBe(1);
    p.knock(knockLanding(boxCentre(1, 5), 1, 5), 1, 1000);
    expect(p.zone).not.toBe(1);
    for (let t = 1016; t < 3000; t += 16) p.step(t);
    expect(sent.length).toBe(0);
  });
});
