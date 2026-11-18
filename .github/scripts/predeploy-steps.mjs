// The end-to-end steps of the pre-deploy gate (.github/scripts/predeploy.mjs), in the order they
// run one after another: [what it is, the npm script, options?]. Each script takes --base=<local Worker>.
// Options: `env`, the wrangler environment of a fresh Worker of the step's own ("" is production's
// settings; without it the step shares the gate's "local" Worker when the steps run one after another).
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
  ["Paper Masks at the Table, three whole matches with every secret checked, headless browser (test:paper-masks)", "test:paper-masks"],
  ["the front page's three doors and every way out of them, headless browser (test:home)", "test:home"],
  ["Tin Derby in the party room, one short race with every trouble at once, headless browser (test:tin-derby)", "test:tin-derby"],
  ["Who Am I? at the Table, three whole matches with every secret checked, headless browser (test:who-am-i)", "test:who-am-i"],
  ["Cork & Bell's test switches and high score board with the production settings, headless browser (test:cork:switches)", "test:cork:switches", { env: "" }],
];

/**
 * The port of step `i` when the steps run side by side, each against a Worker of its own:
 * PREDEPLOY_PORT, then +2, +3 and on (+1 is left free, as it always was).
 */
export const stepPort = (base, i) => base + (i === 0 ? 0 : i + 1);
