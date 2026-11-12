// The one Worker for the party games in this repository. Local only: run it with `npm run dev`.
// It serves the static files (each game's folder and the party kit's browser files) and the
// party kit's room API. The room runs Cork & Bell's battle.
import { createPartyRoom, PinDirectory, RateLimiter, RoomBudget, ScoreBoard, handlePartyApi } from "./party-kit/src/worker/index.js";
import { MAX_ROUND_SCORE, game } from "./cork-and-bell/game/shared/battle.js";

export const PartyRoom = createPartyRoom(game);
export { PinDirectory, RateLimiter, RoomBudget, ScoreBoard };

/** The games with a score board, and the most a round of each can score. */
const SCORES = { [game.id]: { max: MAX_ROUND_SCORE } };
/** Local test runs (the "local" environment) get a board of their own, so they never chalk up on a game's. */
const TEST_SCORES = { ...SCORES, "e2e-test": { max: 1000 } };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect(new URL("/cork-and-bell/" + url.search, url), 302);
    const scores = env.PARTY_SIM_LATENCY === "on" ? TEST_SCORES : SCORES;
    return (await handlePartyApi(request, env, { scores })) ?? env.ASSETS.fetch(request);
  },
};
