// The release record the unit tests see when they import the Worker (vitest.config.js aliases
// "n8-party-games/release" here). A real build writes dist/release.js instead (scripts/release.mjs);
// the tests do not depend on a build having run.
export const RELEASE = Object.freeze({
  id: "000000000000",
  site: "0.0.0",
  commit: "test",
  dirty: false,
  pushed: true,
  builtAt: "2026-01-01T00:00:00.000Z",
  games: {},
});
