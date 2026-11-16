// The games this site hosts. Each is its own repository and package that keeps the game
// contract (party-kit/GAME-CONTRACT.md): it exports `game` (the server definition) and
// `manifest` (id, name, path, players, devices, public files).
//
// To host another game: add it to devDependencies (a git dependency pinned to a tag or a
// commit), import it here, and add it to the list. The build and the Worker read this list.
// The order is the wall's order. Cork & Bell stays first: the rooms its own page makes
// (worker.js, PartyRoom) are the first game's.
import * as corkAndBell from "cork-and-bell";
import * as whoAmI from "who-am-i";

export const GAMES = [corkAndBell, whoAmI];
