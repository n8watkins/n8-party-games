// The party site: one Worker that serves the front page, the party room (the lobby), every
// hosted game's files, the party kit's browser files and the room APIs.
// Live at https://partygames.n8builds.dev (DEPLOY.md); locally: `npm run dev`.
// The games are their own repositories (games.js lists them); the kit and the lobby are this repository's.
import { createPartyRoom, PinDirectory, RateLimiter, RoomBudget, ScoreBoard, handlePartyApi } from "./party-kit/src/worker/index.js";
import { json } from "./party-kit/src/worker/http.js";
import { partyFullMessage, roomBudgetReport } from "./party-kit/src/worker/room-budget.js";
import { GAMES } from "./games.js";
import { createLobbyRoom } from "./lobby/server/lobby-room.js";
import { WALL } from "./lobby/wall.js";

// A game's own page (/cork-and-bell/) still makes rooms of its own, as it does on the game's own
// site. One room class runs one game's rounds, so those rooms are the first game's.
const first = GAMES[0];

export const PartyRoom = createPartyRoom(first.game);
/** The party room: one room that holds the lobby and whichever game the party voted for. */
export const LobbyRoom = createLobbyRoom(WALL);
export { PinDirectory, RateLimiter, RoomBudget, ScoreBoard };

/** Where the party room's API lives. The same guards as the kit's own API apply to it. */
const LOBBY_API = "/api/lobby";

/** The games with a high score board (their manifest says so), and the most a round of each can score. */
const SCORES = Object.fromEntries(GAMES.filter(({ manifest }) => manifest.scores).map(({ manifest }) => [manifest.id, { max: manifest.scores.max }]));
/** Local test runs (the "local" environment) get a board of their own, so they never chalk up on a game's. */
const TEST_SCORES = { ...SCORES, "e2e-test": { max: 1000 } };

/**
 * For the tests and the cost measurements, and only where PARTY_DEBUG is "on" (the local
 * environment): what the room budget has counted, and one party room's inner state.
 */
async function debug(url, env) {
  const code = url.pathname.slice(`${LOBBY_API}/debug/`.length);
  if (!code) return json({ ok: true, budget: await roomBudgetReport(env) });
  return json({ ok: true, room: await env.PARTY_LOBBIES.getByName(code).debug() });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.PARTY_DEBUG === "on" && request.method === "GET" && (url.pathname === `${LOBBY_API}/debug` || url.pathname.startsWith(`${LOBBY_API}/debug/`))) return debug(url, env);
    const lobby = await handlePartyApi(request, env, { prefix: LOBBY_API, rooms: env.PARTY_LOBBIES, fullMessage: partyFullMessage });
    if (lobby) return lobby;
    const scores = env.PARTY_SIM_LATENCY === "on" ? TEST_SCORES : SCORES;
    return (await handlePartyApi(request, env, { scores })) ?? env.ASSETS.fetch(request);
  },
};
