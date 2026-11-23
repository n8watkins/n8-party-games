// Paper Masks: tidying an answer before anyone sees it (rules, section 3).
// Pure functions, no browser or platform APIs. The result is plain text: it is stored and sent as
// typed, so a page must always render it as text (textContent), never as HTML.

/** The most characters (code points) an answer may hold after tidying. */
export const ANSWER_MAX = 80;

/** Anything longer than this, before tidying, is refused without being looked at. */
export const RAW_MAX = 1000;

// Line and paragraph breaks of every kind (kept as escapes in a string so this file stays ASCII).
const LINE_BREAKS = new RegExp("[\\r\\n\\t\\v\\f\\x85\\u2028\\u2029]", "g");
// Control and format characters (bidi overrides, zero-width joiners, soft hyphens), private use,
// unassigned and lone surrogates, symbols that cannot be read aloud (emoji, dingbats, arrows,
// modifier symbols such as skin tones), variation selectors, tag characters and enclosing marks (keycaps).
const UNREADABLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{So}\p{Sk}\p{Me}\p{Extended_Pictographic}\u{FE00}-\u{FE0F}\u{E0000}-\u{E007F}]/gu;
const SPACES = /\p{Zs}+/gu;
const STRAY_MARKS = /(^|[^\p{L}\p{N}\p{M}])\p{M}+/gu; // combining marks with nothing to sit on
const MARK_PILES = /(\p{M}{2})\p{M}+/gu; // at most two combining marks on a letter (no "zalgo" text)
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;

/**
 * Tidies a typed answer. Returns `{ ok: true, text }`, or `{ ok: false, error }` where `error` is
 * `not_text`, `too_long` or `empty`.
 */
export function tidyAnswer(raw) {
  if (typeof raw !== "string") return { ok: false, error: "not_text" };
  if (raw.length > RAW_MAX) return { ok: false, error: "too_long" };
  let s = raw.normalize("NFC");
  s = s.replace(LINE_BREAKS, " ");
  s = s.replace(UNREADABLE, "");
  s = s.replace(STRAY_MARKS, "$1").replace(MARK_PILES, "$1");
  s = s.replace(SPACES, " ").trim();
  if (mostlyCapitals(s)) s = s.toLowerCase();
  s = capitaliseFirst(s);
  if (/[^.]\.$/u.test(s)) s = s.slice(0, -1).trimEnd();
  if (!ALPHANUMERIC.test(s)) return { ok: false, error: "empty" };
  if ([...s].length > ANSWER_MAX) return { ok: false, error: "too_long" };
  return { ok: true, text: s };
}

/** True when an answer was typed mostly in capitals: at least 4 cased letters, over two thirds upper case. */
export function mostlyCapitals(s) {
  let cased = 0;
  let upper = 0;
  for (const c of s) {
    const lo = c.toLowerCase();
    const up = c.toUpperCase();
    if (lo === up) continue;
    cased++;
    if (c === up) upper++;
  }
  return cased >= 4 && upper * 3 > cased * 2;
}

/** Capitalises the first letter when only punctuation or spaces come before it ("3 eggs" stays as it is). */
function capitaliseFirst(s) {
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (LETTER.test(c)) {
      chars[i] = c.toUpperCase();
      return chars.join("");
    }
    if (ALPHANUMERIC.test(c)) return s;
  }
  return s;
}

/**
 * The form two answers are compared in to find identical ones (rules, section 7): lower case,
 * with punctuation and symbols removed and spaces collapsed.
 */
export function matchKey(text) {
  const key = text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return key || text.toLowerCase();
}
