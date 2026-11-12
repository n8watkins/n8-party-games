// The games this site hosts. Each is its own repository and package that keeps the game
// contract (party-kit/GAME-CONTRACT.md): it exports `game` (the server definition) and
// `manifest` (id, name, path, players, devices, public files).
//
// To host another game: add it to devDependencies (a git dependency pinned to a tag or a
// commit), import it here, and add it to the list. The build and the Worker read this list.
import * as corkAndBell from "cork-and-bell";

export const GAMES = [corkAndBell];
