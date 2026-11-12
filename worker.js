// The party site: one Worker that serves every hosted game's files, the party kit's browser
// files and the kit's room API. Local only for now: run it with `npm run dev`.
// The games are their own repositories (games.js lists them); the kit is this repository's.
import { createPartyRoom, PinDirectory, RateLimiter, RoomBudget, handlePartyApi } from "./party-kit/src/worker/index.js";
import { GAMES } from "./games.js";

// One room class runs one game's rounds, so today the rooms are the first game's.
// Rooms that switch between games are the lobby's work (party-kit/GAME-CONTRACT.md).
const first = GAMES[0];

export const PartyRoom = createPartyRoom(first.game);
export { PinDirectory, RateLimiter, RoomBudget };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect(new URL(first.manifest.path + url.search, url), 302);
    return (await handlePartyApi(request, env)) ?? env.ASSETS.fetch(request);
  },
};
