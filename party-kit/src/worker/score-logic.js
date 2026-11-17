// The pure part of the score board, so it can be tested without the Workers runtime.
//
// A board is a short list of {name, score, at}, best first. Names are three capital letters, as
// on an arcade cabinet: nobody signs in, nothing personal is stored, and three letters leave
// little room for mischief.
//
// A score that comes from the browser cannot be trusted. So a game that can play a run again
// (its `scoreRun`) never sends one: the board hands each run its seed when it starts (a "run",
// kept by the board until it is used, or for RUN_TTL_MS), and the page sends back the run itself
// (what its player did). The Worker plays it again with the game's own code and chalks up that
// score, once per run. A run the board did not hand out, or a score typed into an address, gets
// nowhere. A game without `scoreRun` posts a bare score, and the board can only make cheating
// pointless to automate: a cap on the score, a cap on the list, and (in the Worker) a limit on how
// often one connection may post.

/** How many scores a board keeps. */
export const BOARD_SIZE = 10;
/** The largest body a bare score needs: {"name":"ABC","score":123456}. */
export const MAX_SCORE_BODY_BYTES = 128;
/** The largest body a run may be: its letters, its run and what its player did (Cork & Bell's: at most 189 corks, about 11 KB). */
export const MAX_RUN_BODY_BYTES = 16384;
/** How long the board keeps a run it handed out and nobody has sent back. */
export const RUN_TTL_MS = 12 * 60 * 60 * 1000;
/** Where the board keeps its runs: the run's id after this prefix. */
export const RUN_PREFIX = "run:";

/**
 * A run's id: when it was handed out (ten base-36 digits, so ids sort by age and the board can
 * drop the old ones in order) and 128 random bits, as hex.
 */
export function runId(now, randomHex) {
  return Math.max(0, Math.floor(now)).toString(36).padStart(10, "0") + "." + randomHex;
}

/** Whether a value is a run id as runId makes them. */
export function isRunId(value) {
  return typeof value === "string" && /^[0-9a-z]{10}\.[0-9a-f]{32}$/.test(value);
}

/** When the run with this id was handed out (ms). */
export function runTime(id) {
  return parseInt(id.slice(0, 10), 36);
}

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
