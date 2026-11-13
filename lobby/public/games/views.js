// The views that live in this repository, by game id: the test game's. A game from its own
// repository brings its view with it: its manifest names the module (`lobby.view`), its box on
// the wall carries the address, and the room's page imports it from there (main.js, viewModule).
// Either way it is mount(container, ctx) returning {events, snapshot, unmount}: see
// party-kit/GAME-CONTRACT.md, "In the browser".
import { mount as coinFlip } from "./coin-flip-view.js";

export const GAME_VIEWS = { "coin-flip": coinFlip };
