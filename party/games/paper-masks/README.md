# Paper Masks: rules module

Everyone answers a prompt about themselves or the group in secret, the reader reads the answers out with no names, the table guesses who wrote what, and at the reveal a blank mask lifts off the author's mask.
3 to 8 players, each on their own phone at the Table.

The rules are in `PAPER-MASKS-RULES.md` (ops repo); that file is authoritative.
This folder is the pure rules and content only: no pages, no server wiring.

| File | What it is |
| --- | --- |
| `rules.js` | `create`, `apply`, `view`, `nextDeadline`, `done`, `result`, `standings`, `cleanOptions` |
| `questions.js` | The prompt deck (85 prompts in five packs, two ghost answers each); server only |
| `text.js` | `tidyAnswer` (length, whitespace, control characters, emoji, capitals) and `matchKey` |
| `test/` | Whole matches, refusals, secrecy properties, time and drops, the deck, tidying |

Everything is a pure function of plain JSON.
There is no clock and no hidden randomness: the room passes `now`, and a seeded generator's position is kept in the state (`state.rng`).

## The API

```js
import { create, apply, view, nextDeadline, done, result, standings, isRefusal, SYSTEM } from "./rules.js";

let state = create(seats, { rounds: 5, pack: "mixed", family: false, callMode: false, host }, secretSeed, now);
const out = apply(state, seat, { t: "guess", card, who }, now); // a new state, or { refused, message }
if (!isRefusal(out)) state = out;
view(state, seat);                                  // what that seat may see; send nothing else
nextDeadline(state);                                // when to send apply(state, SYSTEM, { t: "tick" }, now)
done(state) && result(state);
```

`apply` never changes the state it is given.
A refusal is `{ refused: code, message }` and leaves nothing behind.
`create` refuses bad seats or options the same way.

## The state machine

| Phase | Who acts | It ends when | Then |
| --- | --- | --- | --- |
| `writing` | every player in the round sends an answer (may change it) | everyone still here has sent; the host's `endStep`; or the hard deadline | `reading` (or `summary` with no points when nobody sent) |
| `reading` | the reader reads the shuffled list aloud | the reader's `startGuessing`, or the hard deadline | `guessing` on the first card |
| `guessing` (once per card) | everyone but the card's author taps a name | the reader's `next` once everyone has guessed; the host's `endStep`; or the hard deadline | the next card, or `reveal` after the last |
| `reveal` | the reader taps `reveal` per card (`revealAll` at 7 or 8) | the reader's `reveal` after the last card, or a hard deadline per card | `summary` |
| `summary` | the host taps `nextRound` | the host's `nextRound`, or the hard deadline | the next round's `writing`, or `over` |
| `over` | nobody | | |

The match also ends (`over`, `result.early`) when fewer than 3 players are left.

Round 1 is read by the host; then the reading passes along the seat order.
With `rounds: "everyone"` the next reader is the next player who has not read, and the match ends when everyone still here has read.

## Moves

Players send moves as their own seat number; the room sends its own as `SYSTEM`.

| Move | Who | When | What it does |
| --- | --- | --- | --- |
| `{ t: "answer", text }` | a player in the round | `writing` | Tidies and stores the answer; sending again changes it. Refused: `not_text`, `too_long`, `empty` |
| `{ t: "startGuessing" }` | the reader | `reading` | Starts guessing on the first card |
| `{ t: "guess", card, who }` | a player in the round who did not write `card`, or a watcher | `guessing`, current card | Stores a private guess; may be changed until the step closes. `who` is a seat or `"ghost"` |
| `{ t: "next" }` | the reader | `guessing`, once every player but the author has guessed | Moves to the next card |
| `{ t: "endStep" }` | the host | `writing` or `guessing` | "End it now": closes the step with whoever is missing (a note names them) |
| `{ t: "reveal" }` | the reader | `reveal` | Reveals the next card with its author (and any identical answer with it); after the last, shows the summary |
| `{ t: "revealAll" }` | the reader | `reveal`, 7 or 8 players in the round | Reveals every remaining card |
| `{ t: "nextRound" }` | the host | `summary` | The next round, or the end |
| `{ t: "passReading" }` | the host | `reading`, `guessing`, `reveal` | Hands the reading to the next player |
| `{ t: "askSkip", card }` | the reader, when not the host | `reading` (any card), `guessing` (current card) | The host sees that card's id and text in `view().asks` |
| `{ t: "skip", card }` | the host | `reading` (any card), `guessing` (current card) | Removes the card for good (see below) |
| `{ t: "keep", card }` | the host | `reading`, `guessing` | Dismisses the reader's ask |
| `{ t: "tick" }` | `SYSTEM` | any time | Soft deadline: sets `overdue` and a `time_up` note. Hard deadline: acts as the step's own tap, with a note |
| `{ t: "join", seat }` | `SYSTEM` | not `over` | A late joiner: a watcher now, a player from the next round while there are fewer than 8 |
| `{ t: "leave", seat }` | `SYSTEM` | not `over` | A seat gone for good (see below) |
| `{ t: "host", seat }` | `SYSTEM` | not `over` | The room's host (picker) moved to another player |

