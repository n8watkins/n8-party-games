// Who Am I? at the Table: the server side, on the Table's list through games.js (TURN_GAMES),
// in place of its "coming soon" entry (lobby/wall.js, TABLE_SOON). Its view is
// party/public/games/who-am-i.js. It is a Table game only: the Floor and the Table are separate.
//
// Server only: nothing in party/games is ever copied to the site (scripts/build-public.mjs).
import * as rules from "./rules.js";
import { tableGame } from "../table-game.js";

export const { TIMERS, DEFAULT_OPTIONS, CHOICES } = rules;

export const game = tableGame(rules);

export const manifest = {
  id: rules.GAME_ID,
  name: "Who Am I?",
  // The game's own version, in the release record (scripts/release.mjs). It lives in this
  // repository, so release-kit does not move it: bump it in the pull request that changes the
  // game (a feat a minor, a fix a patch; DEPLOY.md, "Releases").
  version: "0.2.0",
  pitch: "Ask questions, guess who you are",
  path: "/party/",
  // The owner's decision: a party of exactly two starts it. The rules also take a larger table
  // (two play, the host picks them, the rest watch with no names shown); raising `max` to 8 here
  // is all it takes to offer that (README, "Who plays").
  players: { min: 2, max: 2 },
  devices: { phone: true, desktop: false, upright: true },
  // The live game's own mark (its question mark on a purple tile), as the door on the Table's list.
  art: "/party/games/who-am-i/door.svg",
  public: [],
  table: { view: "games/who-am-i.js" },
};
