// The pure part of the score board, so it can be tested without the Workers runtime.
//
// A board is a short list of {name, score, at}, best first. Names are three capital letters, as
// on an arcade cabinet: nobody signs in, nothing personal is stored, and three letters leave
// little room for mischief.
//
// A score that comes from the browser cannot be trusted. So a game that can play a run again
// (its `scoreRun`) never sends one: the page sends the run itself (its seed and what its player
// did), the Worker plays it again with the game's own code, and the board chalks up that score,
// never one the page claims. That proves the run keeps to the game's rules; it cannot prove a
// person played it (a script can play one too). The board keeps each row's seed (never shown),
// so the same run sent twice is turned away. A game without `scoreRun` posts a bare score, and
// the board can only make cheating pointless to automate: a cap on the score, a cap on the list,
// and (in the Worker) a limit on how often one connection may post.

/** How many scores a board keeps. */
export const BOARD_SIZE = 10;
/** The largest body a bare score needs: {"name":"ABC","score":123456}. */
export const MAX_SCORE_BODY_BYTES = 128;
/** The largest body a run may be: its letters, its seed and what its player did (Cork & Bell's: at most 189 corks, about 11 KB). */
export const MAX_RUN_BODY_BYTES = 16384;

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

/** Whether a value is a run's seed as a board keeps it: a whole number, 0 to 2^32 - 1. */
export function isSeed(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

/**
 * The board as stored may be anything (an older shape, nothing at all): only well-formed rows
 * survive. A row is {name, score, at}, and {name, score, at, seed} where it came from a run the
 * board played again (rows stored before seeds were kept have none, and keep working).
 */
export function cleanBoard(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && cleanInitials(r.name) === r.name && Number.isInteger(r.score) && r.score > 0)
    .map((r) => ({ name: r.name, score: r.score, at: Number.isFinite(r.at) ? r.at : 0, ...(isSeed(r.seed) && { seed: r.seed }) }))
    .slice(0, BOARD_SIZE);
}

/** The board as anyone may read it: {name, score, at} per row. A row's seed stays with the board. */
export function shownBoard(rows) {
  return cleanBoard(rows).map(({ name, score, at }) => ({ name, score, at }));
}

/**
 * The board after one more score: {name, score, at} and, for a run the board played again, its
 * `seed`. `place` is where it landed (0 is the top), or -1 when it did not make the board. Equal
 * scores keep their order: the earlier one stays above. A seed already on the board is the same
 * run sent again: it is turned away (`replayed: true`, place -1) and the board is left as it was.
 */
export function addScore(rows, entry, size = BOARD_SIZE) {
  const board = cleanBoard(rows);
  const seeded = isSeed(entry.seed);
  if (seeded && board.some((r) => r.seed === entry.seed)) return { rows: board, place: -1, replayed: true };
  let place = board.findIndex((r) => entry.score > r.score);
  if (place < 0) place = board.length;
  if (place >= size) return { rows: board, place: -1 };
  board.splice(place, 0, { name: entry.name, score: entry.score, at: entry.at, ...(seeded && { seed: entry.seed }) });
  return { rows: board.slice(0, size), place };
}
