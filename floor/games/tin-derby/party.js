// What Tin Derby gives a site that hosts it (party-kit/GAME-CONTRACT.md): the server game definition and
// the manifest. Nothing here, or in anything it imports, names the kit.
//
// It is not hosted yet: there is no page, so `public` is empty and the manifest names no view. games.js
// and the wall do not list it. See README.md, "What the page lane needs".

/** The server game definition, for a party room. */
export { game } from "./shared/rules.js";

export const manifest = {
  id: "tin-derby",
  name: "Tin Derby",
  /** Where the game will live on a site. */
  path: "/tin-derby/",
  /** One line for the game's box on the party room's wall. */
  blurb: "Wind-up tin cars round the breakfast table",
  /** Up to four cars are players; house cars fill the empty seats, so one player can race alone. */
  players: { min: 2, max: 4, solo: true },
  devices: { phone: true, desktop: true, sharedScreen: true, sideways: "preferred" },
  /** What a browser loads: nothing yet. */
  public: [],
};
