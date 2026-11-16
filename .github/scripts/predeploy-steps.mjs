// The end-to-end steps of the pre-deploy gate (.github/scripts/predeploy.mjs), in the order they
// run one after another: [what it is, the npm script]. Each script takes --base=<local Worker>.
// Kept in a module of its own so a unit test can check the gate covers what it must
// (lobby/test/predeploy-steps.test.js).
export const STEPS = [
  ["room, over sockets (test:room)", "test:room"],
  ["party room, over sockets (test:lobby)", "test:lobby"],
  ["Cork & Bell in the party room, headless browser (test:cork)", "test:cork"],
  ["Hot Potato, headless browser (test:hot-potato)", "test:hot-potato"],
  ["Hot Potato's hearing test, headless browser (test:hearing)", "test:hearing"],
  ["the switch between the Floor and the Table, over sockets (test:mode)", "test:mode"],
  ["the Floor and the Table side by side, headless browser (test:two-rooms)", "test:two-rooms"],
  ["a game at the Table, headless browser (test:table)", "test:table"],
  ["Tin Derby raced in the party room, headless browser (test:tin-derby)", "test:tin-derby"],
];

/**
 * The port of step `i` when the steps run side by side, each against a Worker of its own:
 * PREDEPLOY_PORT, then +2, +3 and on (+1 is left free, as it always was).
 */
export const stepPort = (base, i) => base + (i === 0 ? 0 : i + 1);
