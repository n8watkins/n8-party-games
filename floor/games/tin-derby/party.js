// What Tin Derby gives a site that hosts it (party-kit/GAME-CONTRACT.md): the server game definition and
// the manifest. Nothing here, or in anything it imports, names the kit.

/** The server game definition, for a party room. */
export { game } from "./shared/rules.js";

export const manifest = {
  id: "tin-derby",
  name: "Tin Derby",
  /** Where the game lives on a site. */
  path: "/tin-derby/",
  /** One line for the game's box on the party room's wall. */
  blurb: "Wind-up tin cars round the breakfast table",
  /** Up to four cars are players; house cars fill the empty seats, so one player can race alone. */
  players: { min: 2, max: 4, solo: true },
  devices: { phone: true, desktop: true, sharedScreen: true, sideways: "preferred" },
  /** The module, under `path`, whose mount() shows a race the room has started (page/party-view.js). */
  lobby: { view: "page/party-view.js" },
  /**
   * What a browser loads, copied under `path` by the site's build: the page, and the rules and numbers it
   * runs to show the race before the room's word arrives (shared/replica.js). Nothing in a race is secret:
   * the rules are the room's own and every viewer's snapshot holds the whole race. Tests and tools stay out.
   */
  public: [
    { from: "page", to: "page" },
    { from: "shared", to: "shared" },
    { from: "data", to: "data" },
  ],
};
