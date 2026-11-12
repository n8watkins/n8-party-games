// The pure part of the score board, so it can be tested without the Workers runtime.
//
// A board is a short list of {name, score, at}, best first. Names are three capital letters, as
// on an arcade cabinet: nobody signs in, nothing personal is stored, and three letters leave
// little room for mischief. Scores come from the browser and cannot be trusted; the board only
// makes cheating pointless to automate: a cap on the score, a cap on the list, and (in the
// Worker) a limit on how often one connection may post.

/** How many scores a board keeps. */
export const BOARD_SIZE = 10;
/** The largest body a score needs: {"name":"ABC","score":123456}. */
export const MAX_SCORE_BODY_BYTES = 128;

/** Three-letter words nobody should have to read on a fairground stall. */
const BLOCKED = new Set([
  "ASS", "FUK", "FUC", "FCK", "FUX", "FKU", "FUQ", "FAG", "FGT", "CUM", "SEX", "TIT", "NIG", "NGR", "NGA", "KKK", "COK", "COC", "DIK", "DIC", "DCK",
  "PIS", "SHT", "SHI", "CNT", "CUN", "JIZ", "NAZ", "SUK", "SUC", "VAG", "KYS", "WTF", "STF", "HOE", "HOR", "JEW", "GOK", "WOP", "KIK", "KYK", "PED",
  "RAP", "TWT", "WNK", "BCH", "BJS", "ARS", "AZZ", "FAP", "POO", "PEE", "PUS", "XXX",
]);

/** Three capital letters, or null when the text is not three letters or spells something on the list. */
export function cleanInitials(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(name)) return null;
  return BLOCKED.has(name) ? null : name;
}

/** A whole number above nothing and no higher than a round of the game can reach. */
export function validScore(score, max) {
  return Number.isInteger(score) && score > 0 && score <= max;
}

/** The board as stored may be anything (an older shape, nothing at all): only well-formed rows survive. */
export function cleanBoard(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && cleanInitials(r.name) === r.name && Number.isInteger(r.score) && r.score > 0)
    .map((r) => ({ name: r.name, score: r.score, at: Number.isFinite(r.at) ? r.at : 0 }))
    .slice(0, BOARD_SIZE);
}

/**
 * The board after one more score. `place` is where it landed (0 is the top), or -1 when it did
 * not make the board. Equal scores keep their order: the earlier one stays above.
 */
export function addScore(rows, entry, size = BOARD_SIZE) {
  const board = cleanBoard(rows);
  let place = board.findIndex((r) => entry.score > r.score);
  if (place < 0) place = board.length;
  if (place >= size) return { rows: board, place: -1 };
  board.splice(place, 0, { name: entry.name, score: entry.score, at: entry.at });
  return { rows: board.slice(0, size), place };
}
