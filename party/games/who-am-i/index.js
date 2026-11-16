// Who Am I? at the Table: the server side, ready for games.js (TURN_GAMES) once its view exists.
// Not on the Table's list yet: it stays "coming soon" (lobby/wall.js, TABLE_SOON) until the page
// lane adds party/public/games/who-am-i.js and imports this module in games.js.
//
// Server only: nothing in party/games is ever copied to the site (scripts/build-public.mjs).
import * as rules from "./rules.js";
import { tableGame } from "../table-game.js";

export const { TIMERS, DEFAULT_OPTIONS, CHOICES } = rules;

export const game = tableGame(rules);

export const manifest = {
  id: rules.GAME_ID,
  name: "Who Am I?",
  pitch: "Ask questions, guess who you are",
  path: "/party/",
  // The owner's decision: a party of exactly two starts it. The rules also take a larger table
  // (two play, the host picks them, the rest watch with no names shown); raising `max` to 8 here
  // is all it takes to offer that (README, "Who plays").
  players: { min: 2, max: 2 },
  devices: { phone: true, desktop: false, upright: true },
  public: [],
  table: { view: "games/who-am-i.js" },
};
