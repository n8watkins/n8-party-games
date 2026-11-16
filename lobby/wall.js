// The wall of the party room: which game boxes hang on it, in order, and which of them can start.
//
// A box is drawn from a game's manifest (name, blurb, players, devices). There are four kinds:
//   hosted       a real game the site hosts (games.js), played inside the room: started with the
//                party's seats, shown by the view its manifest names (`lobby.view`), ended with
//                places. Cork & Bell is the first. A hosted game with no such view yet hangs as
//                an outside game whose address is its own page on this site.
//   outside      a game that is not on the kit and plays on a site of its own, with rooms of its
//                own. It has a `url` instead of a server definition: when it wins the vote every
//                page goes there. There is none today (Who Am I? was one until it was hosted).
//   test         Coin Flip, a placeholder that plays through the whole seam. It hangs only where
//                PARTY_TEST_GAMES is "on" (the local environment and the test runs), never in
//                production.
//   coming soon  a name and a picture for a game that is not built. Its light stays off.
import { GAMES } from "../games.js";
import * as coinFlip from "./games/coin-flip.js";
import { boxFromManifest } from "./shared/vote.js";


/**
 * Games that play somewhere else: {id, name, blurb, players, devices, url}. `players` is what the
 * game itself allows. Empty since Who Am I? is hosted (games.js); the kind stays for the next one.
 */
export const OUTSIDE = [];

const COMING_SOON = [
  { id: "tin-derby", name: "Tin Derby", blurb: "Wind up your tin racer and go", players: { min: 2, max: 4 }, devices: { phone: true, desktop: false, sharedScreen: "required" } },
  { id: "flood", name: "Flood", blurb: "Climb before the water rises", players: { min: 1, max: 4 }, devices: { phone: true, desktop: false } },
  { id: "fox-trouble", name: "Fox Trouble", blurb: "Solve the room together, cause trouble", players: { min: 2, max: 4 }, devices: { phone: true, desktop: false } },
];

/**
 * The wall for a list of hosted games: {boxes, games, fields}. `games` holds the server definition
 * of every box that starts inside the room; a box with a `url` needs none. `fields` holds the
 * settings of each such game whose manifest has them (`manifest.settings`).
 * @param {object[]} hosted  the site's games (games.js)
 * @param {{testGames?: boolean}} [opts]  testGames: also hang Coin Flip, the placeholder
 */
export function buildWall(hosted, { testGames = false } = {}) {
  const boxes = [];
  const games = new Map();
  // Each game's settings as its manifest describes them, for the step after the vote.
  const fields = new Map();
  for (const { manifest, game } of hosted) {
    if (manifest.lobby?.view) {
      // It opens inside the room: the room runs `game`, and the page mounts the view from the game's own files.
      boxes.push(boxFromManifest(manifest, { view: manifest.path + manifest.lobby.view }));
      games.set(manifest.id, game);
      if (manifest.settings) fields.set(manifest.id, manifest.settings);
    } else {
      // No view the room can mount yet: it plays on its own page.
      boxes.push(boxFromManifest(manifest, { url: manifest.path }));
    }
  }
  if (testGames) {
    boxes.push(boxFromManifest(coinFlip.manifest, { test: true }));
    games.set(coinFlip.manifest.id, coinFlip.game);
  }
  for (const manifest of OUTSIDE) boxes.push(boxFromManifest(manifest));
  for (const manifest of COMING_SOON) boxes.push(boxFromManifest(manifest, { soon: true }));
  return { boxes, games, fields };
}

/** Production: the hosted games, the outside games and the coming-soon boxes. */
export const WALL = buildWall(GAMES);
/** Local play and the tests: the same, with Coin Flip. */
export const TEST_WALL = buildWall(GAMES, { testGames: true });

/** The wall a Worker's environment asks for. One switch, PARTY_TEST_GAMES, set in wrangler.jsonc. */
export function wallFor(env) {
  return env?.PARTY_TEST_GAMES === "on" ? TEST_WALL : WALL;
}
