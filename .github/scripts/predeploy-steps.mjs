// The end-to-end steps of the pre-deploy gate (.github/scripts/predeploy.mjs), in the order they
// run one after another: [what it is, the npm script, options?]. Each script takes --base=<local Worker>.
// Options: `env`, the wrangler environment of a fresh Worker of the step's own ("" is production's
// settings; without it the step shares the gate's "local" Worker when the steps run one after another).
// `own`: the step starts (and restarts) a Worker of its own from builds of its own, never in
// dist/public: the gate starts none for it and gives it a free port instead (--port=<port>).
// Kept in a module of its own so a unit test can check the gate covers what it must
// (lobby/test/predeploy-steps.test.js).
export const STEPS = [
  ["room, over sockets (test:room)", "test:room"],
  ["party room, over sockets, a round of Cork & Bell played until the corks run out (test:lobby)", "test:lobby"],
  ["Cork & Bell in the party room, the battle and the round alone side by side, headless browser (test:cork)", "test:cork"],
  ["Hot Potato, its cases four at a time in one browser, headless (test:hot-potato)", "test:hot-potato"],
  ["Hot Potato's hearing test, headless browser (test:hearing)", "test:hearing"],
  ["the switch between the Floor and the Table, over sockets (test:mode)", "test:mode"],
  ["the Floor and the Table side by side, headless browser (test:two-rooms)", "test:two-rooms"],
  ["a game at the Table, headless browser (test:table)", "test:table"],
  ["Paper Masks at the Table, three whole matches side by side, each in a party of its own, with every secret checked, headless browser (test:paper-masks)", "test:paper-masks"],
  ["the front page's three doors and every way out of them, headless browser (test:home)", "test:home"],
  ["Tin Derby in the party room, one short race with every trouble at once, headless browser (test:tin-derby)", "test:tin-derby"],
  ["the robot's and the slime's moves on the Floor, in both looks, every phone checked frame by frame, headless browser (test:moves)", "test:moves"],
  ["the characters' counters (the charged kick, the speeds, the hooks and touches on each other), a phone and a big screen in both looks, headless browser (test:counters)", "test:counters"],
  ["Who Am I? at the Table, four matches with every secret checked and the away timer run out, headless browser (test:who-am-i)", "test:who-am-i"],
  ["Cork & Bell's test switches and high score board with the production settings, headless browser (test:cork:switches)", "test:cork:switches", { env: "" }],
  ["a new build reaching the pages already open: deploys, a rollback, both protocols, on a Worker of its own, headless browser (test:release)", "test:release", { own: true }],
];

/**
 * The port of step `i` when the steps run side by side, each against a Worker of its own:
 * PREDEPLOY_PORT, then +2, +3 and on (+1 is left free, as it always was).
 */
export const stepPort = (base, i) => base + (i === 0 ? 0 : i + 1);

/**
 * Whether the gate's local Workers and the pages they serve name one build, or a plain message
 * saying how they do not. The Workers share dist/public, and each rebuilt it as it started: every
 * Worker's own record (`releases`: [{base, release}], from each one's /api/version) must name the
 * build in the shared dist/public/release.js (`fileId`), or its pages would believe a new
 * version is out and reload themselves in the middle of the suites (as after #88, when a local
 * and a production-settings build of one tree had different ids).
 */
export function releaseMismatch(releases, fileId) {
  if (!fileId) return "dist/public/release.js names no release id: the build did not write it.";
  const off = releases.filter((w) => w.release !== fileId);
  if (!off.length) return null;
  return [
    `The local Workers do not all name the build their pages load (dist/public/release.js: ${fileId}):`,
    ...off.map((w) => `  ${w.base} says ${w.release ?? "nothing (no /api/version answer)"}`),
    "Two builds of one tree must make one release id (scripts/release.mjs, releaseId); otherwise every page would take itself for an old one and reload.",
  ].join("\n");
}

/** The release id in a release.js module's text, or null. */
export const releaseIdIn = (text) => /"id":"([0-9a-f]{12})"/.exec(text ?? "")?.[1] ?? null;
