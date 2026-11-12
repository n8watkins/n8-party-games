// The party site: one Worker that serves every hosted game's files, the party kit's browser
// files and the kit's room API. Live at https://partygames.n8builds.dev (DEPLOY.md); locally: `npm run dev`.
// The games are their own repositories (games.js lists them); the kit is this repository's.
import { createPartyRoom, PinDirectory, RateLimiter, RoomBudget, ScoreBoard, handlePartyApi } from "./party-kit/src/worker/index.js";
import { GAMES } from "./games.js";

// One room class runs one game's rounds, so today the rooms are the first game's.
// Rooms that switch between games are the lobby's work (party-kit/GAME-CONTRACT.md).
const first = GAMES[0];

export const PartyRoom = createPartyRoom(first.game);
export { PinDirectory, RateLimiter, RoomBudget, ScoreBoard };

/** The games with a high score board (their manifest says so), and the most a round of each can score. */
const SCORES = Object.fromEntries(GAMES.filter(({ manifest }) => manifest.scores).map(({ manifest }) => [manifest.id, { max: manifest.scores.max }]));
/** Local test runs (the "local" environment) get a board of their own, so they never chalk up on a game's. */
const TEST_SCORES = { ...SCORES, "e2e-test": { max: 1000 } };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect(new URL(first.manifest.path + url.search, url), 302);
    const scores = env.PARTY_SIM_LATENCY === "on" ? TEST_SCORES : SCORES;
    return (await handlePartyApi(request, env, { scores })) ?? env.ASSETS.fetch(request);
  },
};
