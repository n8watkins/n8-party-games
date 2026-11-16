// The pure parts of the Hot Potato hearing test: normalising what was heard, the last-letter
// rule, and matching what the recogniser returned against the city list. No DOM, no browser
// APIs, so it runs the same in the page and in the unit tests (lab/hot-potato/test).

/** Letters that NFD does not split into a base letter and a mark. */
const FOLD = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i", ħ: "h" };
/** Short forms spoken or written either way: "St. Louis" and "Saint Louis" are one key. */
const WORDS = { st: "saint", ste: "sainte", ft: "fort", mt: "mount" };

/**
 * Lower case, accents removed (NFD, then the marks dropped), "&" as "and", punctuation and
 * hyphens as spaces, "St"/"Ft"/"Mt" spelled out, single spaces. "São Paulo" -> "sao paulo".
 */
export function normalize(text) {
  const s = String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ßæœøłđðþıħ]/g, (c) => FOLD[c])
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return s ? s.split(" ").map((w) => WORDS[w] ?? w).join(" ") : "";
}

/** Only the letters a to z, after normalising: what the chain rule looks at. */
export const letters = (text) => normalize(text).replace(/[^a-z]/g, "");
export const firstLetter = (text) => letters(text).charAt(0);
export const lastLetter = (text) => letters(text).slice(-1);

/**
 * The chain rule: the new name starts with the last letter of the previous one, both read from
 * letters only, so "New York" ends in K and "São Paulo" runs from S to O. The first turn (no
 * previous word) takes any letter.
 */
export function followsChain(previous, next) {
  if (!previous) return true;
  return firstLetter(next) === lastLetter(previous);
}

/** Levenshtein distance, stopping early once it is above `max`. */
export function editDistance(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * A rough sound key for English speech: the first letter kept, common spellings of one sound
 * folded together (ph/f, c/k/q, z/s, y/i), silent letters dropped, then the vowels dropped and
 * doubled letters merged. "roam" and "Rome" are both "rm"; "burn" and "Bern" are both "brn".
 */
export function soundKey(text) {
  let s = letters(text);
  if (!s) return "";
  s = s
    .replace(/^kn/, "n")
    .replace(/^wr/, "r")
    .replace(/^ps/, "s")
    .replace(/ph/g, "f")
    .replace(/gh/g, "")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/dg/g, "j")
    .replace(/([^aeiou])h/g, "$1")
    .replace(/y/g, "i")
    .replace(/w(?![aeiou])/g, "");
  const head = s[0];
  const tail = s.slice(1).replace(/[aeiouh]/g, "");
  return (head + tail).replace(/(.)\1+/g, "$1");
}

/**
 * Turns the shipped JSON ({rows: [[name, ascii|0, alts|0, abbrs|0, country, population]]},
 * biggest first) into an index. Each place gets an id (its row number); every name, ASCII name,
 * English alternate name and abbreviation is a key. A place's spoken name is the name it was
 * matched by, except for abbreviations, which play as the main name.
 */
export function buildIndex(doc) {
  const places = [];
  const byKey = new Map();
  const byLetter = new Map();
  const add = (key, entry) => {
    if (!key) return;
    const list = byKey.get(key);
    if (!list) byKey.set(key, [entry]);
    else if (!list.some((e) => e.id === entry.id)) list.push(entry);
  };
  doc.rows.forEach(([name, ascii, alts, abbrs, country, population], id) => {
    const place = { id, name, country, population };
    places.push(place);
    const names = [name, ...(ascii ? [ascii] : []), ...(alts || [])];
    for (const n of names) {
      const key = normalize(n);
      add(key, { id, via: n, abbr: false });
      const letter = key.charAt(0);
      if (!/[a-z]/.test(letter)) continue;
      if (!byLetter.has(letter)) byLetter.set(letter, []);
      byLetter.get(letter).push({ id, via: n, compact: letters(n), sound: soundKey(n) });
    }
    for (const a of abbrs || []) add(normalize(a), { id, via: a, abbr: true });
  });
  return { places, byKey, byLetter };
}

/** Every run of one to `max` words in a transcript, longest first: "uh Sydney please" finds "sydney". */
export function spans(text, max = 4) {
  const words = normalize(text).split(" ").filter(Boolean);
  const out = [];
  for (let len = Math.min(max, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) out.push(words.slice(i, i + len).join(" "));
  }
  return out;
}

/** How far a heard word may be from a name, by its length, before it is no longer a sound-alike. */
const allowedDistance = (n) => (n <= 3 ? 1 : n <= 6 ? 2 : 3);

/** Sound-alikes only count for places this big: small towns are too easy to hit by accident. */
export const SOUND_ALIKE_MIN_POPULATION = 50000;

/**
 * Sound-alike candidates for one heard span among places whose names start with `letter`:
 * the same sound key and a spelling no further off than its length allows ("roam" for Rome),
 * or one letter off for a heard word of five letters or more ("Lundon"). Heard words under four
 * letters never match by sound.
 */
