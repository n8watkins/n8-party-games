// The chase camera keeps up with its car by time, not by frames: a big screen drawing a few frames a second (a slow
// television, or a page drawn in software) turns its panes' cameras as far in a second as one drawing sixty.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

let THREE, ChaseRig, camDt, trackAt;
beforeAll(async () => {
  // The page's three.js is a classic script that sets the global THREE, which the page's modules read: run as one.
  if (!globalThis.THREE) new Function(readFileSync(new URL("../page/vendor/three.min.js", import.meta.url), "utf8"))();
  THREE = globalThis.THREE;
  ({ ChaseRig, camDt } = await import("../page/view.js"));
  ({ trackAt } = await import("../page/env.js"));
});

/** A car standing on the track at u, heading `heading`, and the camera behind car 0 settled there. */
function scene(u, heading) {
  const p = trackAt(u, 0, {});
  const car = { u, v: 0, fallT: 0, air: false, spinT: 0, boostT: 0 };
  const state = { n: 1000, cars: [car], cherries: [] };
  const world = { cssH: 720, cars: [{ pos: new THREE.Vector3(p.x, 0, p.z), heading, mh: heading, slip: 0 }] };
  const rig = new ChaseRig(0);
  rig.update(state, world, 1 / 60, 16 / 9);
  return { state, world, rig };
}

/** Turns the car by `turn` at once, then draws one second of frames `ms` apart, each with the camera's step `step(ms)`. */
function turnAndDraw(ms, step) {
  const { state, world, rig } = scene(40, 0.3);
  const start = rig.head;
  world.cars[0].heading = world.cars[0].mh = 0.3 + 1.2;
  for (let t = 0; t < 1000 - 1e-6; t += ms) rig.update(state, world, step(ms), 16 / 9);
  return { start, head: rig.head };
}

describe("the chase camera on a slow screen", () => {
  it("takes the frame's real time, up to a second", () => {
    expect(camDt(16.7)).toBeCloseTo(0.0167, 4);
    expect(camDt(250)).toBe(0.25);
    expect(camDt(500)).toBe(0.5);
    expect(camDt(60_000)).toBe(1); // back from a hidden tab: it catches up at once
    expect(camDt(-5)).toBe(0);
  });

  it("turns as far in a second at 4 or 2 frames a second as at 60", () => {
    const fast = turnAndDraw(1000 / 60, camDt);
    for (const ms of [250, 500]) {
      const slow = turnAndDraw(ms, camDt);
      expect(Math.abs(slow.head - fast.head)).toBeLessThan(0.02);
    }
    // And in that second it has turned with the car, to where it settles (its aim leans toward the track ahead, so
    // not the whole 1.2 rad).
    expect(fast.head - fast.start).toBeGreaterThan(0.9);
    const settled = turnAndDraw(1000 / 60, (ms) => (ms * 5) / 1000);
    expect(Math.abs(fast.head - settled.head)).toBeLessThan(0.01);
  });

  it("takes how far the shown race moved on, where that is more than the frame's time", () => {
    expect(camDt(17, 4800)).toBe(1);
    expect(camDt(17, 300)).toBe(0.3);
    expect(camDt(500, 100)).toBe(0.5);
    expect(camDt(17, -90)).toBeCloseTo(0.017, 4); // the room corrected the clock back a little
  });

  // As GitHub's runner drew it: a frame 4.6 s long showed the room's last word (the page was over 2 s behind, raceNow),
  // the car in the air off the bread board; the next frame, 17 ms later, showed the race 4.8 s on, the car down on the
  // cloth far along the track.
  function leapThenJump(step) {
    const { state, world, rig } = scene(30, 0);
    const car = state.cars[0], v = world.cars[0];
    car.air = true; v.pos.y = 2.2;
    rig.update(state, world, camDt(4633), 16 / 9);
    car.air = false; car.u = 70;
    const p = trackAt(70, 0, {});
    v.pos.set(p.x, 0, p.z);
    rig.update(state, world, step, 16 / 9);
    return rig.cam.position.y - v.pos.y;
  }

  it("is behind its car again in the first frame after the shown race jumped seconds on", () => {
    // Where it settles behind a car on the cloth: CAM_HEIGHT (0.72) above it.
    expect(leapThenJump(camDt(17, 4800))).toBeCloseTo(0.72, 1);
    // (By the frame's 17 ms alone it stayed at the leap's height, 2 above the car, which sat below its pane.)
    expect(leapThenJump(camDt(17))).toBeGreaterThan(1.8);
  });

  it("(what the 0.1 s cap did: at 2 frames a second the camera was a third of a radian or more behind after a second)", () => {
    const fast = turnAndDraw(1000 / 60, camDt);
    const capped = turnAndDraw(500, (ms) => Math.min(0.1, ms / 1000));
    expect(fast.head - capped.head).toBeGreaterThan(0.3);
  });
});
