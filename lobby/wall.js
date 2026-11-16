// The wall of the party room: which game boxes hang on it, in order, and which of them can start.
//
// A box is drawn from a game's manifest (name, blurb, players, devices). There are four kinds:
//   hosted       a real game the site hosts (games.js), played inside the room: started with the
//                party's seats, shown by the view its manifest names (`lobby.view`), ended with
//                places. Cork & Bell is the first. A hosted game with no such view yet hangs as
//                an outside game whose address is its own page on this site.
//   outside      a game that is not on the kit and plays on a site of its own, with rooms of its
//                own. It has a `url` instead of a server definition: when it wins the vote every
//                page goes there. Who Am I? is one.
//   test         Coin Flip, a placeholder that plays through the whole seam. It hangs only where
//                PARTY_TEST_GAMES is "on" (the local environment and the test runs), never in
//                production.
//   coming soon  a name and a picture for a game that is not built. Its light stays off.
//
// The Table (the plain waiting room) has a list instead of a wall: buildTurnWall.
import { GAMES, TURN_GAMES } from "../games.js";
import * as coinFlip from "./games/coin-flip.js";
import * as countToTen from "../party/games/count-to-ten/index.js";
import { isTurnBased } from "../party-kit/src/core/turns.js";
import { boxFromManifest } from "./shared/vote.js";
import { tableEntry } from "./shared/table.js";


/**
 * Games that play somewhere else. `players` is what the game itself allows: Who Am I? is for
 * exactly two (MAX_PLAYERS in its engine, and it needs both to start).
 */
export const OUTSIDE = [
  { id: "who-am-i", name: "Who Am I?", blurb: "Ask questions, guess your name", players: { min: 2, max: 2 }, devices: { phone: true, desktop: false }, url: "https://whoami.n8builds.dev/" },
];

/** A hosted game with the same id takes its coming-soon box's place on the wall (Tin Derby's), so the wall keeps its order. */
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
  // A hosted game that was coming soon hangs where its coming-soon box hung.
  const inPlace = new Map();
  const hang = (manifest, box) => (COMING_SOON.some((m) => m.id === manifest.id) ? inPlace.set(manifest.id, box) : boxes.push(box));
  for (const { manifest, game } of hosted) {
    if (manifest.lobby?.view) {
      // It opens inside the room: the room runs `game`, and the page mounts the view from the game's own files.
      hang(manifest, boxFromManifest(manifest, { view: manifest.path + manifest.lobby.view }));
      games.set(manifest.id, game);
      if (manifest.settings) fields.set(manifest.id, manifest.settings);
    } else {
      // No view the room can mount yet: it plays on its own page.
      hang(manifest, boxFromManifest(manifest, { url: manifest.path }));
    }
  }
  if (testGames) {
    boxes.push(boxFromManifest(coinFlip.manifest, { test: true }));
    games.set(coinFlip.manifest.id, coinFlip.game);
  }
  for (const manifest of OUTSIDE) boxes.push(boxFromManifest(manifest));
  for (const manifest of COMING_SOON) boxes.push(inPlace.get(manifest.id) ?? boxFromManifest(manifest, { soon: true }));
  return { boxes, games, fields };
}

/**
 * The Table's games that are not built yet: listed, greyed, "Coming soon". Their sizes are the
 * owner's: Paper Masks for three to eight, Who Am I? for exactly two.
 */
export const TABLE_SOON = [
  { id: "paper-masks", name: "Paper Masks", pitch: "Anonymous answers about you. Guess who wrote what.", players: { min: 3, max: 8 } },
  { id: "who-am-i", name: "Who Am I?", pitch: "Ask questions, guess who you are", players: { min: 2, max: 2 } },
];

/**
 * The Table's list (lobby/shared/table.js) and the server definition of each game on it that can
 * start: {table, games}. Every Table game is turn-based (`tickHz: 0`), has a view the Table can
 * mount and no settings step (the Table has no settings form yet); a game that is not is refused
 * here, when the Worker loads, not when a party picks it.
 *
 * Count to ten, the test game, is on the list only where PARTY_TEST_GAMES is "on", as Coin Flip
 * is on the Floor: in production the room has no such game, so a hand-sent `play` for it is
 * refused. Where it is on, it is marked `test` and the Table's page shows it only when its
 * address ends in #dev.
 * @param {object[]} hosted  the site's Table games (games.js, TURN_GAMES)
 * @param {{testGames?: boolean}} [opts]  testGames: also list Count to ten
 */
export function buildTurnWall(hosted, { testGames = false } = {}) {
  const table = [];
  const games = new Map();
  const add = (game, manifest, extra) => {
    const why = !game ? "it has no server definition" : !isTurnBased(game) ? "it is not turn-based (tickHz: 0)" : typeof game.settings === "function" || manifest.settings ? "the Table has no settings step yet" : !extra.view ? "it has no view for the Table (manifest.table.view)" : null;
    if (why) throw new Error(`${manifest.id} cannot hang at the Table: ${why}`);
    table.push(tableEntry(manifest, extra));
    games.set(manifest.id, game);
  };
  const viewOf = (manifest) => (manifest.table?.view ? manifest.path + manifest.table.view : null);
  for (const { manifest, game } of hosted) add(game, manifest, { view: viewOf(manifest) });
  if (testGames) add(countToTen.game, countToTen.manifest, { test: true, view: viewOf(countToTen.manifest) });
  for (const manifest of TABLE_SOON) if (!games.has(manifest.id)) table.push(tableEntry(manifest, { soon: true }));
  return { table, games };
}

/** The Floor's wall and the Table's list in one: the games map holds both (their ids never clash). */
function bothWalls(floor, turn) {
  for (const id of turn.games.keys()) if (floor.games.has(id)) throw new Error(`${id} is on both the Floor and the Table`);
  return { ...floor, games: new Map([...floor.games, ...turn.games]), table: turn.table };
}

/** Production: the hosted games, the outside games and the coming-soon boxes, and the Table's list. */
export const WALL = bothWalls(buildWall(GAMES), buildTurnWall(TURN_GAMES));
/** Local play and the tests: the same, with Coin Flip on the Floor and Count to ten at the Table. */
export const TEST_WALL = bothWalls(buildWall(GAMES, { testGames: true }), buildTurnWall(TURN_GAMES, { testGames: true }));

/** The wall a Worker's environment asks for. One switch, PARTY_TEST_GAMES, set in wrangler.jsonc. */
export function wallFor(env) {
  return env?.PARTY_TEST_GAMES === "on" ? TEST_WALL : WALL;
}
