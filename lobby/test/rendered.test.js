// The rendered rooms (lobby/public/look3d/rendered): the switch that turns them on for one device
// and its memory, which files a device fetches, the ladder a slow device comes down (with made-up
// frame times), and the Star Lounge's sky timetable, which the room and its preview share.
import { existsSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELPS, Ladder, SHARP_MIN, SLOW_MS } from "../public/look3d/rendered/ladder.js";
import { THINGS, TIMES, createSky } from "../public/look3d/rendered/star-lounge/sky.js";
import { RENDERED, rememberReal, rememberRung, realWanted, renderedFor, rungName, rungOf } from "../public/look3d/rendered/switch.js";

/** A device's storage, as localStorage behaves. */
function storage() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k), kept };
}
const q = (s) => new URLSearchParams(s);
const SHIP = RENDERED.ship;

describe("the switch", () => {
  it("is off unless the device asked for it, so nothing changes for anyone else", () => {
    const device = storage();
    rememberReal(q(""), device);
    expect(realWanted(device)).toBe(false);
    expect(renderedFor({ look: "3d", skin: "ship" }, q(""), device)).toBe(null);
  });

  it("is turned on with ?look=real and remembered, so the room's own address (no query) keeps it", () => {
    const device = storage();
    rememberReal(q("look=real&join=1234"), device);
    rememberReal(q(""), device);
    expect(realWanted(device)).toBe(true);
    expect(renderedFor({ look: "3d", skin: "ship" }, q(""), device)).toBe(SHIP);
  });

  it("is turned off by any other ?look=", () => {
    for (const other of ["3d", "flat", "baked", "anything"]) {
      const device = storage();
      rememberReal(q("look=real"), device);
      rememberReal(q(`look=${other}`), device);
      expect(realWanted(device)).toBe(false);
      expect(device.kept.size).toBe(0);
    }
  });

  it("draws only the Star Lounge this way: any other room, and the flat look, are as they are today", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    for (const skin of ["bar", "arcade", "camp", "roof", "navy", "fair", ""]) expect(renderedFor({ look: "3d", skin }, q(""), device)).toBe(null);
    expect(renderedFor({ look: "flat", skin: "ship" }, q(""), device)).toBe(null);
  });

  it("survives a browser that will not keep anything (private browsing): it is simply off", () => {
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    expect(() => rememberReal(q("look=real"), broken)).not.toThrow();
    expect(realWanted(broken)).toBe(false);
  });
});

describe("what a device fetches", () => {
  const layers = new URL("../public/look3d/rendered/star-lounge/layers/", import.meta.url);
  it("lists every layer the Star Lounge is made of, and each one is there to serve", () => {
    for (const file of SHIP.files) {
      // The numbers are the Blender scene's own file, served beside the layers (scripts/build-public.mjs).
      const at = file === "star-lounge.json" ? new URL("../tools/blender/star-lounge.json", import.meta.url) : new URL(file, layers);
      expect(existsSync(at), file).toBe(true);
    }
    const here = readdirSync(layers).sort();
    expect(here).toEqual(SHIP.files.filter((f) => f !== "star-lounge.json").sort());
  });

  it("is under a megabyte for the Star Lounge, and nothing for a device that has not asked", () => {
    const bytes = SHIP.files.filter((f) => f !== "star-lounge.json").reduce((n, f) => n + statSync(new URL(f, layers)).size, 0);
    expect(bytes).toBeGreaterThan(500_000);
    expect(bytes).toBeLessThan(1_000_000);
    // A device that has not asked never gets a drawing that would fetch them.
    expect(renderedFor({ look: "3d", skin: "ship" }, q(""), storage())).toBe(null);
  });
});

describe("where on its ladder a device starts", () => {
  it("starts at the top, and where it came to last time once it has been slow", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    expect(rungOf(SHIP, q(""), device)).toEqual({ taken: [], fallback: false, forced: false });
    rememberRung(["weather", "planet"], device);
    expect(rungOf(SHIP, q(""), device).taken).toEqual(["weather", "planet"]);
  });

  it("does not flap: a device that gave up gets today's 3D Star Lounge on its next visit too", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    rememberRung("3d", device);
    expect(renderedFor({ look: "3d", skin: "ship" }, q(""), device)).toBe(null);
    expect(realWanted(device)).toBe(true);
  });

  it("starts from the top again when ?look=real is asked again", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    rememberRung("3d", device);
    rememberReal(q("look=real"), device);
    expect(renderedFor({ look: "3d", skin: "ship" }, q(""), device)).toBe(SHIP);
  });

  it("can be forced from the address for a test, and that is never remembered", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    expect(rungOf(SHIP, q("rung=2"), device)).toEqual({ taken: ["weather", "planet"], fallback: false, forced: true });
    expect(rungOf(SHIP, q("rung=outside,weather"), device).taken).toEqual(["outside", "weather"]);
    expect(renderedFor({ look: "3d", skin: "ship" }, q("rung=3d"), device)).toBe(null);
    expect(rungOf(SHIP, q(""), device).taken).toEqual([]);
  });

  it("names each rung for the frame meter", () => {
    expect(`real ${rungName(SHIP, [])}`).toBe("real star-lounge");
    expect(`real ${rungName(SHIP, ["weather"])}`).toBe("real star-lounge lite 1");
    expect(`real ${rungName(SHIP, SHIP.steps)}`).toBe("real star-lounge lite 3");
  });
});

