// Paper Masks: the pure rules (PAPER-MASKS-RULES.md is authoritative; README.md lists the choices
// made where it was open).
//
// Everything here is a pure function of plain JSON: no browser or platform APIs, no clock, no
// hidden randomness. Every draw (the masks, the deck, the ghost's answer, the order of the cards)
// comes from the match's secret (`state.secret`, at least 128 bits the Table's adapter takes from
// the platform's secure source) through party/games/draws.js, at a position kept in the state
// (`state.draws`); card ids are keyed hashes of the same secret under a label of their own. The
// room's `seed` is not used: it is 32 bits, and what one phone sees of a deal is enough to find it
// by trying them all. The state is server only: a page gets `view(state, seat)` and nothing else.
//
//   create(seats, options, seed, now, { secret })  -> state | refusal
//   apply(state, seat, move, now)      -> new state | refusal     (never changes `state`)
//   view(state, seat)                  -> what that seat may see
//   nextDeadline(state)                -> when the host must send { t: "tick" }, or null
//   done(state), result(state), standings(state)
//
// A refusal is `{ refused: code, message }`; `isRefusal(x)` tells them apart.

import { QUESTION_BY_ID, QUESTIONS, PACKS } from "./questions.js";
import { ANSWER_MAX, matchKey, tidyAnswer } from "./text.js";
import { drawsFor, freshSecret, isSecret, keyedHex } from "../draws.js";

const draw = drawsFor("paper-masks");

export const GAME_ID = "paper-masks";
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
/** The masks dealt to players, one each, all different. */
export const MASKS = Object.freeze(["fox", "moon", "sun", "owl", "butterfly", "jester", "plume", "leaf"]);
/** The chip and the author id of the game's own answer at 3 players. */
export const GHOST = "ghost";
/** The mask the ghost's card lifts to at the reveal: a blank one ("it was the game all along"). */
export const GHOST_MASK = "blank";
/** The seat id the host (the room) sends its own moves as: tick, join, leave, host. */
export const SYSTEM = "system";
export const ROUND_CHOICES = Object.freeze([3, 5, 7, "everyone"]);
export const DEFAULT_ROUNDS = 5;
export const PACK_CHOICES = Object.freeze(["mixed", ...PACKS.map((p) => p.id)]);

/** Timers in milliseconds. `soft` deadlines nudge; `hard` deadlines act so a round never stalls. */
export const TIMERS = Object.freeze({
  writeSoft: 90_000, // rules: a soft 90-second bar
  writeGrace: 90_000, // then the host's "End writing now"; after this much more, writing closes itself
  readHard: 180_000, // the reader's list; then guessing starts by itself
  guessSoft: 45_000, // per answer (rules)
  guessSoftLarge: 30_000, // per answer at 7 or 8 players (rules)
  // a guessing step closes itself one more soft period after its soft deadline
  revealHard: 180_000, // per reveal tap
  summaryHard: 180_000, // the round summary; then the next round starts by itself
});

const NOTES_KEPT = 12;

// ---------------------------------------------------------------------------------------------
// Refusals

const MESSAGES = {
  bad_seats: "A game needs 3 to 8 different seats.",
  bad_rounds: "Rounds must be 3, 5, 7 or everyone.",
  bad_pack: "That pack does not exist.",
  bad_option: "That option is not one the game knows.",
  bad_host: "The host must be one of the seats.",
  bad_secret: "The match needs a secret of at least 128 bits.",
  bad_move: "That move is not one the game knows.",
  over: "The match is over.",
  not_now: "That cannot be done at this point of the round.",
  not_playing: "Only a player in this round can do that.",
  not_reader: "Only this round's reader can do that.",
  not_host: "Only the host can do that.",
  not_system: "Only the room can send that.",
  not_text: "An answer must be text.",
  too_long: `An answer can be at most ${ANSWER_MAX} characters.`,
  empty: "An answer needs at least one letter or number.",
  not_current: "That is not the answer being guessed now.",
  own_card: "This one is yours.",
  not_yours: "Only this answer's author can do that.",
  not_a_choice: "That name is not one of the choices.",
  name_used: "You have already used that name this round.",
  waiting_for_guesses: "Not everyone has guessed yet.",
  no_card: "There is no such answer.",
  too_few_for_reveal_all: "Reveal all is for 7 or 8 players.",
  use_skip: "You are the host: skip it directly.",
  not_asked: "Nobody asked to skip that answer.",
  already_in_game: "That seat is already in the game.",
  left: "That seat left the match.",
  no_one_to_pass_to: "There is nobody to pass the reading to.",
};

const refuse = (code) => ({ refused: code, message: MESSAGES[code] ?? "Refused." });

export function isRefusal(x) {
  return !!x && typeof x === "object" && typeof x.refused === "string";
}

// ---------------------------------------------------------------------------------------------
// Randomness from the match's secret, its position kept in the state

