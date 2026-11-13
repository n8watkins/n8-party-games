// The games the room page can show, by id. A game that opens inside the room adds its view here
// (see party-kit/GAME-CONTRACT.md, "The lobby hooks"): mount(container, ctx) returns
// {events, snapshot, unmount}.
import { mount as coinFlip } from "./coin-flip-view.js";

export const GAME_VIEWS = { "coin-flip": coinFlip };
