// The games this site hosts. Each is its own repository and package that keeps the game
// contract (party-kit/GAME-CONTRACT.md): it exports `game` (the server definition) and
// `manifest` (id, name, path, players, devices, public files).
//
// To host another game: add it to devDependencies (a git dependency pinned to a tag or a
// commit), import it here, and add it to the list. The build and the Worker read this list.
import * as corkAndBell from "cork-and-bell";

export const GAMES = [corkAndBell];

// The games played at the Table (the party's plain waiting room, /party/): turn-based games
// (`tickHz: 0`) that keep the same contract, plus `manifest.table.view`, the module under the
// game's public path that shows it at the Table. lobby/wall.js (buildTurnWall) hangs them on the
// Table's list with the coming-soon entries. None is hosted yet: Who Am I? and Paper Masks come
// in their own pull requests.
export const TURN_GAMES = [];