/** Mixes a public value into a 32-bit number (FNV-1a with a final mix, as the kit's rng.js). Not for secrets. */
export function hashSeed(value) {
  const text = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

/** The next draw from the match's secret (party/games/draws.js), in [0, 1). */
function rand(state) {
  const n = state.draws;
  state.draws += 1;
  return draw(state.secret, n);
}

function shuffle(state, list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * A card's id: 64 bits of SHA-256 keyed by the match's secret, under a label of its own with the
 * round and the card's position. It never uses the draws, so the ids say nothing about them (the
 * ghost choice, later shuffles), and they do not depend on who wrote a card or when.
 */
function cardId(state, round, index, taken) {
  for (let salt = 0; ; salt++) {
    const id = keyedHex(`paper-masks/card-id/${round}/${index}/${salt}`, state.secret);
    if (!taken.has(id)) return id;
  }
}

// ---------------------------------------------------------------------------------------------
// Options

/** Checks and fills in the host's options; returns the clean options or a refusal. */
export function cleanOptions(options = {}) {
  if (!options || typeof options !== "object") return refuse("bad_option");
  const known = new Set(["rounds", "pack", "family", "callMode", "host"]);
  for (const key of Object.keys(options)) if (!known.has(key)) return refuse("bad_option");
  const rounds = options.rounds ?? DEFAULT_ROUNDS;
  if (!ROUND_CHOICES.includes(rounds)) return refuse("bad_rounds");
  const pack = options.pack ?? "mixed";
  if (!PACK_CHOICES.includes(pack)) return refuse("bad_pack");
  const family = options.family ?? false;
  const callMode = options.callMode ?? false;
  if (typeof family !== "boolean" || typeof callMode !== "boolean") return refuse("bad_option");
  return { rounds, pack, family, callMode };
}

// ---------------------------------------------------------------------------------------------
// Create

/**
 * Starts a match. `seats` are the players' seat numbers (3 to 8, different, whole numbers); `now`
 * is the room's clock in milliseconds. `secret` is the match's own (at least 128 bits, as hex):
 * every draw comes from it, so it is kept in the state, which only the server holds, and nothing
 * made from it but the card ids reaches a view. The room's `seed` is not used (a page may work it
 * out). Round 1 starts at once, read by the host.
 */
export function create(seats, options = {}, seed = 0, now = 0, { secret = freshSecret() } = {}) {
  if (!Array.isArray(seats) || seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) return refuse("bad_seats");
  if (!seats.every((s) => Number.isInteger(s) && s >= 0) || new Set(seats).size !== seats.length) return refuse("bad_seats");
  if (!isSecret(secret)) return refuse("bad_secret");
  const opts = cleanOptions(options);
  if (isRefusal(opts)) return opts;
  const order = [...seats].sort((a, b) => a - b);
  const host = options.host ?? order[0];
  if (!order.includes(host)) return refuse("bad_host");

  const state = {
    game: GAME_ID,
    v: 2,
    secret,
    draws: 0,
    now,
    options: opts,
    host,
    players: [],
    watchers: [],
    masksFree: [...MASKS],
    deck: [],
    deckPos: 0,
    hasRead: [],
    round: null,
    phase: "writing",
    deadline: { soft: null, hard: null },
    overdue: false,
    notes: [],
    noteSeq: 0,
    roundsScored: 0,
    ended: null,
  };
  shuffle(state, state.masksFree);
  for (const seat of order) {
    state.players.push({ seat, mask: state.masksFree.shift(), score: 0, correct: 0, fooled: 0, left: false, joinedRound: null });
  }
  state.deck = buildDeck(state);
  startRound(state, now);
  return state;
}

function buildDeck(state) {
  const { pack, family } = state.options;
  const fits = (x) => !family || x.family;
  const first = shuffle(state, QUESTIONS.filter((x) => fits(x) && (pack === "mixed" || x.pack === pack)).map((x) => x.id));
  const taken = new Set(first);
  const rest = shuffle(state, QUESTIONS.filter((x) => fits(x) && !taken.has(x.id)).map((x) => x.id));
  return [...first, ...rest];
}

// ---------------------------------------------------------------------------------------------
// Small readers

const playerOf = (state, seat) => state.players.find((p) => p.seat === seat) ?? null;
const watcherOf = (state, seat) => state.watchers.find((w) => w.seat === seat) ?? null;
const activeSeats = (state) => state.players.filter((p) => !p.left).map((p) => p.seat);
const isActive = (state, seat) => {
  const p = playerOf(state, seat);
  return !!p && !p.left;
};
const inRound = (state, seat) => !!state.round && state.round.roster.includes(seat) && isActive(state, seat);
const visibleCards = (round) => round.cards.filter((c) => !c.skipped);
const currentCard = (state) => (state.phase === "guessing" ? state.round.cards[state.round.pos] : null);
const key = (seat) => String(seat);

function note(state, k, extra = {}) {
  state.noteSeq += 1;
  state.notes.push({ n: state.noteSeq, round: state.round?.n ?? 0, k, ...extra });
  if (state.notes.length > NOTES_KEPT) state.notes.splice(0, state.notes.length - NOTES_KEPT);
}

function setDeadline(state, soft, hard) {
  state.deadline = { soft, hard };
  state.overdue = false;
}

/** The next active seat after `seat` in seat order, going round; `skip(seat)` passes over some. */
function nextActiveAfter(state, seat, skip = () => false) {
  const order = activeSeats(state);
  if (!order.length) return null;
  const after = order.filter((s) => s > seat);
  for (const s of [...after, ...order.filter((s) => s <= seat)]) if (!skip(s)) return s;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Rounds

function startRound(state, now) {
  const n = (state.round?.n ?? 0) + 1;

  // Late joiners become players from the next round, while there is room at the table.
  for (const w of [...state.watchers].sort((a, b) => a.seat - b.seat)) {
    if (activeSeats(state).length >= MAX_PLAYERS) break;
    state.watchers = state.watchers.filter((x) => x.seat !== w.seat);
    const mask = state.masksFree.length ? state.masksFree.splice(Math.floor(rand(state) * state.masksFree.length), 1)[0] : null;
    state.players.push({ seat: w.seat, mask, score: 0, correct: 0, fooled: 0, left: false, joinedRound: n, side: w.side });
    state.players.sort((a, b) => a.seat - b.seat);
    note(state, "joined_table", { seat: w.seat, round: n });
  }

  const roster = activeSeats(state);
  let reader;
  if (!state.round) reader = isActive(state, state.host) ? state.host : roster[0];
  else {
    const everyone = state.options.rounds === "everyone";
    reader = nextActiveAfter(state, state.round.assignedReader, (s) => everyone && state.hasRead.includes(s));
    if (reader === null) reader = nextActiveAfter(state, state.round.assignedReader);
  }
  if (!state.hasRead.includes(reader)) state.hasRead.push(reader);

  if (state.deckPos >= state.deck.length) {
    state.deck = buildDeck(state);
    state.deckPos = 0;
    note(state, "deck_reshuffled");
  }
  const question = QUESTION_BY_ID[state.deck[state.deckPos++]];

  state.round = {
    n,
    reader,
    assignedReader: reader,
    prompt: { id: question.id, text: question.text },
    ghostPool: [...question.ghosts],
    roster,
    ghost: roster.length === MIN_PLAYERS,
    answers: {},
    authors: [],
    cards: [],
    pos: -1,
    guesses: {},
    decoys: {},
    auto: {},
    revealed: [],
    asks: [],
    skippedAny: false,
    guessed: false,
    points: null,
  };
  state.phase = "writing";
  setDeadline(state, now + TIMERS.writeSoft, now + TIMERS.writeSoft + TIMERS.writeGrace);
}

function closeWriting(state, now, by) {
  const r = state.round;
  const missing = r.roster.filter((s) => isActive(state, s) && !(key(s) in r.answers));
  note(state, "writing_closed", { how: by, missing });
  r.authors = r.roster.filter((s) => key(s) in r.answers);

  const entries = r.authors.map((s) => ({ author: s, text: r.answers[key(s)] }));
  if (!entries.length) {
    note(state, "no_answers");
    return toSummary(state, now);
  }
  if (r.ghost) entries.push({ author: GHOST, text: r.ghostPool[Math.floor(rand(state) * r.ghostPool.length)] });

  // Put the answers in an order that depends only on their texts, then shuffle: where a card ends
  // up, and its id, never depend on who wrote it, when they sent it or their seat.
  entries.sort((a, b) => cmp(matchKey(a.text), matchKey(b.text)) || cmp(a.text, b.text));
  shuffle(state, entries);
  const taken = new Set();
  r.cards = entries.map((e, index) => {
    const id = cardId(state, r.n, index, taken);
    taken.add(id);
    return { id, text: e.text, author: e.author, match: matchKey(e.text), skipped: false };
  });
  r.answers = {}; // the texts now live only on the cards
  state.phase = "reading";
  setDeadline(state, null, now + TIMERS.readHard);
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function startGuessing(state, now) {
  state.round.pos = -1;
  advanceCard(state, now);
}

function guessSoftMs(state) {
  return activeSeats(state).length >= 7 ? TIMERS.guessSoftLarge : TIMERS.guessSoft;
}

/** Moves guessing to the next card that is not skipped, or on to the reveal. */
function advanceCard(state, now) {
  const r = state.round;
  let pos = r.pos + 1;
  while (pos < r.cards.length && r.cards[pos].skipped) pos++;
  if (pos >= r.cards.length) {
    r.pos = r.cards.length;
    r.guessed = true;
    state.phase = "reveal";
    setDeadline(state, null, now + TIMERS.revealHard);
    return;
  }
  r.pos = pos;
  state.phase = "guessing";
  const soft = guessSoftMs(state);
  setDeadline(state, now + soft, now + 2 * soft);
  autoFill(state);
}

/** The names a seat may choose from this round: every author (and the game) except itself. */
function chipsFor(state, seat) {
  const r = state.round;
  const chips = r.authors.filter((s) => s !== seat);
  if (r.ghost && r.cards.some((c) => c.author === GHOST)) chips.push(GHOST);
  return chips;
}

function canGuess(state, seat) {
  return inRound(state, seat) || !!watcherOf(state, seat);
}

function guessesOf(state, seat) {
  return state.round.guesses[key(seat)] ?? {};
}

/** Names this seat has already placed on other (unskipped) cards this round. */
function usedBy(state, seat, exceptId) {
  const r = state.round;
  const mine = guessesOf(state, seat);
  return r.cards.filter((c) => !c.skipped && c.id !== exceptId && c.id in mine).map((c) => mine[c.id]);
}

function availableFor(state, seat, card) {
  const chips = chipsFor(state, seat);
  if (state.round.skippedAny) return chips;
  const used = usedBy(state, seat, card.id);
  return chips.filter((c) => !used.includes(c));
}

/**
 * What the author of the card being guessed sees of the names: exactly what a guesser in their
 * seat would see, so from the side their phone looks like anyone's. The same chips (every author
 * and the game but themselves); their own names already used greyed as anyone's are; and once
 * their decoy tap is in, one name shown as tapped. Their page remembers which chip it tapped while
 * it is open; this is the one shown after a reload: picked by the card's id, from the names still
 * free. On the last card, where every guesser has one name left and it is filled in, the author
 * (whose names are all used by then) has one left and filled in too.
 */
function authorChips(state, seat, card) {
  const r = state.round;
  const chips = chipsFor(state, seat);
  let available = availableFor(state, seat, card);
  const visible = visibleCards(r);
  const last = !r.skippedAny && card === visible[visible.length - 1];
  const pick = (list) => (list.length ? list[hashSeed(`paper-masks/decoy/${card.id}`) % list.length] : null);
  if (last && available.length === 0) available = [pick(chips)].filter((x) => x !== null);
  const tapped = !!r.decoys[card.id];
  return { chips, available, guess: tapped ? pick(available) : null, auto: tapped && last && available.length === 1 };
}

/**
 * On the last answer only one name is left, so it is filled in (off for the round after a skip).
 * Only on the last answer: filling in anyone earlier would single out the last answer's author,
 * the one guesser left with a single name at the second-to-last answer. On the last answer every
 * guesser who has placed every other name is filled in at the same moment, and the author's decoy
 * tap is filled in with them, so the tap count jumps all at once and points at nobody.
 */
function autoFill(state) {
  const r = state.round;
  if (r.skippedAny) return;
  const card = currentCard(state);
  const visible = visibleCards(r);
  if (card !== visible[visible.length - 1]) return;
  const guessers = [...r.roster.filter((s) => isActive(state, s)), ...state.watchers.map((w) => w.seat)];
  for (const seat of guessers) {
    if (seat === card.author) continue;
    const mine = guessesOf(state, seat);
    if (card.id in mine) continue;
    const left = availableFor(state, seat, card);
    if (left.length === 1) {
      r.guesses[key(seat)] = { ...mine, [card.id]: left[0] };
      r.auto[key(seat)] = { ...(r.auto[key(seat)] ?? {}), [card.id]: true };
    }
  }
  if (inRound(state, card.author)) r.decoys[card.id] = true;
}

/**
 * Whether a player in the round has tapped for this card: a guess, or, for its author, the decoy
 * tap their page sends from the "keep a straight face" screen. Both count the same in public.
 */
function hasTapped(state, card, seat) {
  return seat === card.author ? !!state.round.decoys[card.id] : card.id in guessesOf(state, seat);
}

/** The players whose tap the public count waits for: everyone still here in the round, author included. */
function tappersOf(state) {
  return state.round.roster.filter((s) => isActive(state, s));
}

/** How many of them have tapped. The only public fact about guessing: never which seats. */
function tapsIn(state, card) {
  return tappersOf(state).filter((s) => hasTapped(state, card, s)).length;
}

function allTapped(state, card) {
  return tappersOf(state).every((s) => hasTapped(state, card, s));
}

function closeGuessStep(state, now, by) {
  const card = currentCard(state);
  // a count, never seats: a list of who had not tapped could include the author
  const missing = tappersOf(state).length - tapsIn(state, card);
  if (by !== "reader") note(state, "guessing_closed", { how: by, missing });
  advanceCard(state, now);
}

/** Reveals the next card in order, with any identical answers ("Great minds"). */
function revealNext(state) {
  const r = state.round;
  const next = visibleCards(r).find((c) => !r.revealed.includes(c.id));
  if (!next) return false;
  for (const c of visibleCards(r)) if (c.match === next.match && !r.revealed.includes(c.id)) r.revealed.push(c.id);
  return true;
}

function allRevealed(round) {
  return visibleCards(round).every((c) => round.revealed.includes(c.id));
}

/** Who wrote a card, with anyone who wrote the same thing: either counts as right. */
function groupOf(round, card) {
  return visibleCards(round)
    .filter((c) => c.match === card.match)
    .map((c) => c.author);
}

function scoreRound(state) {
  const r = state.round;
  const cards = visibleCards(r);
  const points = {};
  const row = (seat) => (points[key(seat)] ??= { correct: 0, fooled: 0, perfect: false, total: 0 });
  for (const s of r.roster) row(s);

  const guessers = new Set([...r.roster, ...state.watchers.map((w) => w.seat), ...Object.keys(r.guesses).map(Number)]);
  for (const g of guessers) {
    const mine = guessesOf(state, g);
    let placed = 0;
    let right = 0;
    for (const c of cards) {
      if (!(c.id in mine)) continue;
      placed++;
      const who = mine[c.id];
      if (groupOf(r, c).includes(who)) {
        right++;
        row(g).correct++;
      } else if (c.author !== GHOST && r.roster.includes(g)) {
        // only players fool and are fooled; a watcher's guesses count towards its side score only
        row(c.author).fooled++;
      }
    }
    // rules, section 5: a perfect sheet is "every answer you placed was right"
    if (r.roster.includes(g) && placed > 0 && right === placed) row(g).perfect = true;
  }

  for (const [s, p] of Object.entries(points)) {
    p.total = p.correct + p.fooled + (p.perfect ? 2 : 0);
    const player = playerOf(state, Number(s));
    if (player && r.roster.includes(player.seat)) {
      player.score += p.total;
      player.correct += p.correct;
      player.fooled += p.fooled;
    } else {
      const w = watcherOf(state, Number(s));
      if (w) w.side = (w.side ?? 0) + p.correct; // a watcher's side score: correct guesses only
    }
  }
  r.points = points;
  state.roundsScored += 1;
}

function toSummary(state, now) {
  scoreRound(state);
  state.phase = "summary";
  setDeadline(state, null, now + TIMERS.summaryHard);
}

function matchFinished(state) {
  const { rounds } = state.options;
  if (rounds === "everyone") return activeSeats(state).every((s) => state.hasRead.includes(s));
  return state.round.n >= rounds;
}

function nextRound(state, now) {
  if (matchFinished(state)) return endMatch(state, false);
  startRound(state, now);
}

function endMatch(state, early) {
  state.phase = "over";
  state.ended = { early };
  setDeadline(state, null, null);
  note(state, early ? "ended_early" : "ended");
}

function passReading(state, why) {
  const r = state.round;
  const to = nextActiveAfter(state, r.reader, (s) => s === r.reader);
  if (to === null) return false;
  note(state, "reader_passed", { from: r.reader, to, why });
  r.reader = to;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Moves

/**
 * Applies one move from one seat at time `now` (the room's clock; defaults to the last time the
 * game saw). Returns a new state, or a refusal. The given state is never changed.
 */
export function apply(prev, seat, move, now = prev.now) {
  if (!move || typeof move !== "object" || typeof move.t !== "string") return refuse("bad_move");
  const state = JSON.parse(JSON.stringify(prev));
  state.now = Math.max(state.now, Number.isFinite(now) ? now : state.now);
  now = state.now;
  const table = seat === SYSTEM ? SYSTEM_MOVES : MOVES;
  const handler = Object.hasOwn(table, move.t) ? table[move.t] : null;
  if (!handler) return refuse(seat !== SYSTEM && Object.hasOwn(SYSTEM_MOVES, move.t) ? "not_system" : "bad_move");
  if (state.phase === "over" && move.t !== "tick") return refuse("over");
  const out = handler(state, seat, move, now);
  return isRefusal(out) ? out : state;
}

const MOVES = {
  /** A writer sends (or changes) their answer while writing is open. */
  answer(state, seat, move, now) {
    if (state.phase !== "writing") return refuse("not_now");
    if (!inRound(state, seat)) return refuse("not_playing");
    const tidy = tidyAnswer(move.text);
    if (!tidy.ok) return refuse(tidy.error);
    const r = state.round;
    r.answers[key(seat)] = tidy.text;
    if (r.roster.every((s) => !isActive(state, s) || key(s) in r.answers)) closeWriting(state, now, "all");
  },

  /** The reader has read every answer out: guessing starts. */
  startGuessing(state, seat, move, now) {
    if (state.phase !== "reading") return refuse("not_now");
    if (seat !== state.round.reader) return refuse("not_reader");
    startGuessing(state, now);
  },

  /** A private guess for the current card; may be changed until the step closes. */
  guess(state, seat, move) {
    if (state.phase !== "guessing") return refuse("not_now");
    if (!canGuess(state, seat)) return refuse("not_playing");
    const card = currentCard(state);
    if (move.card !== card.id) return refuse("not_current");
    if (seat === card.author) return refuse("own_card");
    const chips = chipsFor(state, seat);
    if (!chips.includes(move.who)) return refuse("not_a_choice");
    if (!availableFor(state, seat, card).includes(move.who)) return refuse("name_used");
    const r = state.round;
    r.guesses[key(seat)] = { ...guessesOf(state, seat), [card.id]: move.who };
    if (r.auto[key(seat)]) delete r.auto[key(seat)][card.id];
  },

  /**
   * The author's decoy tap on their own card. The author's page shows "This one is yours. Keep a
   * straight face." with something to tap, and sends this when it is tapped, so the author taps
   * like everyone else and the public count cannot tell them apart. Sending it again changes nothing.
   */
  decoy(state, seat, move) {
    if (state.phase !== "guessing") return refuse("not_now");
    if (!inRound(state, seat)) return refuse("not_playing");
    const card = currentCard(state);
    if (move.card !== card.id) return refuse("not_current");
    if (seat !== card.author) return refuse("not_yours");
    state.round.decoys[card.id] = true;
  },

  /** The reader moves on once everyone has tapped (the author's decoy included). */
  next(state, seat, move, now) {
    if (state.phase !== "guessing") return refuse("not_now");
    if (seat !== state.round.reader) return refuse("not_reader");
    if (!allTapped(state, currentCard(state))) return refuse("waiting_for_guesses");
    closeGuessStep(state, now, "reader");
  },

  /** The host's "End it now": closes writing, or the current guessing step, whoever is missing. */
  endStep(state, seat, move, now) {
    if (seat !== state.host) return refuse("not_host");
    if (state.phase === "writing") return closeWriting(state, now, "host");
    if (state.phase === "guessing") return closeGuessStep(state, now, "host");
    return refuse("not_now");
  },

  /** The reader reveals the next author; once all are shown, the same tap shows the round's scores. */
  reveal(state, seat, move, now) {
    if (state.phase !== "reveal") return refuse("not_now");
    if (seat !== state.round.reader) return refuse("not_reader");
    if (!revealNext(state)) return toSummary(state, now);
    setDeadline(state, null, now + TIMERS.revealHard);
  },

  /** At 7 or 8 players the reader may show every remaining author at once. */
  revealAll(state, seat, move, now) {
    if (state.phase !== "reveal") return refuse("not_now");
    if (seat !== state.round.reader) return refuse("not_reader");
    if (state.round.roster.length < 7) return refuse("too_few_for_reveal_all");
    while (revealNext(state));
    setDeadline(state, null, now + TIMERS.revealHard);
  },

  /** The host starts the next round (or the final screen) from the round summary. */
  nextRound(state, seat, move, now) {
    if (state.phase !== "summary") return refuse("not_now");
    if (seat !== state.host) return refuse("not_host");
    nextRound(state, now);
  },

  /** The host hands the reading to the next player when the reader goes quiet. */
  passReading(state, seat) {
    if (!["reading", "guessing", "reveal"].includes(state.phase)) return refuse("not_now");
    if (seat !== state.host) return refuse("not_host");
    if (!passReading(state, "host")) return refuse("no_one_to_pass_to");
  },

  /** The reader (not the host) asks the host to skip an answer: the host sees only its text. */
  askSkip(state, seat, move) {
    const r = state.round;
    if (!["reading", "guessing"].includes(state.phase)) return refuse("not_now");
    if (seat !== r.reader) return refuse("not_reader");
    if (seat === state.host) return refuse("use_skip");
    const card = r.cards.find((c) => c.id === move.card && !c.skipped);
    if (!card) return refuse("no_card");
    if (state.phase === "guessing" && card !== currentCard(state)) return refuse("not_current");
    if (!r.asks.includes(card.id)) r.asks.push(card.id);
  },

  /** The host removes an answer: in reading any card, in guessing the current one. */
  skip(state, seat, move, now) {
    const r = state.round;
    if (!["reading", "guessing"].includes(state.phase)) return refuse("not_now");
    if (seat !== state.host) return refuse("not_host");
    const card = r.cards.find((c) => c.id === move.card && !c.skipped);
    if (!card) return refuse("no_card");
    if (state.phase === "guessing" && card !== currentCard(state)) return refuse("not_current");
    card.skipped = true;
    card.text = ""; // gone from every later payload, and from the save
    r.skippedAny = true;
    r.asks = r.asks.filter((id) => id !== card.id);
    for (const g of Object.values(r.guesses)) delete g[card.id];
    for (const a of Object.values(r.auto)) delete a[card.id];
    delete r.decoys[card.id];
    note(state, "skipped", { card: card.id });
    if (state.phase === "guessing") advanceCard(state, now);
  },

  /** The host keeps an answer the reader asked to skip. */
  keep(state, seat, move) {
    const r = state.round;
    if (!["reading", "guessing"].includes(state.phase)) return refuse("not_now");
    if (seat !== state.host) return refuse("not_host");
    if (!r.asks.includes(move.card)) return refuse("not_asked");
    r.asks = r.asks.filter((id) => id !== move.card);
  },
};

const SYSTEM_MOVES = {
  /** The room's clock: nudges at a soft deadline, acts at a hard one. Harmless at any time. */
  tick(state, seat, move, now) {
    if (state.phase === "over") return;
    const { soft, hard } = state.deadline;
    if (soft !== null && !state.overdue && now >= soft) {
      state.overdue = true;
      note(state, "time_up", { step: state.phase });
    }
    if (hard === null || now < hard) return;
    switch (state.phase) {
      case "writing":
        return closeWriting(state, now, "time");
      case "reading":
        note(state, "reading_closed", { how: "time" });
        return startGuessing(state, now);
      case "guessing":
        return closeGuessStep(state, now, "time");
      case "reveal":
        note(state, "step_by_time", { step: "reveal" });
        if (!revealNext(state)) return toSummary(state, now);
        return setDeadline(state, null, now + TIMERS.revealHard);
      case "summary":
        note(state, "step_by_time", { step: "summary" });
        return nextRound(state, now);
    }
  },

  /** Someone arrived mid-match: a watcher now, a player from the next round if there is room. */
  join(state, seat, move) {
    const s = move.seat;
    if (!Number.isInteger(s) || s < 0) return refuse("bad_move");
    const p = playerOf(state, s);
    if (p) return refuse(p.left ? "left" : "already_in_game");
    if (watcherOf(state, s)) return refuse("already_in_game");
    state.watchers.push({ seat: s, side: 0 });
    state.watchers.sort((a, b) => a.seat - b.seat);
    note(state, "watching", { seat: s });
  },

  /** A seat is gone for good. The round goes on; below 3 players the match ends. */
  leave(state, seat, move, now) {
    const s = move.seat;
    if (watcherOf(state, s)) {
      state.watchers = state.watchers.filter((w) => w.seat !== s);
      return;
    }
    const p = playerOf(state, s);
    if (!p) return refuse("not_playing");
    if (p.left) return refuse("left");
    p.left = true;
    note(state, "left", { seat: s });
    if (activeSeats(state).length < MIN_PLAYERS) return endMatch(state, true);
    if (state.host === s) {
      state.host = activeSeats(state)[0];
      note(state, "host_passed", { to: state.host });
    }
    const r = state.round;
    if (r.reader === s) passReading(state, "left");
    if (state.phase === "writing" && r.roster.every((x) => !isActive(state, x) || key(x) in r.answers)) closeWriting(state, now, "all");
  },

  /** The room names a new host (its picker moved). */
  host(state, seat, move) {
    if (!isActive(state, move.seat)) return refuse("bad_host");
    state.host = move.seat;
  },
};

// ---------------------------------------------------------------------------------------------
// Time

/** When the room must next send `{ t: "tick" }` as SYSTEM, or null. Moves on after every tick. */
export function nextDeadline(state) {
  if (state.phase === "over") return null;
  const { soft, hard } = state.deadline;
  if (soft !== null && !state.overdue) return soft;
  return hard;
}

// ---------------------------------------------------------------------------------------------
// Views

/**
 * What one seat may see. A player in the round gets their own answer and guesses; anyone else (a
 * late joiner watching, a player who left, a big screen, an unknown seat) gets what a seated
 * player who wrote nothing gets, without a "yours" marker; a watcher also gets its own guesses.
 * Never: another seat's answer before writing closes, a card's author before its reveal, a
 * skipped card's author or text, another seat's guesses before the reveal, the secret or any draw
 * from it (the card ids, keyed hashes of it, are the only values made from it that a page gets).
 */
export function view(state, seat) {
  const r = state.round;
  const player = playerOf(state, seat);
  const watcher = watcherOf(state, seat);
  const role = player && !player.left ? (r.roster.includes(seat) ? "player" : "watcher") : watcher ? "watcher" : "screen";
  const isReader = role === "player" && r.reader === seat;
  const isHost = role === "player" && state.host === seat;
  const writer = role === "player";
  const yoursCard = writer ? r.cards.find((c) => c.author === seat && !c.skipped) : null;

  const out = {
    game: GAME_ID,
    phase: state.phase,
    round: r.n,
    rounds: state.options.rounds,
    callMode: state.options.callMode,
    pack: state.options.pack,
    family: state.options.family,
    host: state.host,
    reader: r.reader,
    prompt: { ...r.prompt },
    ghost: r.ghost,
    you: { seat: Number.isInteger(seat) ? seat : null, role, mask: player?.mask ?? null, reader: isReader, host: isHost },
    players: state.players.map((p) => ({
      seat: p.seat,
      mask: p.mask,
      score: p.score,
      left: p.left,
      joinedRound: p.joinedRound,
      inRound: r.roster.includes(p.seat),
    })),
    watchers: state.watchers.map((w) => w.seat),
    deadline: { soft: state.deadline.soft, hard: state.deadline.hard, overdue: state.overdue },
    notes: state.notes.map((n) => ({ ...n })),
    step: null,
  };

  const viewerGuesses = role === "screen" ? {} : guessesOf(state, seat);
  const cardText = (c) => ({ id: c.id, text: c.text });

  if (state.phase === "writing") {
    const sent = {};
    for (const s of r.roster) if (isActive(state, s)) sent[key(s)] = key(s) in r.answers;
    out.step = { sent, maxLength: ANSWER_MAX, yours: writer ? (r.answers[key(seat)] ?? null) : null };
  } else if (state.phase === "reading") {
    const showList = isReader || state.options.callMode;
    out.step = {
      count: visibleCards(r).length,
      cards: showList ? visibleCards(r).map(cardText) : null,
      yours: yoursCard ? cardText(yoursCard) : null,
      yourSkipped: writer && r.authors.includes(seat) && !yoursCard,
      asked: isReader ? [...r.asks] : [],
    };
  } else if (state.phase === "guessing") {
    const card = currentCard(state);
    const cards = visibleCards(r);
    const index = cards.indexOf(card);
    const isAuthor = writer && card.author === seat;
    const mayGuess = role !== "screen" && card.author !== seat && canGuess(state, seat);
    const due = tappersOf(state).length;
    const tapped = tapsIn(state, card);
    // The author gets the very same fields a guesser gets (authorChips), so their page draws the
    // same screen; `yours` is what tells the page to send the decoy tap instead of a guess.
    const names = isAuthor
      ? authorChips(state, seat, card)
      : mayGuess
        ? { chips: chipsFor(state, seat), available: availableFor(state, seat, card), guess: viewerGuesses[card.id] ?? null, auto: !!r.auto[key(seat)]?.[card.id] }
        : { chips: [], available: [], guess: null, auto: false };
    out.step = {
      card: cardText(card),
      index,
      of: cards.length,
      yours: isAuthor,
      yourCard: yoursCard ? cardText(yoursCard) : null,
      yourSkipped: writer && r.authors.includes(seat) && !yoursCard,
      ...names,
      eachNameOnce: !r.skippedAny,
      // your own tap is in (your guess, or your decoy on your own card)
      tapped: writer ? hasTapped(state, card, seat) : role === "watcher" ? card.id in viewerGuesses : false,
      // public: only how many of the round's players have tapped, never which
      taps: tapped,
      tapsDue: due,
      everyoneGuessed: tapped === due,
      sheet: cards.slice(0, index).map((c) => ({ ...cardText(c), guess: viewerGuesses[c.id] ?? null })),
      talkingOrder: state.options.callMode ? talkingOrder(state, index) : null,
    };
  } else if (state.phase === "reveal" || state.phase === "summary" || (state.phase === "over" && r.guessed)) {
    // a match that ended early before this round's reveal shows no cards: some were never read out
    out.step = revealStep(state, seat, role, viewerGuesses, yoursCard);
  }

  if (isHost && (state.phase === "reading" || state.phase === "guessing")) {
    out.asks = r.asks.map((id) => r.cards.find((c) => c.id === id)).map(cardText);
  }
  if (state.phase === "over") out.result = result(state);
  return out;
}

function revealStep(state, seat, role, viewerGuesses, yoursCard) {
  const r = state.round;
  const cards = visibleCards(r);
  const maskOf = (author) => (author === GHOST ? GHOST_MASK : (playerOf(state, author)?.mask ?? null));
  const step = {
    cards: cards.map((c) => {
      const shown = r.revealed.includes(c.id);
      const base = { id: c.id, text: c.text, revealed: shown, yourGuess: viewerGuesses[c.id] ?? null };
      if (!shown) return base;
      const group = groupOf(r, c);
      const guesses = {};
      const right = [];
      for (const [g, mine] of Object.entries(r.guesses)) {
        if (!(c.id in mine)) continue;
        guesses[g] = mine[c.id];
        if (group.includes(mine[c.id])) right.push(Number(g));
      }
      return { ...base, by: c.author, mask: maskOf(c.author), sameAs: group.filter((a) => a !== c.author), guesses, right };
    }),
    yourCard: yoursCard ? { id: yoursCard.id, text: yoursCard.text } : null,
    allRevealed: allRevealed(r),
    canRevealAll: r.roster.length >= 7,
  };
  if (state.phase !== "reveal") step.points = r.points ? JSON.parse(JSON.stringify(r.points)) : {};
  return step;
}

function talkingOrder(state, index) {
  const seats = state.round.roster.filter((s) => isActive(state, s));
  const start = index % seats.length;
  return [...seats.slice(start), ...seats.slice(0, start)];
}

// ---------------------------------------------------------------------------------------------
// The end

export function done(state) {
  return state.phase === "over";
}

function topOf(rows, field) {
  const best = Math.max(0, ...rows.map((r) => r[field]));
  return best > 0 ? { seats: rows.filter((r) => r[field] === best).map((r) => r.seat), count: best } : { seats: [], count: 0 };
}

/**
 * The final screen: rows best first, joint winners, and the two titles. A player who left keeps a
 * row (greyed) but cannot win, place or take a title. Readable mid-match as "the scores so far".
 */
export function result(state) {
  const staying = state.players.filter((p) => !p.left);
  const rows = [...state.players]
    .sort((a, b) => b.score - a.score || a.seat - b.seat)
    .map((p) => ({ seat: p.seat, mask: p.mask, score: p.score, correct: p.correct, fooled: p.fooled, left: p.left, joinedRound: p.joinedRound, place: null }));
  let place = 0;
  let last = null;
  let i = 0;
  for (const row of rows) {
    if (row.left) continue;
    i++;
    if (row.score !== last) place = i;
    last = row.score;
    row.place = place;
  }
  const winners = rows.filter((r) => r.place === 1).map((r) => r.seat);
  const stayRows = rows.filter((r) => !r.left);
  return {
    early: !!state.ended?.early,
    roundsPlayed: state.roundsScored,
    rows,
    winners: staying.length ? winners : [],
    awards: { bestMask: topOf(stayRows, "fooled"), mindReader: topOf(stayRows, "correct") },
    watchers: [...state.watchers.map((w) => ({ seat: w.seat, side: w.side ?? 0 }))],
  };
}

/** Places for the party kit's Tonight board: place 1 is best, ties share; seats that left have none. */
export function standings(state) {
  return result(state)
    .rows.filter((r) => r.place !== null)
    .map((r) => ({ seat: r.seat, place: r.place }));
}
