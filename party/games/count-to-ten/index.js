// Count to ten: the Table's test game, and nothing more. It proves the path a real Table game
// takes, end to end, through the same adapter (../table-game.js): the host picks it, the party
// plays it in turns on their own phones, and everyone is back at the Table with the result.
// Its pure rules are rules.js; its view is party/public/games/count-to-ten.js.
//
// Server only: nothing in party/games is ever copied to the site (scripts/build-public.mjs).
import * as rules from "./rules.js";
import { tableGame } from "../table-game.js";

export const { TARGET, TURN_MS } = rules;

export const game = tableGame(rules);

export const manifest = {
  id: rules.GAME_ID,
  name: "Count to ten",
  pitch: "Test game: add one or two in turns, whoever says ten wins",
  path: "/party/",
  players: { min: rules.MIN_PLAYERS, max: rules.MAX_PLAYERS },
  devices: { phone: true, desktop: true, upright: true },
  public: [],
};

/** Where its view is on this site (party/public/games/count-to-ten.js). */
export const VIEW = "/party/games/count-to-ten.js";
