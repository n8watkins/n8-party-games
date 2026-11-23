// The rendered rooms (lobby/public/look3d/rendered): the switch that turns them on for one device
// and its memory, which files a device fetches, the ladder a slow device comes down (with made-up
// frame times), and the Star Lounge's sky timetable, which the room and its preview share.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEET_Y } from "../public/look3d/space.js";
import { EYE, FLASH, STREET_Z, THINGS as STREET, TIMES as STREET_TIMES, createLightning, createStreet, flashAt, umbrellaAt, variant } from "../public/look3d/rendered/bar/street.js";
import { HELPS, Ladder, SHARP_MIN, SLOW_MS, atCap } from "../public/look3d/rendered/ladder.js";
import { LAYERS_MS, within } from "../public/look3d/rendered/within.js";
import { THINGS, TIMES, createSky } from "../public/look3d/rendered/star-lounge/sky.js";
import { FELL_BACK_NOTE, RENDERED, rememberReal, rememberRung, realWanted, renderedFor, rungName, rungOf } from "../public/look3d/rendered/switch.js";

/** A device's storage, as localStorage behaves. */
function storage() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k), kept };
}
const q = (s) => new URLSearchParams(s);
const SHIP = RENDERED.ship;
const BAR = RENDERED.bar;

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

  it("draws only the Star Lounge and the bar this way: any other room, and the flat look, are as they are today", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    expect(Object.keys(RENDERED).sort()).toEqual(["bar", "ship"]);
    expect(renderedFor({ look: "3d", skin: "bar" }, q(""), device)).toBe(BAR);
    for (const skin of ["arcade", "camp", "roof", "navy", "fair", "alley", ""]) expect(renderedFor({ look: "3d", skin }, q(""), device)).toBe(null);
    expect(renderedFor({ look: "flat", skin: "ship" }, q(""), device)).toBe(null);
    expect(renderedFor({ look: "flat", skin: "bar" }, q(""), device)).toBe(null);
  });

  it("is the bar's too only on the wall its painting is of, five boxes", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    expect(renderedFor({ look: "3d", skin: "bar", boxes: 6 }, q(""), device)).toBe(null);
    expect(renderedFor({ look: "3d", skin: "bar", boxes: 5 }, q(""), device)).toBe(BAR);
    // A device that gave up on the bar gets today's 3D bar, as the Star Lounge does.
    rememberRung("3d", device);
    expect(renderedFor({ look: "3d", skin: "bar" }, q(""), device)).toBe(null);
  });

  it("is not opened, and fetches nothing, on a wall that is not the one its picture is of (the local test wall of six)", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    expect(renderedFor({ look: "3d", skin: "ship", boxes: 6 }, q(""), device)).toBe(null);
    expect(renderedFor({ look: "3d", skin: "ship", boxes: 4 }, q(""), device)).toBe(null);
    expect(renderedFor({ look: "3d", skin: "ship", boxes: 5 }, q(""), device)).toBe(SHIP);
  });

  it("tells a player whose device fell back how to get it back, in words that are not the flat room's offer", () => {
    expect(FELL_BACK_NOTE).toMatch(/\?look=real/);
    expect(FELL_BACK_NOTE.toLowerCase()).not.toMatch(/simpler/);
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

  const barLayers = new URL("../public/look3d/rendered/bar/layers/", import.meta.url);
  it("lists every layer the bar is made of, and each one is there to serve", () => {
    for (const file of BAR.files) expect(existsSync(new URL(file, barLayers)), file).toBe(true);
    expect(readdirSync(barLayers).sort()).toEqual([...BAR.files].sort());
  });

  it("is under half a megabyte for the bar, and nothing for a device that has not asked", () => {
    const bytes = BAR.files.reduce((n, f) => n + statSync(new URL(f, barLayers)).size, 0);
    expect(bytes).toBeGreaterThan(200_000);
    expect(bytes).toBeLessThan(500_000);
    expect(renderedFor({ look: "3d", skin: "bar" }, q(""), storage())).toBe(null);
  });

  it("lays the bar's painting where the 3D look's room is: its wall meets its floor where the back wall does, and its floor line is the pieces' feet", () => {
    const plate = JSON.parse(readFileSync(new URL("plate.json", barLayers), "utf8"));
    const { scale, oy, w } = plate.painting;
    expect(w * scale).toBeCloseTo(1920, 6);
    // The painted wall's foot (y 605) on the back wall's foot (world y 785, look3d/space.js), and the preview's floor line (y 702) on the feet.
    expect(oy + 605 * scale).toBeCloseTo((6.25 - 0) * 125.55, 0);
    expect(Math.abs(oy + 702 * scale - FEET_Y)).toBeLessThan(2);
    // Five frames, each a little larger than painted (the owner's pick), still clear of each other and of the two wall lamps.
    expect(plate.frames).toHaveLength(5);
    expect(plate.posterScale).toBe(1.06);
    const boxes = plate.frames.map((f) => f.drawn.box);
    for (let i = 1; i < 5; i++) expect(boxes[i].x - (boxes[i - 1].x + boxes[i - 1].w)).toBeGreaterThan(0);
    expect(boxes[0].x).toBeGreaterThan(577);
    expect(boxes[4].x + boxes[4].w).toBeLessThan(1360);
    // The glass is traced pane by pane in both windows.
    expect(plate.panes.length).toBe(16);
    expect(Object.keys(plate.windows).sort()).toEqual(["left", "right"]);
  });

  it("cuts the street behind each window wide enough to slide behind the glass as far as the eye can move, so its edge never shows", () => {
    const plate = JSON.parse(readFileSync(new URL("plate.json", barLayers), "utf8"));
    // The eye at its furthest (the view's middle 6 m from the room's), and how far the street then slides against the wall, in painting pixels.
    const ex = 6 * EYE;
    const [dStreet, dWall, dWalk] = [17.5 - STREET_Z, 20, 17.5 - 0.6];
    const slide = (ex * 125.55 * (dStreet - dWall)) / dWalk / plate.painting.scale;
    expect(slide).toBeGreaterThan(60);
    for (const [key, [x0, y0, x1, y1]] of Object.entries(plate.windows)) {
      const s = plate.street[key];
      const k = (y1 - y0) / s.h;
      const half = (x1 - x0) / 2;
      const [left, right] = [(s.mid - s.x) * k - half, (s.x + s.w - s.mid) * k - half];
      // The left window is seen with the eye to the left (its street slides left), the right window the other way.
      if (key === "left") expect(right).toBeGreaterThan(slide);
      else expect(left).toBeGreaterThan(slide);
      expect(Math.min(left, right)).toBeGreaterThan(30);
      expect(s.x + s.w).toBeLessThanOrEqual(1672);
    }
  });
});

