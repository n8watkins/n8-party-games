// A timetable for what passes a rendered room's window: the one place that decides when.
//
// The rule: one thing at a time, with an empty while between. Nothing else in the page may start
// a passing thing; the page asks the timetable what is passing now and draws only that. So two
// things can never pass together, and never cross. It runs on the room's clock, seeded by the
// room's code, so every screen in a room sees the same thing at the same moment.
//
// It knows nothing about drawing (no three.js), so it can be run for a simulated week in a test.
// Each room gives it its own list of things and its own times: the Star Lounge's sky
// (star-lounge/sky.js) and the bar's street (bar/street.js).

/**
 * @param {() => number} rnd a source of numbers from 0 up to 1
 * @param {{name: string, family: string, often: number, lasts: number}[]} things  everything that can
 *   pass: `often` is its share of the draw (a rare thing has a small one), `lasts` the seconds from
 *   the moment it enters to the moment it is gone from every screen
 * @param {{first: number, firstThing?: string, quiet: [number, number], askedQuiet: number}} times
 *   `first`: seconds after the start before the first thing passes (`firstThing`, if named, else a
 *   draw); `quiet`: the empty while after one has gone, picked evenly between the two;
 *   `askedQuiet`: the empty while before a thing that was asked for by name
 * @returns the timetable. Call `step(t)` once a frame with the room's clock, in seconds; it returns
 *   what is passing ({ thing, start, end, u } with u from 0 to 1 along its way), or null for nothing.
 */
export function timetable(rnd, things, times) {
  const byName = new Map(things.map((t) => [t.name, t]));
  let now = null;
  let nextAt = times.first;
  let nextThing = byName.get(times.firstThing) ?? null; // the first is the one named; after that, the draw
  let lastFamily = null;
  let asked = null;

  /** The draw: by share, and never the same family twice running (unless there is only one, as the lightning has). */
  const pick = () => {
    const others = things.filter((t) => t.family !== lastFamily);
    const pool = others.length ? others : things;
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
      // Everything due by `t` happens at the moment it was due, not the moment it is noticed, and as
      // many times over as fit: so a screen that came late, a tab that was hidden or a room that was
      // away in a game is on the same timetable as one that drew every frame.
      for (;;) {
        if (now && t >= now.end) {
          // It has gone. Nothing passes for a while, whatever happens.
          nextAt = now.end + (asked ? times.askedQuiet : times.quiet[0] + rnd() * (times.quiet[1] - times.quiet[0]));
          now = null;
        }
        if (now || t < nextAt) break;
        const thing = asked ?? nextThing ?? pick();
        asked = null;
        begin(thing, nextAt, undefined);
      }
      if (now) now.u = Math.min(1, Math.max(0, (t - now.start) / now.thing.lasts));
      return now;
    },
    /** Ask for one thing by name. It comes next: at once (after a breath) if nothing is passing, or
     *  a few seconds after whatever is passing has gone. Asking again replaces the earlier ask.
     *  Returns what it is waiting for (a thing's name), or null if it is on its way. */
    ask(name, t) {
      const thing = byName.get(name);
      if (!thing) return undefined;
      asked = thing;
      if (!now) nextAt = Math.min(nextAt, t + 0.4);
      return now ? now.thing.name : null;
    },
    /** Start one thing this instant, but only when nothing is passing (a tap on the glass calls a
     *  shooting star this way). Returns false, and does nothing, while something is passing. */
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
