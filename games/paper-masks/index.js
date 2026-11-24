// Paper Masks at the Table: everyone answers a prompt in secret, the answers are read out as
// masked cards, the table guesses who wrote which, then the masks come off.
// The rules are rules.js (README.md); at-table.js adds the waiting step with the host's choices
// and the final curtain; the view is public/paper-masks.js.
//
// Server only but for public/: the build copies only the files the manifest lists (the view, its
// stylesheet, its pictures and fonts), and refuses anything else in this folder
// (scripts/build-public.mjs, SERVER_ONLY), so the deck and its ghost answers (questions.js) stay here.
import { tableGame } from "n8-party-games/table";
import * as rules from "./at-table.js";

export const game = tableGame(rules);

export const manifest = {
  id: rules.GAME_ID,
  name: "Paper Masks",
  pitch: "Anonymous answers about you. Guess who wrote what.",
  path: "/party/",
  players: { min: rules.MIN_PLAYERS, max: rules.MAX_PLAYERS },
  devices: { phone: true, desktop: true, upright: true },
  // The owner's painting of the masks on the table, as the door on the Table's list.
  art: "/party/games/paper-masks/art/door-480.webp",
  // The view and what it loads, copied under `path` (/party/) by the site's build: served at
  // /party/games/paper-masks.js, .css and /party/games/paper-masks/ beside the Table's own pages.
  public: [
    { from: "public/paper-masks.js", to: "games/paper-masks.js" },
    { from: "public/paper-masks.css", to: "games/paper-masks.css" },
    { from: "public/paper-masks", to: "games/paper-masks" },
  ],
  table: { view: "games/paper-masks.js" },
};
