// Answered inputs to a turn-based game. An input may carry an id; the room answers its sender
// only, `ack {id}` when it was applied or `error {id, error, message}` when the game turned it
// down, and an id it has answered before from the same seat is answered again the same way and
// not applied twice (a phone that sends again after a reconnect, a double tap). The answers kept
// for that are plain JSON, so they are saved with the game and survive a wake.
//
// Plain logic: no network, no clock, no storage. Any room class can use it.

/** How many answers are kept per seat: enough for a retry after a reconnect, small enough to save every time. */
export const ANSWERS_KEPT = 32;
/** The longest id a page may send. Ids are the page's own: a counter, or a command id. */
export const ID_MAX = 64;

/** The id an input carries: a string of 1 to ID_MAX characters, or a safe integer; anything else is no id (null). */
export function inputId(raw) {
  if (typeof raw === "string" && raw.length >= 1 && raw.length <= ID_MAX) return raw;
  if (Number.isSafeInteger(raw)) return raw;
  return null;
}

/** An id as a key: 7 and "7" are different ids. */
const keyOf = (id) => `${typeof id === "number" ? "n" : "s"}:${id}`;

/**
 * The game's answer (what is left of `input`'s return once its events are taken out, turns.js
 * inputOutcome) as the room sends it. `{ok: false, error, message}` is a refusal, with a code
 * and a sentence for people (filled in when the game gives none); anything else was applied.
 */
export function answerOf(answer) {
  if (answer?.ok !== false) return { ok: true };
  return {
    ok: false,
    error: typeof answer.error === "string" && answer.error ? answer.error : "refused",
    message: typeof answer.message === "string" && answer.message ? answer.message : "The game did not take that.",
  };
}

/** The message that answers an input: `{t: "ack", id}` or `{t: "error", id, error, message}`. */
export function answerMessage(id, answer) {
  return answer.ok === false ? { t: "error", id, error: answer.error, message: answer.message } : { t: "ack", id };
}

/** The answer given before to this id from this seat, or null. `book` is `{[seat]: [[key, answer], ...]}`, oldest first. */
export function recall(book, seat, id) {
  const key = keyOf(id);
  for (const [k, answer] of book?.[seat] ?? []) if (k === key) return answer;
  return null;
}

/** Keeps the answer to this id from this seat, dropping the oldest past `max`. Returns the book. */
export function remember(book, seat, id, answer, max = ANSWERS_KEPT) {
  const list = (book[seat] ??= []);
  list.push([keyOf(id), answer]);
  while (list.length > max) list.shift();
  return book;
}
