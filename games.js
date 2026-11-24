// The games this site hosts. Each is a package that keeps the game contract
// (party-kit/GAME-CONTRACT.md): it exports `game` (the server definition) and `manifest` (id,
// name, path, players, devices, public files). Cork & Bell is its own repository, a git
// dependency; the rest are folders of this repository (games/<id>, npm workspaces).
//
// To host another game: give it a folder of its own under games/ (a package by its own name,
// declared in the root package.json's devDependencies as "file:games/<id>"), or add it to
// devDependencies as a git dependency pinned to a tag or a commit; import it here by its package
// name, and add it to the list. The build and the Worker read this list.
import * as corkAndBell from "cork-and-bell";
// Tin Derby, Paper Masks and Who Am I? are folders of this repository (games/<id>), workspace packages.
import * as paperMasks from "paper-masks";
import * as tinDerby from "tin-derby";
import * as whoAmI from "who-am-i";

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
// Table's list with the coming-soon entries. A Table game is a package (Paper Masks and Who Am I?:
// games/<id>, the view in its own public/ folder, listed in its manifest's `public` and served
// under /party/), or lives in this repository without one (party/games/<id>/index.js, with its
// view in party/public/games and `public: []`, as the test game Count to ten does): import it here
// either way. Everything in a Table game's package but its public files is server only
// (scripts/build-public.mjs).
export const TURN_GAMES = [paperMasks, whoAmI];