describe("where on its ladder a device starts", () => {
  it("starts at the top, and where it came to last time once it has been slow", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    expect(rungOf(SHIP, q(""), device)).toEqual({ taken: [], fallback: false, capped: false, forced: false });
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
    expect(rungOf(SHIP, q("rung=2"), device)).toEqual({ taken: ["weather", "planet"], fallback: false, capped: false, forced: true });
    expect(rungOf(SHIP, q("rung=outside,weather"), device).taken).toEqual(["outside", "weather"]);
    expect(renderedFor({ look: "3d", skin: "ship" }, q("rung=3d"), device)).toBe(null);
    expect(rungOf(SHIP, q(""), device).taken).toEqual([]);
  });

  it("names each rung for the frame meter", () => {
    expect(`real ${rungName(SHIP, [])}`).toBe("real star-lounge");
    expect(`real ${rungName(SHIP, ["weather"])}`).toBe("real star-lounge lite 1");
    expect(`real ${rungName(SHIP, SHIP.steps)}`).toBe("real star-lounge lite 3");
    expect(`real ${rungName(BAR, [])}`).toBe("real bar");
    expect(`real ${rungName(BAR, BAR.steps)}`).toBe("real bar lite 3");
  });

  it("gives the bar its own three steps, the drops on the glass first and the outside at half resolution last", () => {
    expect(BAR.steps).toEqual(["drops", "rain", "outside"]);
    expect(rungOf(BAR, q("rung=2"), storage()).taken).toEqual(["drops", "rain"]);
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

  it("does not throw the rendered room away on a phone held to 30 a second: steps that changed nothing are undone, and it stops", () => {
    for (const ms of [33.3, 31.5, 35.5]) {
      const l = new Ladder({ ratio: 2, steps: STEPS });
      const did = run(l, ms, 60);
      expect(did.some((a) => a.fallback)).toBe(false);
      expect(did.at(-1)).toEqual({ undo: STEPS });
      expect(l.done).toBe("capped");
      expect(l.taken.size).toBe(0);
    }
  });

  it("does not trap a phone that is slow at any other pace on the heaviest look: it falls back", () => {
    // 40 and 44 ms a frame whatever is drawn (a slow phone, not a capped one): before, these took every step, undid them all and stayed at 25 a second.
    for (const ms of [40, 44, 50, 66.7]) {
      const l = new Ladder({ ratio: 2, steps: STEPS });
      const did = run(l, ms, 60);
      expect(did.at(-1)).toEqual({ fallback: true });
      expect(l.done).toBe("fell back");
    }
    expect(atCap(40)).toBe(false);
    expect(atCap(1000 / 30)).toBe(true);
  });

  it("tries nothing on a device it found capped before (remembered as 'capped')", () => {
    const device = storage();
    rememberReal(q("look=real"), device);
    rememberRung("capped", device);
    const rung = rungOf(SHIP, q(""), device);
    expect(rung).toEqual({ taken: [], fallback: false, capped: true, forced: false });
    const l = new Ladder({ ratio: 2, steps: STEPS, taken: rung.taken, capped: rung.capped });
    expect(run(l, 33.3, 60)).toEqual([]);
    expect(renderedFor({ look: "3d", skin: "ship" }, q(""), device)).toBe(SHIP);
    // Asking again with ?look=real forgets it, so the next visit measures afresh.
    rememberReal(q("look=real"), device);
    expect(rungOf(SHIP, q(""), device).capped).toBe(false);
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

describe("waiting for the layers", () => {
  afterEach(() => vi.useRealTimers());

  it("gives up after a few seconds, so a slow layer does not hold the dimmed room (the 3D look draws it)", async () => {
    vi.useFakeTimers();
    expect(LAYERS_MS).toBeGreaterThanOrEqual(5000);
    expect(LAYERS_MS).toBeLessThanOrEqual(6000);
    let arrive;
    const loading = new Promise((done) => (arrive = done));
    let aborted = false;
    const late = [];
    const waiting = within(loading, LAYERS_MS, { onTimeout: () => (aborted = true), late: (v) => late.push(v) });
    const outcome = waiting.then(
      () => "drew it",
      (err) => err.message,
    );
    await vi.advanceTimersByTimeAsync(LAYERS_MS + 1);
    expect(await outcome).toMatch(/longer than/);
    expect(aborted).toBe(true);
    // The layer that comes 20 seconds late is handed back to be given back, never used.
    arrive({ planet: "the planet" });
    await vi.advanceTimersByTimeAsync(0);
    expect(late).toEqual([{ planet: "the planet" }]);
  });

  it("uses layers that come in time, and passes on a layer that fails", async () => {
    vi.useFakeTimers();
    const late = [];
    const fast = within(Promise.resolve({ base: 1 }), LAYERS_MS, { late: (v) => late.push(v) });
    expect(await fast).toEqual({ base: 1 });
    await expect(within(Promise.reject(new Error("the planet did not load")), LAYERS_MS)).rejects.toThrow("the planet did not load");
    await vi.advanceTimersByTimeAsync(LAYERS_MS * 2);
    expect(late).toEqual([]);
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

  // The same timetable for screens that did not watch every frame: what is in the sky at a moment
  // must not depend on when a screen last looked.
  /** Every thing that passes in the first `seconds`, as a screen that draws every frame sees it: [{name, start, end}]. */
  const everything = (seed, seconds) => {
    const sky = createSky(seeded(seed));
    const out = [];
    for (let t = 0; t <= seconds; t += 1 / 60) {
      const ev = sky.step(t);
      if (ev && out.at(-1)?.start !== ev.start) out.push({ name: ev.thing.name, start: ev.start, end: ev.end });
    }
    return out;
  };
  /** What a screen that looks only at `times` sees then, beside what the screen that drew every frame had at that moment. */
  function compare(seed, times) {
    const all = everything(seed, times.at(-1) + 1);
    const sky = createSky(seeded(seed));
    const worst = { start: 0, misses: 0, looked: 0 };
    for (const t of times) {
      const ev = sky.step(t);
      // (Within one frame of a start or an end, a screen that drew every sixtieth of a second may not have reached it yet.)
      const truth = all.find((e) => t >= e.start + 1 / 30 && t < e.end - 1 / 30);
      const edge = all.some((e) => Math.abs(t - e.start) <= 1 / 30 || Math.abs(t - e.end) <= 1 / 30);
      if (edge) continue;
      worst.looked++;
      if (!!truth !== !!ev || (truth && truth.name !== ev.thing.name)) worst.misses++;
      else if (truth) worst.start = Math.max(worst.start, Math.abs(truth.start - ev.start));
    }
    return worst;
  }
  const frames = (from, to, step = 1 / 60) => Array.from({ length: Math.floor((to - from) / step) }, (_, i) => from + i * step);

  it("is the same for a screen that joined half an hour late", () => {
    const r = compare(4827, frames(1800, 2400));
    expect(r.looked).toBeGreaterThan(30000);
    expect(r.misses).toBe(0);
    expect(r.start).toBeLessThan(1e-6);
  });

  it("is the same for a tab that was hidden for five minutes and shown again", () => {
    const r = compare(1111, [...frames(0, 600), ...frames(900, 1500)]);
    expect(r.misses).toBe(0);
    expect(r.start).toBeLessThan(1e-6);
  });

  it("is the same after the room was away in a game for twenty minutes (the room is not drawn during a game)", () => {
    const r = compare(2222, [...frames(0, 300), ...frames(1500, 2100)]);
    expect(r.misses).toBe(0);
    expect(r.start).toBeLessThan(1e-6);
  });

  it("knows how long each thing takes, and the rocket comes first", () => {
    expect(THINGS.map((t) => t.name)).toEqual(["star", "rock0", "rock1", "rock2", "rocket", "liner", "saucer"]);
    const sky = createSky(seeded(3));
    let first = null;
    for (let t = 0; t < 60 && !first; t += 0.5) first = sky.step(t);
    expect(first.thing.name).toBe("rocket");
  });
});

describe("the bar's street", () => {
  const seeded = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  /** Everything that passes in the first `seconds`, as a screen that draws every frame sees it. */
  const passes = (seed, seconds, step = 1 / 30) => {
    const street = createStreet(seeded(seed));
    const out = [];
    for (let t = 0; t <= seconds; t += step) {
      const ev = street.step(t);
      if (ev && out.at(-1)?.start !== ev.start) out.push({ name: ev.thing.name, start: ev.start, end: ev.end });
    }
    return out;
  };

  it("keeps exactly the owner's four: an umbrella on the wind, a cat on the sill, a paper boat and the shop light", () => {
    expect(STREET.map((t) => t.name).sort()).toEqual(["boat", "cat", "shop", "umbrella"]);
    const seen = new Set(passes(5, 3 * 3600).map((p) => p.name));
    expect([...seen].sort()).toEqual(["boat", "cat", "shop", "umbrella"]);
  });

  it("passes one at a time, with 10 to 15 seconds of nothing between, for a simulated evening, and the umbrella first", () => {
    const all = passes(11, 4 * 3600);
    expect(all[0].name).toBe("umbrella");
    expect(all[0].start).toBe(STREET_TIMES.first);
    for (let i = 1; i < all.length; i++) {
      const gap = all[i].start - all[i - 1].end;
      expect(gap).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(gap).toBeLessThanOrEqual(15 + 1e-6);
      // Never the same thing twice running.
      expect(all[i].name).not.toBe(all[i - 1].name);
    }
    // About one every twenty seconds.
    expect(all.length).toBeGreaterThan((4 * 3600) / 30);
  });

  it("is the same street on every screen in the room (the same seed), and for a screen that came half an hour late", () => {
    const a = passes(4827, 3600);
    expect(passes(4827, 3600)).toEqual(a);
    const late = createStreet(seeded(4827));
    const atLate = late.step(1800);
    const truth = a.find((p) => 1800 >= p.start && 1800 < p.end) ?? null;
    expect(atLate?.start ?? null).toBe(truth?.start ?? null);
    // Which window and which way: worked out from when it started and the room's seed, so the same everywhere.
    const ev = { thing: { name: "umbrella" }, start: a[0].start };
    expect(variant(ev, 4827)).toEqual(variant(ev, 4827));
  });

  it("keeps the cat on its sill and the boat in its gutter, both at the right window; the umbrella and the shop light at either", () => {
    const wins = { umbrella: new Set(), shop: new Set(), cat: new Set(), boat: new Set() };
    for (let i = 0; i < 400; i++) for (const name of Object.keys(wins)) wins[name].add(variant({ thing: { name }, start: i * 17.3 }, 99).win);
    expect([...wins.cat]).toEqual(["right"]);
    expect([...wins.boat]).toEqual(["right"]);
    expect([...wins.umbrella].sort()).toEqual(["left", "right"]);
    expect([...wins.shop].sort()).toEqual(["left", "right"]);
  });

  it("lightens now and then: one soft glow that rises and fades, never a flicker, once every 35 to 70 seconds", () => {
    // One glow: it rises to its peak and then only fades.
    let peak = 0;
    let falling = false;
    for (let e = 0; e <= FLASH.lasts; e += 0.005) {
      const v = flashAt(e);
      if (v < peak - 1e-9) falling = true;
      else if (falling) expect(v).toBeLessThanOrEqual(peak);
      peak = Math.max(peak, v);
    }
    expect(peak).toBeCloseTo(FLASH.peak, 3);
    expect(flashAt(-0.1)).toBe(0);
    expect(flashAt(FLASH.lasts + 0.1)).toBe(0);
    // When each comes: rare.
    const sky = createLightning(seeded(3));
    const starts = [];
    let was = 0;
    for (let t = 0; t < 2 * 3600; t += 1 / 20) {
      const v = sky.step(t);
      if (v > 0 && was === 0) starts.push(t);
      was = v;
    }
    expect(starts[0]).toBeGreaterThanOrEqual(FLASH.first - 0.06);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(35 - 0.06);
      expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(70 + 0.06);
    }
  });
});

describe("the umbrella on the wind", () => {
  const path = (dir, r = 0.4) => Array.from({ length: 201 }, (_, i) => umbrellaAt(i / 200, { w: 217, high: 60, low: 240, dir, r }));

  it("crosses the window the way it is going, from one side to the other", () => {
    for (const dir of [1, -1]) {
      const p = path(dir);
      expect(Math.sign(p.at(-1).x - p[0].x)).toBe(dir);
      expect(Math.min(p[0].x, p.at(-1).x)).toBeLessThan(0);
      expect(Math.max(p[0].x, p.at(-1).x)).toBeGreaterThan(217);
      // Always forward: a gust can slow it, never send it back.
      for (let i = 1; i < p.length; i++) expect((p[i].x - p[i - 1].x) * dir).toBeGreaterThan(0);
    }
  });

  it("leads with its canopy and trails its handle: it leans into the way it goes, never upright, never upside down", () => {
    for (const dir of [1, -1])
      for (const r of [0, 0.5, 1])
        for (const f of path(dir, r)) {
          expect(Math.sign(f.lean)).toBe(dir);
          expect(Math.abs(f.lean)).toBeGreaterThan(0.45);
          expect(Math.abs(f.lean)).toBeLessThan(1.45);
        }
  });

  it("speeds and slows with the gust, rises with it and bobs, and stays in the window's height", () => {
    const p = path(1);
    const speeds = p.map((f) => f.speed);
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeGreaterThan(2);
    const ys = p.map((f) => f.y);
    expect(Math.min(...ys)).toBeGreaterThan(20);
    expect(Math.max(...ys)).toBeLessThan(270);
    // Faster is higher: where the gust is strongest it is lifted.
    const fast = p.reduce((a, b) => (b.speed > a.speed ? b : a));
    const slow = p.slice(20, 180).reduce((a, b) => (b.speed < a.speed ? b : a));
    expect(fast.speed).toBeGreaterThan(slow.speed);
  });

  it("turns over lazily, once or twice, about its shaft, and shows the top of its canopy, so the handle trailing behind stays in view", () => {
    for (const r of [0, 0.5, 1]) {
      const p = path(1, r);
      const turns = Math.abs(p.at(-1).spin - p[0].spin) / (2 * Math.PI);
      expect(turns).toBeGreaterThanOrEqual(1);
      expect(turns).toBeLessThanOrEqual(2);
      for (const f of p) {
        expect(f.nod).toBeGreaterThan(0.05);
        expect(f.nod).toBeLessThan(0.32);
      }
    }
  });
});
