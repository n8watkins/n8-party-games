// What is behind each of the front page's doors, worked out from the wall (the build's copy of
// lobby/wall.js, /home-wall.js), the one-device games and the page's own words (home-data.js).
// Plain data in, plain data out, so the page and its test (site/test/home.test.js) share it.
//
// A game's `status` says what the page offers for it:
//   room      it opens inside the party room when the party votes for it (a lamp on the wall)
//   table     the host picks it at the Table: start a party at the Table
//   own-site  a Table game not at the Table yet that plays today on a site of its own: a link there (`href`)
//   page      a one-device game: it plays on a page of this site (`href`)
//   soon      not built yet: named, greyed, nothing to press
import { COPY, KINDS, ONE_DEVICE } from "./home-data.js";

/** "2 players", "1 to 4 players". */
export const playersText = ({ min, max }) => (min === max ? `${min} ${min === 1 ? "player" : "players"}` : `${min} to ${max} players`);

/** Whether a status can be played today, one way or another. */
export const isLive = (status) => status !== "soon";

/** A game as the page shows it: the wall's facts with the page's words and pictures. */
function game(kind, { id, name, line, min, max }, status, href = null) {
  const copy = COPY[id] ?? {};
  // The room's wall says each game's line in the room's own words; the doors with cards use the page's.
  return { id, kind, name, line: kind === "room" ? line : (copy.line ?? line), min, max, status, href, tile: copy.tile ?? null, focus: copy.focus ?? "50% 50%", wide: copy.wide ?? null, piece: copy.piece ?? null, about: copy.about ?? line, steps: copy.steps ?? [], suits: copy.suits ?? "" };
}

/**
 * The page's model: {kinds, room, table, device}. `room` is the Floor's wall in its order;
 * `table` the Table's list; `device` the one-device games. Each is a list of games (see above).
 * @param {{FLOOR: object[], TABLE: object[]}} wall  the build's copy of the wall
 */
export function homeModel({ FLOOR, TABLE }) {
  // Every game on the Floor's wall plays inside the room, or is coming soon.
  const room = FLOOR.map((box) => game("room", box, box.inRoom && !box.soon ? "room" : "soon"));
  const table = TABLE.map((entry) => {
    if (!entry.soon) return game("table", entry, "table");
    // Not at the Table yet, but played today on a site of its own (home-data.js, `ownSite`): Who Am I?.
    const ownSite = COPY[entry.id]?.ownSite;
    if (ownSite) return game("table", entry, "own-site", ownSite);
    return game("table", entry, "soon");
  });
  const device = ONE_DEVICE.map((g) => game("device", g, "page", g.path));
  return { kinds: KINDS, room, table, device };
}

/** The games behind one door. */
export const gamesOf = (model, kind) => model[kind] ?? [];

/** Whether any game at the Table can be picked there today. */
export const tablePlays = (model) => model.table.some((g) => g.status === "table");

/** The status of a game that plays behind a door itself: in the room, at the Table, on this device. */
const HERE = { room: "room", table: "table", device: "page" };

/**
 * What a door's peek says about its games: `here` play behind that door today ("Now"),
 * `elsewhere` play today but somewhere else (Who Am I? on its own site, not in the room and not
 * at the Table), and `soon` are not built yet.
 */
export function peekOf(kind, games) {
  const here = games.filter((g) => g.status === HERE[kind]);
  const elsewhere = games.filter((g) => isLive(g.status) && g.status !== HERE[kind]);
  const soon = games.filter((g) => !isLive(g.status));
  return { here, elsewhere, soon };
}

/**
 * The Table door's way to start: when a game can be picked at the Table, starting a party there
 * is the main button; when none can, the note saying so leads, and the start is a plain button.
 * Flips by itself the day the wall gains a Table game.
 * @returns {{lead: "start" | "note", note: string}}
 */
export function tableStart(model) {
  const ownSite = model.table.filter((g) => g.status === "own-site").map((g) => g.name);
  const soon = model.table.filter((g) => g.status === "soon").map((g) => g.name);
  const plays = tablePlays(model);
  const lines = [];
  if (plays) lines.push("The host picks a game at the Table, and everyone plays it together. Friends join with the code.");
  else lines.push(`No game plays at the Table yet${soon.length ? `: ${soon.join(" and ")} ${soon.length > 1 ? "are" : "is"} on the way` : ""}.`);
  if (ownSite.length) lines.push(`${ownSite.join(" and ")} ${ownSite.length > 1 ? "play" : "plays"} today on ${ownSite.length > 1 ? "their own sites" : "its own site"}.`);
  return { lead: plays ? "start" : "note", note: lines.join(" ") };
}
