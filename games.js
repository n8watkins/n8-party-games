// The games this site hosts. Each is its own repository and package that keeps the game
// contract (party-kit/GAME-CONTRACT.md): it exports `game` (the server definition) and
// `manifest` (id, name, path, players, devices, public files).
//
// To host another game: add it to devDependencies (a git dependency pinned to a tag or a
// commit), import it here, and add it to the list. The build and the Worker read this list.
import * as corkAndBell from "cork-and-bell";
import * as paperMasks from "./party/games/paper-masks/index.js";

export const GAMES = [corkAndBell];

// The games played at the Table (the party's plain waiting room, /party/): turn-based games
// (`tickHz: 0`) that keep the same contract, plus `manifest.table.view`, the module under the
// game's public path that shows it at the Table. lobby/wall.js (buildTurnWall) hangs them on the
// Table's list with the coming-soon entries. A Table game may be a package, or live in this
// repository (party/games/<id>/index.js, with its view in party/public/games and `public: []`,
// as Paper Masks does): import its index.js here either way. Who Am I? comes in its own pull request.
export const TURN_GAMES = [paperMasks];
