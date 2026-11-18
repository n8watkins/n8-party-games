// The sky's timetable: the one place that decides when something passes the Star Lounge's window.
//
// The rule: one thing at a time, with empty sky between. Nothing else in the page may start a
// rocket, a ship, a rock or a shooting star; the page asks this timetable what is passing now and
// draws only that. So two things can never be in the sky together, and never cross. The
// timetable itself is every rendered room's (rendered/timetable.js); these are the sky's things.
//
// It knows nothing about drawing (no three.js), so it can be run for a simulated week in a test:
//   node preview/star-lounge/test-sky.mjs
import { timetable } from "../timetable.js";

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
  /** Seconds after the page opens before the first thing passes, and what it is. */
  first: 6,
  firstThing: "rocket",
  /** The empty sky after one thing has gone and before the next: a time picked evenly between these two. */
  quiet: [20, 45],
  /** The empty sky before a thing that was asked for by name (the Notes' "send one now" buttons). */
  askedQuiet: 3,
};

/**
 * @param {() => number} rnd a source of numbers from 0 up to 1
 * @returns the sky's timetable (rendered/timetable.js): `step(t)` once a frame with the room's
 *   clock gives what is passing ({ thing, start, end, u }), or null for an empty sky.
 */
export const createSky = (rnd = Math.random, things = THINGS, times = TIMES) => timetable(rnd, things, times);
