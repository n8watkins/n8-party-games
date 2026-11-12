// The one Worker for the party games in this repository. Local only: run it with `npm run dev`.
// It serves the static files (each game's folder and the party kit's browser files) and the
// party kit's room API. The room runs Cork & Bell's battle.
import { createPartyRoom, PinDirectory, RateLimiter, RoomBudget, handlePartyApi } from "./party-kit/src/worker/index.js";
import { game } from "./cork-and-bell/game/shared/battle.js";

export const PartyRoom = createPartyRoom(game);
export { PinDirectory, RateLimiter, RoomBudget };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect(new URL("/cork-and-bell/" + url.search, url), 302);
    return (await handlePartyApi(request, env)) ?? env.ASSETS.fetch(request);
  },
};
