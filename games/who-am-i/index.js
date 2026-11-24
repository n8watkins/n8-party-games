// Who Am I? at the Table: the server side, on the Table's list through games.js (TURN_GAMES),
// in place of its "coming soon" entry (lobby/wall.js, TABLE_SOON). Its view is
// public/who-am-i.js. It is a Table game only: the Floor and the Table are separate.
//
// Server only but for public/: the build copies only the files the manifest lists (the view, its
// stylesheet, its door and fonts), and refuses anything else in this folder
// (scripts/build-public.mjs, SERVER_ONLY), so the names and their hints (deck-data.js) stay here.
import { tableGame } from "n8-party-games/table";
import * as rules from "./rules.js";

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
  // The live game's own mark (its question mark on a purple tile), as the door on the Table's list.
  art: "/party/games/who-am-i/door.svg",
  // The view and what it loads, copied under `path` (/party/) by the site's build: served at
  // /party/games/who-am-i.js, .css and /party/games/who-am-i/ beside the Table's own pages.
  public: [
    { from: "public/who-am-i.js", to: "games/who-am-i.js" },
    { from: "public/who-am-i.css", to: "games/who-am-i.css" },
    { from: "public/who-am-i", to: "games/who-am-i" },
  ],
  table: { view: "games/who-am-i.js" },
};
