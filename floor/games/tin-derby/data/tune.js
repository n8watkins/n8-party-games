// =====================================================================================
// TIN DERBY: EVERY TUNABLE NUMBER, AND THE TABLE ITSELF, LIVE IN THIS ONE FILE.
// The room's rules (shared/rules.js) and the preview page read the same file; nothing here is code.
// It is plain data (test/data.test.js checks it survives JSON), frozen so nothing can change it while
// a race runs. To try other numbers, build the rules from a changed copy: makeRules(retune({ ASSIST: 0 })).
//
// The numbers are round five's as reviewed (the preview's reviewed copy, 2026-11-16), unchanged, plus one new block, NET,
// for what a room needs and a solo page does not. README.md lists every difference from round five.
//
// Lengths are in car lengths (one tin car is 1 long), times in seconds, speeds in car
// lengths a second, angles in radians unless named.
// Round five is a breakfast table and nothing else: no books, no rulers. Every set piece is a
// breakfast thing doing a racing job, every hazard is something on the table visibly doing it,
// every spill does one clear thing, and each of the four racers has one trait.
// Across the loop, + is the infield (right on the home straight) and - the outside.
// =====================================================================================
const DATA = {
  // ---- The table and the loop ----
  // The lap is a list of pieces, in order: ["S", length] is straight, ["A", radius, degrees] a turn
  // (positive turns right). A piece may carry `bank` (degrees the turn leans in) and a `tag`.
  HALF: 3.4, // half the track's width: 6.8 across, about nine cars side by side
  TRACK: [
    ["S", 108, { tag: "home" }],
    ["A", 14, 180, { tag: "bank", bank: 16 }],
    ["S", 108, { tag: "back" }],
    ["A", 9, 90, { tag: "w1" }],
    ["S", 12, { tag: "west" }],
    ["A", 9, 90, { tag: "w2" }],
  ],
  // Where the road widens: round the shakers (a real gap on both sides) and round the lazy Susan.
  WIDEN: [
    { u0: 45, u1: 81, half: 5.0, ease: 5 },
    { u0: 172, u1: 184, half: 5.0, ease: 4 },
  ],
  START_X: -54, START_Z: -16,
  CAR_LEN: 1,
  CAR_W: 0.76,
  CAR_H: 0.47, // the tin body's height (a rider adds about as much again)
  CAR_R: 0.48, // a car, as a circle, for bumping cars and props (two cars nose to tail just touch)
  LINE_U: 6, // the start line, this far along the home straight
  GRID: [[-1.6, -1.2], [-1.6, 1.2], [-3.4, -1.2], [-3.4, 1.2]], // [behind the line, across]
  LAPS: 2,

  // ---- The course: breakfast set pieces, by distance along the loop (u) and across it (lat) ----
  // Wind-up keys painted on the cloth: cross one for a boost. The slalom's keys sit in one gap of each shaker.
  PADS: [
    { u: 19.5, lat: 0, hw: 1.5 }, // before the bread board
    { u: 49, lat: 3.1, hw: 0.95 }, // the first shaker's right gap
    { u: 62, lat: -3.1, hw: 0.95 }, // the second shaker's left gap
    { u: 75, lat: 3.1, hw: 0.95 }, // the third shaker's right gap
    { u: 240, lat: 1.5, hw: 0.9 }, // after the toast
  ],
  // A "deck" is a raised surface along the loop: its height along u as [u, h] points (a repeated u is a drop), over [lat0, lat1].
  DECKS: [
    // The bread board leant on a baguette, in front of the butter dish: a ramp and a jump.
    { name: "bread board", look: "board", lat: [-1.45, 1.45], pts: [[23, 0], [26.5, 0.6], [28.2, 1.3]], jump: { clear: 34.2, win: [27.4, 28.9] } },
    // The wooden spoon laid up the rim of a cereal bowl, on the outside half: a ramp beside the oatmeal spilt on the inside.
    { name: "spoon ramp", look: "spoon", lat: [-2.9, -0.7], pts: [[85, 0], [89.6, 0.85], [90.6, 1.15]], jump: { clear: 0, win: [89, 91.5] } },
    // The pancake staircase: a spatula up onto the tall stack (its stacks are below, in STACKS).
    { name: "spatula", look: "spatula", lat: [-3.6, 3.6], pts: [[153, 0], [157.4, 1.5]], jump: { clear: 0, from: 162.6, win: [156, 168] } },
    // The butter knives along the open edge, resting on egg cups: a raised lane by the drop.
    { name: "knife bridge", look: "knives", lat: [-3.3, -2.1], pts: [[208, 0], [210, 0.5], [224, 0.5]] },
  ],
  // Pancake stacks: round, drawn and driven as ellipses (u, lat, ru, rl, h). Overlapping, so each is a step down.
  STACKS: [
    { u: 159.0, lat: 0, ru: 2.2, rl: 4.6, h: 1.5 },
    { u: 162.2, lat: 0, ru: 2.0, rl: 4.6, h: 1.0 },
    { u: 165.2, lat: 0, ru: 2.0, rl: 4.6, h: 0.5 },
  ],
  DOMES: [
    // The butter dish: a low plate, the glass cover over the butter. Cars drive over it.
    { name: "butter dish", u: 31.5, lat: 0, ru: 2.3, rl: 2.3, h: 1.0, rim: 2.7, rimH: 0.12 },
  ],
  // ---- The shakers: large, each in the middle of a road that widens round it, a gap on both sides ----
  SHAKERS: [[50, 0, "pepper"], [63, 0, "salt"], [76, 0, "pepper"]],
  SHAKER_R: 1.1,
  SHAKER_H: 4.3,
  // ---- Spills: each covers part of the road, with a clean line beside it; each does one thing ----
  // spin: round once, under a second, still rolling.  slide: the car slides on the way it was going.  slow: sticky.
  SPILLS: [
    { name: "salt", does: "slide", u: 63.6, lat: 3.75, ru: 2.0, rl: 0.85 }, // spilt from the salt shaker, in its right gap
    { name: "oatmeal", does: "spin", u: 95.5, lat: 2.3, ru: 2.3, rl: 1.1 }, // from the bowl tipped over on the infield side
    { name: "tea", does: "slide", u: 266, lat: 2.35, ru: 3.2, rl: 1.1 }, // from the teacup on its side, on the corner's inside
  ],
  SLICK_GRIP: 2.0, // on a slide, how fast (rad/s) the way a car moves follows the way it points
  SPIN_T: 0.6, SPIN_LOSE: 0.15, // oatmeal: round once in this long, losing this share of speed; then a moment before it can spin again
  SYRUP_CAP: 0.55, // on syrup, top speed is this share
  TUNNEL: { u: 194, len: 4.5, half: 2.0, funnel: 3.5, top: 13, arch: 3.1, wall: 2.6 }, // the cereal box: a building with an arch through it
  EDGE: { u0: 204, u1: 230, out: 0.9 }, // the open edge: no wall on the outside, then the table ends
  BRIDGE: { u0: 207, u1: 225, lat: -2.7 }, // where a car on the bridge line keeps to it

  // ---- The live kitchen: things on the table that move, each on its own clock (seeded, never hidden) ----
  // The first lap is gentler: the egg, the toast and the syrup start only at ARM_T (race seconds), and the bowl drops
  // cherries half as often until then.
  ARM_T: 36,
  // The fruit bowl over the inside of the bank: a cherry wobbles on the rim (its shadow ring growing on the road), drops and rolls.
  BOWL: { foot: 4.4, rim: 13.2, rimY: 7.4 },
  CHERRY: { every: 6.0, early: 11, warn: 1.6, fall: 0.5, roll: 3.0, r: 0.55, max: 2, life: 3.2 },
  // The kettle outside the home straight: the lid rattles and it whistles, then steam across the track pushes cars toward the infield.
  KETTLE: { u: 103, lat: -7.8, period: 7, warn: 1.4, blow: 1.6, u0: 99.5, u1: 106.5, push: 2.6 },
  // The lazy Susan on the back straight: a turntable carrying a jam jar and a honey pot round. Its outside half carries you
  // on along the road, its infield half carries you back (spin is radians a second; negative turns the other way).
  SUSAN: { u: 178, lat: 0, r: 4.5, h: 0.24, bevel: 0.8, spin: 0.5, things: [{ a: 0, at: 3.0, r: 0.8, h: 1.9, kind: "jam" }, { a: 3.141592653589793, at: 3.0, r: 0.72, h: 1.5, kind: "honey" }] },
  // The toaster in the infield: the lever goes down, the toast pops, flies over and lands across the inside half as a ramp.
  TOASTER: { u: 234, lat: 7.2, period: 8.5, warn: 1.4, fly: 0.7, lie: 4.2, gone: 0.4, land: 235, lat0: -1.0, lat1: 2.9, len: 2.4, hgt: 0.55 },
  // The egg in its cup on the west straight's infield: it rocks, tips out and rolls across the road to the far rail.
  EGG: { u: 280, from: 5.4, to: -3.0, every: 7.5, warn: 1.5, roll: 2.8, r: 0.62, rest: 0.9, phase: 1.5 },
  // The syrup bottle over the last corner's inside: it tips, a strand drips and a sticky patch grows on the road, then dries.
  SYRUP: { u: 294, lat: 1.85, every: 9, warn: 1.4, grow: 0.8, stay: 4.0, dry: 0.8, r: 1.35, phase: 3 },

  // ---- Powers: three, each unlike the others. Sweets on doilies give one (one held at a time) ----
  BOXES: [
    { u: 40, lats: [-2.4, -0.8, 0.8, 2.4] }, // before the slalom
    { u: 146, lats: [-2.2, -0.75, 0.75, 2.2] }, // late in the bank
    { u: 202, lats: [-1.2, 0, 1.2, 2.4] }, // out of the cereal box (kept off the open edge)
    { u: 253, lats: [-2.4, -0.8, 0.8, 2.4] }, // after the toast
  ],
  BOX_R: 0.8, // how close counts as through
  BOX_BACK: 3, // a sweet is back on its doily this long after it was taken
  UNWRAP_T: 0.6, // a moment to unwrap it before it can be used
  // Overwind: a boost (the key spins, orange).  Pepper shot: a peppercorn fired at the car ahead.  Butter pat: dropped behind, a slick.
  ITEMS: ["overwind", "pepper", "butter"],
  // The draw, by your place when you take it (1st to 4th): weights for each item in ITEMS order.
  ODDS: [
    [10, 25, 65],
    [30, 45, 25],
    [45, 45, 10],
    [60, 38, 2],
  ],
  OVERWIND_T: 2.2, OVERWIND: 1.55, // a big boost: this long, at this share of top speed
  BUTTER_LIFE: 12, BUTTER_R: 1.0, BUTTER_SPIN: 0.55, BUTTER_LOSE: 0.3, // a pat dropped behind in a yellow slick: who hits it spins round once
  PEPPER_SPEED: 18, PEPPER_RANGE: 40, PEPPER_LOSE: 0.4, SNEEZE_T: 0.45, PEPPER_T: 0.8, // the shot flies to the car ahead: it sneezes
  HOUSE_TAKE: 0.45, // house cars take a sweet this share of the times they could, and use it sparingly

  // ---- The racers: one trait each, with a small drawback ----
  TRAITS: {
    pawn: { say: "Steady: bumps barely slow you", bumpK: 0.45, miniK: 0.85 }, // drawback: drift boosts a little shorter
    ghost: { say: "Fades through one knock every 8 s", phaseEvery: 8, phaseT: 0.7, pushK: 1.6 }, // drawback: steam and the turntable push it further
    slime: { say: "Sticks: spills never slide or spin", topK: 0.975 }, // drawback: top speed a little lower
    robot: { say: "Drift boosts charge faster", chargeK: 0.7, turnK: 0.9 }, // drawback: heavier steering
  },

  // ---- The car ----
  TOP_SPEED: 9.5,
  ACCEL: 9.5, // from a standstill; it eases off toward top speed
  BRAKE: 16,
  REVERSE: 3.5,
  COAST: 3,
  OVER_BLEED: 5, // how fast speed above the limit (after a boost) bleeds away
  TURN: 2.6, // turn rate at low speed, at full steer
  TURN_HI: 0.55, // share of it left at top speed (speed-sensitive turning)
  STEER_IN: 3.6, // how fast the wheel turns toward full lock (a tap is a small correction)
  STEER_OUT: 10, // and back to centre
  AIR_STEER: 0.35,
  ASSIST: 0.9,
  GRADE: 0.35, // share of gravity felt climbing a ramp
  GRAVITY: 15, // floaty: a toy's airtime
  CLIMB: 0.75, // any rise this high or lower is driven up (with a clunk above 0.3)
  // ---- Boost: pads and drifts ----
  BOOST: 1.4, // speed with a boost, as a share of top speed
  PAD_T: 1.0,
  DRIFT_MIN: 4.5, // speed needed to start a drift
  DRIFT_1: 0.55, DRIFT_2: 1.3, // seconds held for a small and a big boost
  MINI_1: 0.6, MINI_2: 1.15, // and how long each lasts
  // ---- Walls, posts and bumps: soft, never a stop ----
  WALL_HIT: 0.3, // share of the speed into the wall lost on contact
  SCRAPE: 0.3, // speed lost a second while touching a wall
  POST_HIT: 0.55, // share of the speed into a solid prop lost on contact (the rest slides round it)
  BUMP_LOSE: 0.15, // round five: was 0.35 (a casual player rear-ended house cars 15 to 27 times a race)
  WOBBLE_T: 0.35, // never more than half a second off balance
  // ---- Falling off the open edge ----
  FALL_T: 0.6, HAND_T: 0.7, // the drop, then the Hand puts it back: 1.3 s in all

  // ---- The race ----
  COUNT_IN: 3,
  LAST_CALL: 20, // a slow player still gets home
  HOUSE_GRACE: 5, // seconds the house cars get to finish after the last player is home
  RACE_CAP: 120,

  // ---- House cars ----
  // pace: share of top speed; lane: where across the track it likes to be; wander: how loose its line is.
  // aim: where it likes to be against the leading player, in lengths (+ ahead). lastFree: on the last lap it does not wait at all.
  HABITS: {
    ace: { pace: 0.97, lane: 0.2, wander: 0.2, bridge: 0, pads: 0.9, aim: 0 },
    // lastAim/lastPush: on the last lap it races to finish just ahead of the leading player, pushing at full strength when
    // behind, so a car nobody steers never places in the top two; a decent driver still beats it.
    pip: { pace: 0.945, lane: -0.5, wander: 0.25, bridge: 1, pads: 0.85, aim: -6, lastAim: 4, lastPush: true },
    // Round five's review: Gus was 0.84. At 0.78 a clumsy keyboard player at heavy lag is 4th in 18% of races, not 46%
    // (240 seeded races each), and a car nobody steers still never gets into the top two more often than before.
    gus: { pace: 0.78, lane: 0.6, wander: 0.5, bridge: 0, pads: 0.5, aim: -18, lastFree: true }, // the slow one: a casual lap beats him
    dot: { pace: 0.94, lane: 0.0, wander: 0.35, bridge: 0, pads: 0.75, aim: 1, lastAim: 2, lastPush: true },
  },
  YIELD: 3.0, YIELD_W: 1.45, // a house car with a player this close behind and faster moves this far out of the player's line
  // Rubber banding: each house car eases off when ahead of its aim and pushes when behind it.
  RUBBER_AHEAD: 0.25,
  RUBBER_BEHIND: 0.1, // speed gained at RUBBER_D behind
  RUBBER_D: 16,
  RUBBER_FLOOR: 0.8, // never slower than this share of its pace
  RUBBER_LAST: 0.5, // on the last lap the push from behind is this much weaker, so a lead holds
  RUBBER_LAST_WAIT: 0.4, // and a house car ahead waits this much less for a player behind it

  // ---- The room (new for multiplayer; a solo page uses DELAY 0) ----
  NET: {
    DELAY: 0.15, // the room runs the race this far behind its clock, so a phone's input arrives before the step it is stamped for
    AHEAD: 0.1, // an input stamped further ahead of the room's clock than this is brought back to it
    STEER_STEPS: 16, // steering is rounded to this many steps each way, so a thumb resting still sends nothing
    SEND_EVERY: 0.066, // a page sends a steer change at most this often (15 a second; the room takes 20 messages a second from a socket)
    QUEUE: 32, // inputs one car may have waiting for their step; more are refused (a flood)
    BEAT: 6, // every this many ticks the room says how far it has got, even when nobody steered (5 times a second)
    CATCH_UP: 480, // the most steps one tick runs when the room fell behind (4 s of race)
  },

  // ---- The view (drawn only) ----
  CAM_DIST: 1.75,
  CAM_HEIGHT: 0.72,
  CAM_PITCH: 5,
  CAM_LAG: 0.16,
  CAM_TURN_LOOK: 0.35, // how far the camera looks into a corner (share of the track's turn ahead)
  CAM_FOV: 68,
  CAM_KICK_FOV: 7,
  CAM_HIDE: 1.6,
  TV_CUT_T: 1.4,
  TV_CUT_GAP: 8,
  SHAKE_BUMP: 0.07,
  SHAKE_LAND: 0.05,
  FADE_NEAR: 28,
  FADE_FAR: 120,
  FADE_MAX: 0.5,
  OUTLINE: 0.012,
  CLOTH_TILE: 8, // the cloth's pattern repeats this often: one check is about one car long
  DPR_CAP: 2,
  TOUCH_DPR_CAP: 1.5, // round five: a phone draws at most 1.5 pixels per CSS pixel
  SPLIT_DPR_CAP: 1.25,
  GOV_SLOW_MS: 20,
  GOV_FAST_MS: 12.5,
};

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** The numbers every race uses. Frozen: build the rules from `retune(changes)` to try others. */
export const TUNE = deepFreeze(DATA);

/**
 * A frozen copy of the numbers with some changed. A change replaces a top-level entry whole, except a
 * plain object (TUNNEL, HABITS, NET ...), whose named keys are changed and the rest kept.
 */
export function retune(changes = {}, base = TUNE) {
  const copy = JSON.parse(JSON.stringify(base));
  for (const [key, value] of Object.entries(changes)) {
    const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
    copy[key] = plain(value) && plain(copy[key]) ? { ...copy[key], ...value } : value;
  }
  return deepFreeze(copy);
}
