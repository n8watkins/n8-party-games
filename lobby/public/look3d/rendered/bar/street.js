// What happens outside the bar's windows, as plain numbers: when each thing passes, when the
// lightning comes, and how the umbrella flies. No drawing here (bar/outside.js draws it), so it
// is tested without a browser (lobby/test/rendered.test.js).
//
// The owner's picks, after two preview rounds: outside, exactly four things, one at a time, with
// 10 to 15 seconds of nothing between (an umbrella on the wind, a cat on the sill, a paper boat,
// the shop light); the steady "Rain"; lightning "now and then": one soft glow, rare, never a strobe.
import { seeded } from "../plate.js";
import { timetable } from "../timetable.js";

/** How far behind the glass the street is (metres, as a depth: the back wall is at -2.5). */
export const STREET_Z = -12;
/**
 * How far the eye moves sideways as the view slides, as a share of how far the view's middle is
 * from the room's (rendered/room-rendered.js, `eye`): at most 6 metres away, so 1.2 metres. The
 * street behind each window is cut wide enough to slide that far (a test checks).
 */
export const EYE = 0.2;

/** Everything that passes, and how long each takes from the moment it starts to the moment it has gone. */
export const THINGS = [
  { name: "umbrella", family: "umbrella", often: 1, lasts: 8 },
  { name: "cat", family: "cat", often: 1, lasts: 11 },
  { name: "boat", family: "boat", often: 1, lasts: 12 },
  { name: "shop", family: "shop", often: 1, lasts: 8 },
];

export const TIMES = {
  /** A few seconds after the room opens the umbrella (the owner's own idea) goes by first. */
  first: 5,
  firstThing: "umbrella",
  /** Then nothing for 10 to 15 seconds after each one has gone. */
  quiet: [10, 15],
  askedQuiet: 2,
};

/** The street's timetable, from the room's start, seeded by the room's code: every screen sees the same thing at the same moment. */
export const createStreet = (rnd) => timetable(rnd, THINGS, TIMES);

/**
 * Which window a thing passes, which way, and a number of its own: the same on every screen,
 * because it is worked out from when it started and the room's seed, not drawn at random.
 * The cat and the boat are only ever at the right window (its sill and its gutter are in view).
 */
export function variant(ev, seed) {
  const rnd = seeded(((Math.round(ev.start * 1000) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0) + 7);
  rnd();
  const name = ev.thing.name;
  const right = name === "cat" || name === "boat" ? true : rnd() < 0.5;
  return { win: right ? "right" : "left", dir: rnd() < 0.5 ? 1 : -1, r: rnd() };
}

// ---------------------------------------------------------------- the lightning

export const FLASH = {
  /** The first comes this long after the room opens; then one every 35 to 70 seconds. */
  first: 24,
  every: [35, 70],
  /** How long one lasts, and how bright it gets (of the street's own light, added). */
  lasts: 2,
  peak: 0.42,
  rise: 0.18,
  fall: 2.6,
};

/** How bright a flash is `e` seconds after it began: a soft rise, then a long fade. One glow, never a flicker. */
export function flashAt(e) {
  if (!(e >= 0) || e > FLASH.lasts) return 0;
  if (e < FLASH.rise) {
    const u = e / FLASH.rise;
    return FLASH.peak * u * u * (3 - 2 * u);
  }
  return FLASH.peak * Math.exp(-(e - FLASH.rise) * FLASH.fall);
}

/** The lightning's timetable on the room's clock: `step(t)` gives how bright it is now (0 most of the time). */
export function createLightning(rnd) {
  const table = timetable(rnd, [{ name: "flash", family: "flash", often: 1, lasts: FLASH.lasts }], { first: FLASH.first, quiet: FLASH.every.map((s) => s - FLASH.lasts), askedQuiet: 1 });
  return {
    step(t) {
      const ev = table.step(t);
      return ev ? flashAt(t - ev.start) : 0;
    },
    /** Starts one now, if none is on (for stills and checks). */
    now(t) {
      table.startIfEmpty("flash", t);
    },
  };
}

// ---------------------------------------------------------------- the umbrella on the wind

const ease = (u) => u * u * (3 - 2 * u);

/**
 * Where the umbrella is `u` (0 to 1) of the way across a window `w` wide (painting pixels, inside
 * the window's box; `high` and `low` its path's top and bottom), going `dir` (1 right, -1 left),
 * with its own number `r`. A real umbrella caught by a gust: the wind fills it, so the canopy
 * leads and the handle trails; it rides the gust, faster as the gust gets up and slower as it
 * drops, lifting with it and bobbing; it sways, and turns over lazily once or twice about its
 * shaft. Never edge on, never upside down.
 *
 * Returns {x, y} (its middle, painting pixels in the window's box), `lean` (radians: the shaft's
 * angle from upright, toward where it is going), `spin` (radians about its shaft), `nod` (radians:
 * how far the canopy tips toward the viewer, so its round top reads), and `speed` (relative, 1 is
 * the mean) for checks.
 */
export function umbrellaAt(u, { w, high, low, dir = 1, r = 0.5 }) {
  u = Math.min(1, Math.max(0, u));
  // The gust: how far along it is is not even in time. Two swells, the second smaller, with a lull between.
  const along = (v) => v - 0.055 * Math.sin(2 * Math.PI * v) - 0.02 * Math.sin(4 * Math.PI * v + 0.6);
  const s = along(u);
  const speed = (along(Math.min(1, u + 0.005)) - along(Math.max(0, u - 0.005))) / (Math.min(1, u + 0.005) - Math.max(0, u - 0.005));
  const margin = 55;
  const x0 = dir > 0 ? -margin : w + margin;
  const x1 = dir > 0 ? w + margin : -margin;
  const x = x0 + (x1 - x0) * s;
  // Lifted as the gust gets up (faster is higher), falling back in the lull, and a gentle bob.
  const lift = (speed - 1) * 34;
  const arc = Math.sin(Math.PI * u) * (low - high) * 0.55;
  const y = low - arc - lift + Math.sin(u * Math.PI * 5 + r * 6) * 4;
  // The shaft leans into the way it is going (the canopy leads), more when the gust is strong, and sways.
  const lean = dir * (0.95 + 0.35 * (speed - 1) + 0.16 * Math.sin(u * Math.PI * 3.2 + r * 4));
  // One or two lazy turns about the shaft, faster in the gust.
  const turns = 1.2 + 0.6 * r;
  const spin = dir * (2 * Math.PI * turns * ease(s) + r * 3);
  // Tipped toward the viewer a little, so the top of the canopy shows its gores, but not so far that
  // the shaft and the crook trailing behind it are hidden under the canopy.
  const nod = 0.2 + 0.07 * Math.sin(u * Math.PI * 2 + r);
  return { x, y, lean, spin, nod, speed };
}