/** Feeds a ladder frames of `ms` (a number, or a function of what has been done so far) for `seconds`; returns what it did. */
function run(ladder, ms, seconds, from = 0) {
  const did = [];
  let t = from;
  while (t < from + seconds * 1000) {
    const dt = typeof ms === "function" ? ms(ladder) : ms;
    t += dt;
    const act = ladder.frame(t, dt);
    if (act) did.push(act);
  }
  return did;
}
const STEPS = ["weather", "planet", "outside"];

describe("the ladder", () => {
  it("leaves a device that keeps up alone", () => {
    const l = new Ladder({ ratio: 2, steps: STEPS });
    expect(run(l, 16.7, 60)).toEqual([]);
    expect(run(new Ladder({ ratio: 2, steps: STEPS }), 23, 60)).toEqual([]);
  });

  it("judges nothing while the room settles, and ignores a page that was hidden", () => {
    const l = new Ladder({ ratio: 2, steps: STEPS, settleMs: 3000 });
    expect(run(l, 60, 2.9)).toEqual([]);
    expect(l.frame(4000, 5000)).toBe(null);
  });

  it("draws fewer pixels first, a fifth at a time down to the 3D look's floor, then takes its own steps, then falls back", () => {
    // A device whose frames take as long as it has pixels to fill, that each of the room's steps helps a little, but never enough.
    const l = new Ladder({ ratio: 2, steps: STEPS });
    const did = run(l, (ladder) => 240 * (ladder.ratio / 2) ** 2 * 0.9 ** ladder.taken.size, 60);
    const ratios = did.filter((a) => a.ratio).map((a) => +a.ratio.toFixed(3));
    expect(ratios).toEqual([1.6, 1.28, 1.024, 0.819, SHARP_MIN]);
    expect(did.filter((a) => a.take).map((a) => a.take)).toEqual(STEPS);
    expect(did.at(-1)).toEqual({ fallback: true });
    expect(l.done).toBe("fell back");
    // Its own steps come only once the sharpness is at the floor.
    expect(did.findIndex((a) => a.take)).toBeGreaterThan(did.findIndex((a) => a.ratio === SHARP_MIN));
  });

  it("stops as soon as frames are fast enough, and keeps what it has taken", () => {
    const l = new Ladder({ ratio: 1, steps: STEPS });
    const did = run(l, (ladder) => (ladder.taken.size >= 2 ? 16 : 30), 60);
    expect(did.filter((a) => a.take).map((a) => a.take)).toEqual(["weather", "planet"]);
    expect(did.some((a) => a.fallback)).toBe(false);
    expect([...l.taken]).toEqual(["weather", "planet"]);
  });

  it("puts the pixels back when fewer did not help (a phone held to 30 a second), as the 3D look's governor does", () => {
    const l = new Ladder({ ratio: 2, steps: STEPS });
    const did = run(l, 33.3, 8);
    expect(did.slice(0, 2)).toEqual([{ ratio: 1.6 }, { ratio: 2 }]);
  });

  it("does not throw the rendered room away on a capped phone: steps that changed nothing are undone, and it stops", () => {
    const l = new Ladder({ ratio: 2, steps: STEPS });
    const did = run(l, 33.3, 60);
    expect(did.some((a) => a.fallback)).toBe(false);
    expect(did.at(-1)).toEqual({ undo: STEPS });
    expect(l.done).toBe("capped");
    expect(l.taken.size).toBe(0);
  });

  it("starts where the device came to last time, and goes on from there", () => {
    const l = new Ladder({ ratio: SHARP_MIN, steps: STEPS, taken: ["weather", "planet"] });
    const did = run(l, (ladder) => (ladder.taken.size === 3 ? 26 : 40), 20);
    expect(did).toEqual([{ take: "outside" }, { fallback: true }]);
  });

  it("uses the 3D look's own numbers", () => {
    expect(SLOW_MS).toBe(24);
    expect(SHARP_MIN).toBe(0.75);
    expect(HELPS).toBe(0.88);
  });
});

describe("the sky's timetable", () => {
  const seeded = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

  it("passes one thing at a time, with 20 to 45 seconds of empty sky between, for a simulated day", () => {
    const sky = createSky(seeded(7));
    let last = null;
    let emptySince = 0;
    for (let t = 0; t < 24 * 3600; t += 0.25) {
      const ev = sky.step(t);
      if (ev && ev !== last) {
        if (last) {
          const gap = ev.start - last.end;
          expect(gap).toBeGreaterThanOrEqual(TIMES.quiet[0] - 0.26);
          expect(gap).toBeLessThanOrEqual(TIMES.quiet[1] + 0.26);
        } else expect(ev.start).toBeGreaterThanOrEqual(TIMES.first);
        expect(ev.thing.family).not.toBe(last?.thing.family);
        last = ev;
      }
      if (!ev) emptySince = t;
    }
    expect(emptySince).toBeGreaterThan(0);
  });

  it("is the same timetable on every device that has the same seed (the room's code), so every screen sees the same rocket", () => {
    const a = createSky(seeded(1234));
    const b = createSky(seeded(1234));
    const seen = (sky) => {
      const out = [];
      for (let t = 0; t < 3600; t += 0.5) {
        const ev = sky.step(t);
        if (ev && out.at(-1)?.start !== ev.start) out.push({ name: ev.thing.name, start: ev.start });
      }
      return out;
    };
    expect(seen(a)).toEqual(seen(b));
  });

  it("knows how long each thing takes, and the rocket comes first", () => {
    expect(THINGS.map((t) => t.name)).toEqual(["star", "rock0", "rock1", "rock2", "rocket", "liner", "saucer"]);
    const sky = createSky(seeded(3));
    let first = null;
    for (let t = 0; t < 60 && !first; t += 0.5) first = sky.step(t);
    expect(first.thing.name).toBe("rocket");
  });
});
