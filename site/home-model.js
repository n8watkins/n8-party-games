// What is behind each of the front page's doors, worked out from the wall (the build's copy of
// lobby/wall.js, /home-wall.js), the one-device games and the page's own words (home-data.js).
// Plain data in, plain data out, so the page and its test (site/test/home.test.js) share it.
//
// A game's `status` says what the page offers for it:
//   room      it opens inside the party room when the party votes for it (a lamp on the wall)
//   table     the host picks it at the Table: start a party at the Table
//   own-site  it plays today on a site of its own: a link there (`href`)
//   page      it plays on a page of this site (`href`)
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
  const outside = new Map(FLOOR.filter((box) => box.url && /^https:\/\//.test(box.url) && !box.soon).map((box) => [box.id, box.url]));
  const room = FLOOR.map((box) => {
    if (box.soon) return game("room", box, "soon");
    if (box.inRoom) return game("room", box, "room");
    if (outside.has(box.id)) return game("room", box, "own-site", box.url);
    // A hosted game the room cannot show yet plays on its own page of this site.
    return game("room", box, box.url ? "page" : "soon", box.url);
  });
  const table = TABLE.map((entry) => {
    if (!entry.soon) return game("table", entry, "table");
    // Not at the Table yet, but played today somewhere else: Who Am I? on its own site.
    if (outside.has(entry.id)) return game("table", entry, "own-site", outside.get(entry.id));
    return game("table", entry, "soon");
  });
  const device = ONE_DEVICE.map((g) => game("device", g, "page", g.path));
  return { kinds: KINDS, room, table, device };
}

/** The games behind one door. */
export const gamesOf = (model, kind) => model[kind] ?? [];

/** Whether any game at the Table can be picked there today. */
export const tablePlays = (model) => model.table.some((g) => g.status === "table");
