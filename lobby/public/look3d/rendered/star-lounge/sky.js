// The sky's timetable: the one place that decides when something passes the window.
//
// The rule: one thing at a time, with empty sky between. Nothing else in the page may start a
// rocket, a ship, a rock or a shooting star; the page asks this timetable what is passing now and
// draws only that. So two things can never be in the sky together, and never cross.
//
// It knows nothing about drawing (no three.js), so it can be run for a simulated week in a test:
//   node preview/star-lounge/test-sky.mjs

/** Everything that can pass. `often` is its share of the draw (a rare thing has a small one);
 *  `lasts` is the seconds from the moment it enters to the moment it is gone from every screen. */
export const THINGS = [
  { name: "star", family: "star", often: 5, lasts: 0.9 },
  { name: "rock0", family: "rock", often: 2, lasts: 30 },
  { name: "rock1", family: "rock", often: 2, lasts: 24 },
  { name: "rock2", family: "rock", often: 2, lasts: 36 },
  { name: "rocket", family: "rocket", often: 4, lasts: 9 },
  { name: "liner", family: "liner", often: 2, lasts: 34 },
  { name: "saucer", family: "saucer", often: 1, lasts: 11 },
];

export const TIMES = {
  /** Seconds after the page opens before the first thing (the rocket) passes. */
  first: 6,
  /** The empty sky after one thing has gone and before the next: a time picked evenly between these two. */
  quiet: [20, 45],
  /** The empty sky before a thing that was asked for by name (the Notes' "send one now" buttons). */
  askedQuiet: 3,
};

/**
 * @param {() => number} rnd a source of numbers from 0 up to 1
 * @returns the timetable. Call `step(t)` once a frame with the room's clock, in seconds; it returns
 *   what is passing ({ thing, start, end, u } with u from 0 to 1 along its way), or null for an empty sky.
 */
export function createSky(rnd = Math.random, things = THINGS, times = TIMES) {
  const byName = new Map(things.map((t) => [t.name, t]));
  let now = null;
  let nextAt = times.first;
  let nextThing = byName.get("rocket") ?? null; // the first is always the rocket; after that, the draw
  let lastFamily = null;
  let asked = null;

  /** The draw: by share, and never the same family twice running. */
  const pick = () => {
    const pool = things.filter((t) => t.family !== lastFamily);
    let r = rnd() * pool.reduce((s, t) => s + t.often, 0);
    for (const t of pool) if ((r -= t.often) < 0) return t;
    return pool[pool.length - 1];
  };
  const begin = (thing, t, data) => {
    now = { thing, start: t, end: t + thing.lasts, u: 0, data };
    lastFamily = thing.family;
    nextThing = null;
  };

  return {
    step(t) {
      if (now && t >= now.end) {
        // It has gone. The sky is now empty for a while, whatever happens.
        nextAt = now.end + (asked ? times.askedQuiet : times.quiet[0] + rnd() * (times.quiet[1] - times.quiet[0]));
        now = null;
      }
      if (!now && t >= nextAt) {
        const thing = asked ?? nextThing ?? pick();
        asked = null;
        begin(thing, t, undefined);
      }
      if (now) now.u = Math.min(1, Math.max(0, (t - now.start) / now.thing.lasts));
      return now;
    },
    /** Ask for one thing by name. It comes next: at once (after a breath) if the sky is empty, or
     *  a few seconds after whatever is passing has gone. Asking again replaces the earlier ask.
     *  Returns what it is waiting for (a thing's name), or null if it is on its way. */
    ask(name, t) {
      const thing = byName.get(name);
      if (!thing) return undefined;
      asked = thing;
      if (!now) nextAt = Math.min(nextAt, t + 0.4);
      return now ? now.thing.name : null;
    },
    /** Start one thing this instant, but only into an empty sky (a tap on the glass calls a shooting
     *  star this way). Returns false, and does nothing, while something is passing. */
    startIfEmpty(name, t, data) {
      const thing = byName.get(name);
      if (!thing || now) return false;
      begin(thing, t, data);
      return true;
    },
    /** What is passing, without moving the clock. */
    get now() {
      return now;
    },
    get nextAt() {
      return now ? null : nextAt;
    },
  };
}