function soundAlikes(index, span, letter) {
  const heard = letters(span);
  if (heard.length < 4) return [];
  const key = soundKey(span);
  const max = allowedDistance(heard.length);
  const found = [];
  for (const e of index.byLetter.get(letter) ?? []) {
    if (Math.abs(e.compact.length - heard.length) > max) continue;
    if (index.places[e.id].population < SOUND_ALIKE_MIN_POPULATION) continue;
    const d = editDistance(heard, e.compact, max);
    const sameSound = e.sound === key;
    if (!(sameSound ? d <= max : d <= 1 && heard.length >= 5)) continue;
    found.push({ ...e, distance: d, sameSound });
  }
  return found;
}

/**
 * Matches what the recogniser returned against the list, under the chain rule.
 *
 * `alternatives` is [{transcript, confidence}] in the recogniser's order. `required` is the
 * letter the answer must start with (or "" on the first turn), `used` a Set of place ids already
 * played and `usedNames` a Set of the normalised names already said (so a second "Sydney" is a
 * repeat even though Sydney in Canada is another place), `previous` the last accepted spoken
 * name (a transcript that is just that word again is an echo, not an answer).
 *
 * Preference: an exact name in the first alternative, then an exact name in a later alternative,
 * then a sound-alike; within each, longer heard phrases, then bigger cities. Returns
 * {ok, kind, place, said, heard, alternative, reason}:
 *  - ok true: kind is "exact", "alternative" or "sound-alike", `said` the name the chain goes on from.
 *  - ok false: reason is "used", "wrong-letter", "echo" or "not-a-city"; `place` and `heard` say
 *    what it came closest to, when anything.
 */
export function matchHeard(index, alternatives, { required = "", used = new Set(), usedNames = new Set(), previous = "" } = {}) {
  const alts = (alternatives ?? []).filter((a) => a && normalize(a.transcript));
  const isUsed = (e) => used.has(e.id) || usedNames.has(normalize(e.abbr ? index.places[e.id].name : e.via));
  if (!alts.length) return { ok: false, reason: "not-a-city", kind: null, place: null, said: "", heard: "" };
  const prevKey = previous ? normalize(previous) : "";
  let wrongLetter = null;
  let usedHit = null;
  let echo = false;

  const result = (kind, entry, span, alternative, extra = {}) => {
    const place = index.places[entry.id];
    return { ok: true, kind, place, said: entry.abbr ? place.name : entry.via, heard: span, alternative, ...extra };
  };
  const fail = (reason, hit) => ({
    ok: false,
    reason,
    kind: null,
    place: hit ? index.places[hit.entry.id] : null,
    said: hit ? hit.entry.via : "",
    heard: hit ? hit.span : normalize(alts[0].transcript),
    alternative: hit ? hit.ai : 0,
  });

  // Exact names (and aliases) first, across every alternative. Within one alternative the
  // longest heard phrase wins ("los angeles" over "los"), then the biggest city ("I say Sydney"
  // is Sydney, not the town of Say). Rows are sorted by population, so a lower id is bigger.
  const said = (e) => (e.abbr ? index.places[e.id].name : e.via);
  for (let ai = 0; ai < alts.length; ai++) {
    let pick = null;
    for (const span of spans(alts[ai].transcript)) {
      if (prevKey && span === prevKey) {
        echo = true;
        continue;
      }
      const entries = index.byKey.get(span);
      if (!entries) continue;
      const words = span.split(" ").length;
      const sorted = [...entries].sort((a, b) => a.id - b.id);
      const fits = sorted.filter((e) => !required || firstLetter(said(e)) === required);
      const fresh = fits.find((e) => !isUsed(e));
      if (fresh && (!pick || words > pick.words || (words === pick.words && fresh.id < pick.entry.id))) pick = { entry: fresh, span, words };
      if (fits.length) usedHit ??= { entry: fits[0], span, ai };
      else wrongLetter ??= { entry: sorted[0], span, ai };
    }
    if (pick) return result(ai === 0 ? "exact" : "alternative", pick.entry, pick.span, ai);
  }

  // A name heard exactly that was already played is a repeat, not a cue to guess at another place.
  if (usedHit) return fail("used", usedHit);

  // Then sound-alikes, only among names that start with the required letter (on the first turn,
  // the heard word's own first letter).
  let best = null;
  for (let ai = 0; ai < alts.length; ai++) {
    for (const span of spans(alts[ai].transcript, 3)) {
      if (prevKey && span === prevKey) continue;
      const letter = required || span.charAt(0);
      for (const c of soundAlikes(index, span, letter)) {
        if (isUsed(c)) continue;
        const place = index.places[c.id];
        // Lower is better: spelling distance, a bonus for the same sound, a bonus for size and for
        // the recogniser's first guess.
        const score = c.distance - (c.sameSound ? 1 : 0) - Math.log10(Math.max(place.population, 10)) * 0.4 + ai * 0.3 - span.split(" ").length * 0.2;
        if (!best || score < best.score) best = { score, entry: c, span, ai };
      }
    }
  }
  if (best) return result("sound-alike", best.entry, best.span, best.ai, { distance: best.entry.distance });

  if (wrongLetter) return fail("wrong-letter", wrongLetter);
  if (echo) return fail("echo", null);
  return fail("not-a-city", null);
}

/** The median of a list of numbers (null when there are none). */
export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}
