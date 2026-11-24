// The games this site hosts. Each is its own repository and package that keeps the game
// contract (party-kit/GAME-CONTRACT.md): it exports `game` (the server definition) and
// `manifest` (id, name, path, players, devices, public files).
//
// To host another game: add it to devDependencies (a git dependency pinned to a tag or a
// commit), or give it a folder of its own under games/ (each one is an npm workspace of this
// repository, a package by its own name), import it here by its package name, and add it to the
// list. The build and the Worker read this list.
import * as corkAndBell from "cork-and-bell";
// Tin Derby is a folder of this repository (games/tin-derby), a workspace package.
import * as tinDerby from "tin-derby";
import * as paperMasks from "./party/games/paper-masks/index.js";
import * as whoAmI from "./party/games/who-am-i/index.js";

export const GAMES = [corkAndBell, tinDerby];

/**
 * The high score boards (worker.js): each game whose manifest has `scores`, with the most a round
 * can score and the game's `scoreRun` where it exports one. A board with `scoreRun` chalks up only
 * the score of the run a page sends, played again by the game's own code, never a score a page
 * sends, and each run once (party-kit/src/worker/score-logic.js). Cork & Bell's has one.
 */
export const SCORE_BOARDS = Object.fromEntries(
  GAMES.filter(({ manifest }) => manifest.scores).map((g) => [g.manifest.id, { max: g.manifest.scores.max, ...(typeof g.scoreRun === "function" && { scoreRun: g.scoreRun }) }]),
);

// The games played at the Table (the party's plain waiting room, /party/): turn-based games
// (`tickHz: 0`) that keep the same contract, plus `manifest.table.view`, the module under the
// game's public path that shows it at the Table. lobby/wall.js (buildTurnWall) hangs them on the
// Table's list with the coming-soon entries. A Table game may be a package, or live in this
// repository (party/games/<id>/index.js, with its view in party/public/games and `public: []`,
// as Paper Masks and Who Am I? do): import its index.js here either way.
export const TURN_GAMES = [paperMasks, whoAmI];