Every refusal code: `bad_seats`, `bad_rounds`, `bad_pack`, `bad_option`, `bad_host`, `bad_move`, `not_system`, `over`, `not_now`, `not_playing`, `not_reader`, `not_host`, `not_text`, `too_long`, `empty`, `not_current`, `own_card`, `not_a_choice`, `name_used`, `waiting_for_guesses`, `no_card`, `too_few_for_reveal_all`, `use_skip`, `not_asked`, `already_in_game`, `left`.

## Time

Timers are deadlines in the state, `state.deadline = { soft, hard }`, and `nextDeadline(state)` is the next one to wake for (the soft one until it has passed, then the hard one; `null` when over).
The room sends `{ t: "tick" }` as `SYSTEM` at that time; a tick before its deadline changes nothing, and every tick at a deadline moves `nextDeadline` on, as the kit's turn-based contract asks.

| Step | Soft (nudge, `overdue`) | Hard (acts by itself) |
| --- | --- | --- |
| Writing | 90 s | 90 s after the soft one: writing closes |
| Reading | none | 180 s: guessing starts |
| Guessing, per card | 45 s (30 s at 7 or 8 players) | one more soft period: the card closes, missing guesses count as none |
| Reveal, per tap | none | 180 s: the next card is revealed |
| Summary | none | 180 s: the next round starts |

## Views

`view(state, seat)` is the only thing a phone may be sent.
Every view has `phase`, `round`, `rounds`, `prompt`, `reader`, `host`, `ghost` (the "The game" chip is in play), `you` (`seat`, `role`: `player`, `watcher` or `screen`; `mask`, `reader`, `host`), `players` (seat, mask, score, left, joinedRound, inRound), `watchers`, `deadline` (`soft`, `hard`, `overdue`), `notes` and `step`:

| Phase | `step` |
| --- | --- |
| `writing` | `sent` (seat: yes/no, nothing else), `maxLength`, `yours` (your own tidied answer, or null) |
| `reading` | `count`; `cards` (`[{ id, text }]`, shuffled) for the reader, or for everyone in call mode, otherwise null; `yours` (`{ id, text }`); `yourSkipped`; `asked` (the reader's asks) |
| `guessing` | `card` (`{ id, text }`), `index`, `of`, `yours` (this card is yours), `yourCard`, `chips`, `available` (chips minus names used), `guess` (your own), `auto` (filled in for you), `eachNameOnce`, `guessed` (seat: yes/no), `everyoneGuessed`, `sheet` (earlier cards with your own guesses), `talkingOrder` (call mode) |
| `reveal`, `summary` | `cards`: every card's `id`, `text`, `revealed`, `yourGuess`; a revealed card adds `by` (seat or `"ghost"`), `mask` (the author's, `"blank"` for the ghost), `sameAs` (other authors of an identical answer), `guesses` (everyone's), `right`. `summary` adds `points` (seat: `correct`, `fooled`, `perfect`, `total`) |
| `over` | as `summary` when the round was guessed, otherwise null; the view also has `result` |

The host's view adds `asks` (`[{ id, text }]`) while reading or guessing.
A watcher (late joiner) and anyone unknown (a big screen) get what a player who wrote nothing gets, with no "yours" marker; a watcher also gets chips and its own guesses.

What a view never holds: another seat's answer before writing closes; any answer text in room mode before guessing reaches it (except the reader's list); a card's author before its reveal; a skipped card's text or author, ever; anyone else's guesses before the reveal; the seed, the generator, the deck or the ghost answers.
`test/secrecy.test.js` checks these for every phase and viewer, and checks that two matches in which two seats swapped what they wrote look identical to every other viewer until those cards are revealed (and to the end when they are skipped).

## Scoring

