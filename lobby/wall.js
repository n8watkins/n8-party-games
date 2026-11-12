// The wall of the party room: which game boxes hang on it, in order, and which of them can start.
//
// A box is drawn from a game's manifest (name, blurb, players, devices). There are three kinds:
//   hosted       a real game the site hosts (games.js). Cork & Bell is the only one today, and it
//                does not open inside the room yet: winning the vote shows a card that says so
//                and links to its own page. Hosting it through the seam is the next job.
//   test         Coin Flip, a placeholder that plays through the whole seam.
//   coming soon  a name and a picture for a game that is not built. Its light stays off.
import { GAMES } from "../games.js";
import * as coinFlip from "./games/coin-flip.js";
import { boxFromManifest } from "./shared/vote.js";

/** What the site says about a hosted game until its own manifest carries a `blurb`. */
const BLURBS = { "cork-and-bell": "Pop the targets, ring the bell" };

const COMING_SOON = [
  { id: "who-am-i", name: "Who Am I?", blurb: "Ask questions, guess your name", players: { min: 2, max: 4 }, devices: { phone: true, desktop: false } },
  { id: "tin-derby", name: "Tin Derby", blurb: "Wind up your tin racer and go", players: { min: 2, max: 4 }, devices: { phone: true, desktop: false, sharedScreen: "required" } },
  { id: "flood", name: "Flood", blurb: "Climb before the water rises", players: { min: 2, max: 4 }, devices: { phone: true, desktop: false } },
];

/**
 * Stands in for a hosted game that cannot open inside the room yet: it is over the moment it
 * starts, awards nothing, and leaves a note for the card everyone sees on the way back.
 */
export function standIn(manifest) {
  return {
    id: manifest.id,
    minSeats: manifest.players.min,
    maxSeats: manifest.players.max,
    create: () => ({}),
    input() {},
    tick: () => [],
    snapshot: () => ({}),
    isOver: () => true,
    result: () => null,
    standings: () => [],
    note: { kind: "stand-in", path: manifest.path },
  };
}

/** The wall for a list of hosted games: {boxes, games}. */
export function buildWall(hosted) {
  const boxes = [];
  const games = new Map();
  for (const { manifest } of hosted) {
    boxes.push(boxFromManifest(manifest, { blurb: BLURBS[manifest.id] }));
    games.set(manifest.id, standIn(manifest));
  }
  boxes.push(boxFromManifest(coinFlip.manifest, { test: true }));
  games.set(coinFlip.manifest.id, coinFlip.game);
  for (const manifest of COMING_SOON) boxes.push(boxFromManifest(manifest, { soon: true }));
  return { boxes, games };
}

export const WALL = buildWall(GAMES);
