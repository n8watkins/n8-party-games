// The games this site hosts. Each is its own repository and package that keeps the game
// contract (party-kit/GAME-CONTRACT.md): it exports `game` (the server definition) and
// `manifest` (id, name, path, players, devices, public files).
//
// To host another game: add it to devDependencies (a git dependency pinned to a tag or a
// commit), import it here, and add it to the list. The build and the Worker read this list.
import * as corkAndBell from "cork-and-bell";
// Tin Derby is still a folder of this repository (floor/games/tin-derby), installed as a package by a file: dependency until it moves to its own.
import * as tinDerby from "tin-derby";
import * as paperMasks from "./party/games/paper-masks/index.js";

export const GAMES = [corkAndBell, tinDerby];

/**
 * The high score boards (worker.js): each game whose manifest has `scores`, with the most a round
 * can score and the game's `scoreRun` where it exports one. A board with `scoreRun` chalks up only
 * runs it handed out a seed for, played again by the game's own code, never a score a page sends
 * (party-kit/src/worker/score-logic.js). Cork & Bell's has one.
 */
export const SCORE_BOARDS = Object.fromEntries(
  GAMES.filter(({ manifest }) => manifest.scores).map((g) => [g.manifest.id, { max: g.manifest.scores.max, ...(typeof g.scoreRun === "function" && { scoreRun: g.scoreRun }) }]),
);

// The games played at the Table (the party's plain waiting room, /party/): turn-based games
// (`tickHz: 0`) that keep the same contract, plus `manifest.table.view`, the module under the
// game's public path that shows it at the Table. lobby/wall.js (buildTurnWall) hangs them on the
// Table's list with the coming-soon entries. A Table game may be a package, or live in this
// repository (party/games/<id>/index.js, with its view in party/public/games and `public: []`,
// as Paper Masks does): import its index.js here either way. Who Am I? comes in its own pull request.
export const TURN_GAMES = [paperMasks];