Exactly as the rules, section 5: +1 per answer matched to its author, +1 to an author for each player who pinned their answer on someone else (pinning it on "The game" counts), +2 for a perfect sheet.
The ghost scores nothing and cannot be fooled; a skipped card scores nothing for anyone; identical answers count either author as right for either card.
`result(state)`: `rows` (best first: seat, mask, score, correct, fooled, left, joinedRound, place), `winners` (ties share), `awards.bestMask` and `awards.mindReader` (`{ seats, count }`), `watchers` (side scores), `early`, `roundsPlayed`.
`standings(state)` gives the kit its places.

## Answer text: what the page must do

`tidyAnswer` stores plain text: it removes control and format characters (including bidi overrides and zero-width characters), emoji and other unreadable symbols, piles of combining marks, and collapses whitespace, but it keeps `<`, `>`, `&`, quotes and every other printable character as typed.
So a page must render answers (and prompts and notes) as text only: `textContent` or a framework's text binding, never `innerHTML`, `insertAdjacentHTML`, `document.write` or an attribute built by string concatenation.
The 80-character limit counts code points after tidying; the page's text box should use the same limit (`maxLength` in the writing view) and keep a half-typed answer in the page itself across a reload (the rules, section 7).

## Choices made where the rules were open

1. **Soft timers, plus a hard deadline.** The rules make the timers soft and leave closing to the host; the brief asks that a round never stalls (a host whose phone died would stop it).
   So each step also has a hard deadline (table above) at which it closes by itself with a visible note; nobody loses points for it.
2. **The author's "has guessed" tick** appears when every other player's tick has, so the ticks never single the author out (the rules do not say).
   The note after a timed-out card lists everyone without a tick, the author included.
3. **The perfect-sheet bonus** needs a guess on every card you could guess (missing one by the timer means no bonus), all of them right.
4. **Watchers' side score** is +1 per right guess, nothing else; their wrong guesses fool nobody.
5. **A player who left** keeps earning fooling points from their answer still in play, keeps a row in the result with no place, and takes no title. They cannot rejoin the same match (`join` refuses `left`).
6. **The host leaving** passes the host to the first player still here; the room can also name one with `{ t: "host" }`.
7. **Masks.** The eight are shuffled and dealt in seat order; a late joiner gets a random free one, or none (`null`) if all eight are taken. The ghost's card lifts to a `"blank"` mask.
8. **Capitals.** "Mostly capitals" means at least 4 cased letters, over two thirds of them upper case ("NASA rocks" stays). Only a single trailing full stop goes ("Wait..." stays).
9. **Too long** is refused, not cut, after tidying.
10. **Duplicates are revealed together**, at the first of them in the order, so "Great minds" shows both authors at once.
11. **The reveal's last tap** shows the summary; reveal starts with nothing shown.
12. **Default rounds** is 4 at 7 or 8 players and 5 otherwise; 4 is also accepted as a choice.
13. **Deck.** The chosen pack (filtered to family-safe prompts when `family` is on) is dealt first, then the rest of the deck under the same filter; only if a match ever used every prompt would it reshuffle (with a note).
14. **Talking order in call mode** is the round's players in seat order, starting one later for each card.
15. **End writing / End it now** is accepted from the host at any time; the page shows the button once `overdue` is set.

## For the Table that hosts it

- **The seed must be secret.** Pass a fresh secure seed (`newSeed()` from the kit's `rng.js`), not the room's round seed, which the kit's contract says a game with secrets must not draw them from. Keep the state server side; send only `view`.
- **Map the kit's hooks:** `create({ seats, now, settings })` calls `create(seats, settings, newSeed(), now)`; `input(state, seat, data, now)` calls `apply` and returns `{ ok: false, error: refused, message }` on a refusal; `nextDeadline` as is; `tick(state, now)` applies `{ t: "tick" }` as `SYSTEM`; `snapshot(state, now, viewer)` is `view(state, viewer.seat)` for a player and `view(state, -1)` for a screen; `isOver` is `done`; `standings` as is. The state is plain JSON, so no `serialize` is needed.
- **Leaving.** The kit ends a turn-based game when a seat is gone for good (`abandon`). Paper Masks is meant to go on: the Table should apply `{ t: "leave", seat }` instead and let the match continue (it ends by itself below 3 players).
- **Late joiners** are `{ t: "join", seat }`; their seat then gets the watcher view and may guess.
- **The host** of the game is the room's picker; send `{ t: "host", seat }` when it moves.
- **Ghost answers** are in `questions.js`; never ship that file to a page (`promptsForPage()` is the safe list).
- **Server logs** must never print an answer next to its author (rule 17): log refusals by code, not the state.
- The kit's party is four seats today; the rules module takes 3 to 8.
