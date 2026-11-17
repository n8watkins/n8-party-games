// Paper Masks at the Table: everyone answers a prompt in secret, the answers are read out as
// masked cards, the table guesses who wrote which, then the masks come off.
// The rules are rules.js (README.md); at-table.js adds the waiting step with the host's choices
// and the final curtain; the view is party/public/games/paper-masks.js.
//
// Server only: nothing in party/games is ever copied to the site (scripts/build-public.mjs), so the
// deck and its ghost answers (questions.js) stay here.
import * as rules from "./at-table.js";
import { tableGame } from "../table-game.js";

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
  // In this repository, not a package: its view is one of the party's own pages
  // (party/public/games/paper-masks.js), so it lists no public files.
  public: [],
  table: { view: "games/paper-masks.js" },
};
