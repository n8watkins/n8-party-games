# Paper Masks: rules module

Everyone answers a prompt about themselves or the group in secret, the reader reads the answers out with no names, the table guesses who wrote what, and at the reveal a blank mask lifts off the author's mask.
3 to 8 players, each on their own phone at the Table.

The rules are in `PAPER-MASKS-RULES.md` (ops repo); that file is authoritative.
Where this module departs from it, the departure is listed under "Departures from the rules" below.
This folder is server only: the pure rules and content, the Table's wrapper (`at-table.js`, `index.js`) and the tests; the page is in `party/public/games/` (see "At the Table").

| File | What it is |
| --- | --- |
| `rules.js` | `create`, `apply`, `view`, `nextDeadline`, `done`, `result`, `standings`, `cleanOptions` |
| `questions.js` | The prompt deck (83 prompts in five packs, two ghost answers each); never shipped to a page, but public in this repository (see "Ghost answers") |
| `text.js` | `tidyAnswer` (length, whitespace, control characters, emoji, capitals) and `matchKey` |
| `test/` | Whole matches, hand-scored rounds, refusals, secrecy properties, the review's leaks, time and drops, the deck, tidying |

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
`rounds` is 3, 5, 7 or `"everyone"`; the default is 5 at any table size.

## The state machine

| Phase | Who acts | It ends when | Then |
| --- | --- | --- | --- |
| `writing` | every player in the round sends an answer (may change it) | everyone still here has sent; the host's `endStep`; or the hard deadline | `reading` (or `summary` with no points when nobody sent) |
| `reading` | the reader reads the shuffled list aloud | the reader's `startGuessing`, or the hard deadline | `guessing` on the first card |
| `guessing` (once per card) | everyone but the card's author taps a name; the author taps the decoy | the reader's `next` once every player still here has tapped; the host's `endStep`; or the hard deadline | the next card, or `reveal` after the last |
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
| `{ t: "decoy", card }` | the author of `card` | `guessing`, current card | The author's decoy tap (see "The decoy tap"). Counts like a guess in the public count, scores nothing; sending it again changes nothing. Refused for anyone else: `not_yours` |
| `{ t: "next" }` | the reader | `guessing`, once every player still here has tapped (the author's decoy included) | Moves to the next card |
| `{ t: "endStep" }` | the host | `writing` or `guessing` | "End it now": closes the step with whoever is missing (writing: a note names them; guessing: a note gives only how many) |
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

Every refusal code: `bad_seats`, `bad_rounds`, `bad_pack`, `bad_option`, `bad_host`, `bad_move`, `not_system`, `over`, `not_now`, `not_playing`, `not_reader`, `not_host`, `not_text`, `too_long`, `empty`, `not_current`, `own_card`, `not_yours`, `not_a_choice`, `name_used`, `waiting_for_guesses`, `no_card`, `too_few_for_reveal_all`, `use_skip`, `not_asked`, `already_in_game`, `left`, `no_one_to_pass_to`.

## The decoy tap: what the guessing page must do

During guessing the only public fact about who has tapped is a count: `step.taps` out of `step.tapsDue`, where `tapsDue` is every player still in the round, the card's author included.
The author counts through a decoy tap, so that the count, and the author's thumb, look like everyone else's.

- When `step.yours` is true, the page shows "This one is yours. Keep a straight face." with something to tap that looks and sits like the name chips (for example a row of blank chips, or a "Got it" button where the chips would be).
  Tapping it sends `{ t: "decoy", card: step.card.id }`.
- Do not send the decoy automatically on arrival or on a timer: the count would jump the moment the card appears and point at the author.
  It must take a real tap, like a guess.
- `step.tapped` tells the page its own tap is in (guess or decoy), so it can show the same "done" state either way.
- Show the count (`taps` of `tapsDue`, or a row of anonymous dots), never names: the view no longer has a per-seat list.
- On the last card everyone who has placed every other name is filled in, and the author's decoy with them, so the count jumps at once; the page needs to do nothing there.
- If the author's page never sends the decoy, the step waits like it waits for a slow guesser: the host's End it now or the hard deadline closes it, with a note giving only how many were missing.

## Time

Timers are deadlines in the state, `state.deadline = { soft, hard }`, and `nextDeadline(state)` is the next one to wake for (the soft one until it has passed, then the hard one; `null` when over).
The room sends `{ t: "tick" }` as `SYSTEM` at that time; a tick before its deadline changes nothing, and every tick at a deadline moves `nextDeadline` on, as the kit's turn-based contract asks.

| Step | Soft (nudge, `overdue`) | Hard (acts by itself) |
| --- | --- | --- |
| Writing | 90 s | 90 s after the soft one (180 s in all): writing closes |
| Reading | none | 180 s: guessing starts |
| Guessing, per card | 45 s (30 s at 7 or 8 players) | one more soft period (90 s, or 60 s at 7 or 8): the card closes, missing guesses count as none |
| Reveal, per tap | none | 180 s: the next card is revealed |
| Summary | none | 180 s: the next round starts |

## Views

`view(state, seat)` is the only thing a phone may be sent.
Every view has `phase`, `round`, `rounds`, `prompt`, `reader`, `host`, `ghost` (the "The game" chip is in play), `you` (`seat`, `role`: `player`, `watcher` or `screen`; `mask`, `reader`, `host`), `players` (seat, mask, score, left, joinedRound, inRound), `watchers`, `deadline` (`soft`, `hard`, `overdue`), `notes` and `step`:

| Phase | `step` |
| --- | --- |
| `writing` | `sent` (seat: yes/no, nothing else), `maxLength`, `yours` (your own tidied answer, or null) |
| `reading` | `count`; `cards` (`[{ id, text }]`, shuffled) for the reader, or for everyone in call mode, otherwise null; `yours` (`{ id, text }`); `yourSkipped`; `asked` (the reader's asks) |
| `guessing` | `card` (`{ id, text }`), `index`, `of`, `yours` (this card is yours), `yourCard`, `chips`, `available` (chips minus names used), `guess` (your own), `auto` (filled in for you), `tapped` (your own tap is in), `eachNameOnce`, `taps` and `tapsDue` (how many of the round's players have tapped, out of how many; never which), `everyoneGuessed` (`taps === tapsDue`), `sheet` (earlier cards with your own guesses), `talkingOrder` (call mode) |
| `reveal`, `summary` | `cards`: every card's `id`, `text`, `revealed`, `yourGuess`; a revealed card adds `by` (seat or `"ghost"`), `mask` (the author's, `"blank"` for the ghost), `sameAs` (other authors of an identical answer), `guesses` (everyone's), `right`. `summary` adds `points` (seat: `correct`, `fooled`, `perfect`, `total`) |
| `over` | as `summary` when the round was guessed, otherwise null; the view also has `result` |

The host's view adds `asks` (`[{ id, text }]`) while reading or guessing.
A watcher (late joiner) and anyone unknown (a big screen) get what a player who wrote nothing gets, with no "yours" marker; a watcher also gets chips and its own guesses.
Watchers' guesses are not in the tap count.

What a view never holds: another seat's answer before writing closes; any answer text in room mode before guessing reaches it (except the reader's list); a card's author before its reveal; which seats have tapped during guessing; a skipped card's text or author, ever; anyone else's guesses before the reveal; the seed, the generator, the deck or the ghost answers.
`test/secrecy.test.js` checks these for every phase and viewer, and checks that two matches in which two seats swapped what they wrote look identical to every other viewer until those cards are revealed (and to the end when they are skipped), including when those two seats tap (one decoys where the other guesses).
`test/leaks.test.js` holds the independent review's reproductions as regression tests.

Card ids are a hash of a key derived from the seed (apart from the generator), the round and the card's position, so they say nothing about the generator's later draws (the ghost choice, later shuffles) and nothing about who wrote a card or when.

## Scoring

As the rules, section 5: +1 per answer matched to its author, +1 to an author for each player who pinned their answer on someone else (pinning it on "The game" counts), +2 for a perfect sheet: every answer you placed was right (at least one placed; a card you missed by the timer does not spoil it).
The ghost scores nothing and cannot be fooled; a skipped card scores nothing for anyone; identical answers count either author as right for either card.
`result(state)`: `rows` (best first: seat, mask, score, correct, fooled, left, joinedRound, place), `winners` (ties share), `awards.bestMask` and `awards.mindReader` (`{ seats, count }`, tied seats in row order), `watchers` (side scores), `early`, `roundsPlayed`.
`standings(state)` gives the kit its places.

## Answer text: what the page must do

`tidyAnswer` stores plain text: it removes control and format characters (including bidi overrides and zero-width characters), emoji and other unreadable symbols, piles of combining marks, and collapses whitespace, but it keeps `<`, `>`, `&`, quotes and every other printable character as typed.
So a page must render answers (and prompts and notes) as text only: `textContent` or a framework's text binding, never `innerHTML`, `insertAdjacentHTML`, `document.write` or an attribute built by string concatenation.
The 80-character limit counts code points after tidying; the page's text box should use the same limit (`maxLength` in the writing view) and keep a half-typed answer in the page itself across a reload (the rules, section 7).

## Ghost answers

The ghost answers live in `questions.js` and are never sent to a page (`promptsForPage()` is the safe list), as rule 10 asks.
But this repository is public, so anyone who reads `questions.js` can see every ghost answer and recognise "The game" card.
That is accepted for now: it is a game among friends, and someone who studies the source before game night is only spoiling their own fun.
If that ever matters, the ghost answers move to private storage the server reads at start-up.
They are written to read the same to American and British players.

## Departures from the rules

1. **Hard deadlines.** The rules make every timer soft and leave closing to the host ("Nothing happens automatically").
   This module keeps the soft timers and adds a hard deadline at every step, because a host whose phone died or who walked away would otherwise stop the room for good.
   The numbers are in the Time table: writing closes 180 s after it opens; reading starts guessing after 180 s; a guessing step closes 90 s after it opens (60 s at 7 or 8 players); each reveal tap and the summary move on after 180 s.
   Each one closes the step with a visible note; nobody loses points for it.
2. **A count of taps instead of a tick per player** during guessing (rules, step 4 and secrecy rule 9, which ask for a yes/no "has guessed" per player and no counts).
   A tick per player gives the author away: the author has nothing to tap, so the last unticked seat is the author.
   So the public sees only how many have tapped, the author counts through a decoy tap their page sends, and the note after a closed guessing step gives only how many were missing.
3. **The last name is filled in on the last card only.** The rules say so; the earlier code also filled it in for anyone with one name left, which on the second-to-last card is exactly the last card's author.
   So a guesser whose own card is last taps their single remaining name by hand on the second-to-last card.

## Choices made where the rules were open

1. **The perfect-sheet bonus** needs at least one placed guess; a missed card does not count against it.
2. **Watchers' side score** is +1 per right guess, nothing else; their wrong guesses fool nobody, and their taps are not in the count.
3. **A player who left** keeps earning fooling points from their answer still in play, keeps a row in the result with no place, and takes no title. They cannot rejoin the same match (`join` refuses `left`).
4. **The host leaving** passes the host to the first player still here; the room can also name one with `{ t: "host" }`.
5. **Masks.** The eight are shuffled and dealt in seat order; a late joiner gets a random free one, or none (`null`) if all eight are taken. The ghost's card lifts to a `"blank"` mask.
6. **Capitals.** "Mostly capitals" means at least 4 cased letters, over two thirds of them upper case ("NASA rocks" stays). Only a single trailing full stop goes ("Wait..." stays).
7. **Too long** is refused, not cut, after tidying.
8. **Duplicates are revealed together**, at the first of them in the order, so "Great minds" shows both authors at once.
9. **The reveal's last tap** shows the summary; reveal starts with nothing shown.
10. **Default rounds** is 5 at every size. The rules also mention a default of 4 at 7 or 8 players, but 4 is not one of the choices (3, 5, 7, everyone), so the module keeps the one default.
11. **Deck.** The chosen pack (filtered to family-safe prompts when `family` is on) is dealt first, then the rest of the deck under the same filter; only if a match ever used every prompt would it reshuffle (with a note).
12. **Talking order in call mode** is the round's players in seat order, starting one later for each card.
13. **End writing / End it now** is accepted from the host at any time; the page shows the button once `overdue` is set.
14. **Prompt changes after review.** Cut: `confess-13` (a lie to get out of plans) and `group-16` (something one of us always says). Reworded: `confess-10` (what you would miss most if your phone vanished for a week), `confess-16` (something you always carry that nobody would guess), `group-13` (the nickname strangers would give our group), `explain-03` (the strangest thing you have ever found), `confess-06` (no whistling or fitted-sheet examples, which primed the same answer), `ifwe-13` (a café, not a pub). `explain-13` and `explain-14` are now family-safe.

## At the Table: the page and the steps around the rules

`index.js` hangs the game on the Table's list (`TURN_GAMES` in `games.js`), through `at-table.js`, which wraps the rules in two steps of its own:

- **setup**, before the match: the seats are dealt in, and the host picks the rounds (3, 5, 7 or everyone reads once), the pack, family-safe prompts and call mode, then taps Deal the masks (`{ t: "choose", ... }`, `{ t: "begin" }`).
  The Table has no settings step of its own (a Table game may not have `settings`), so the choices live here.
  Someone who arrives now is dealt in, up to 8; a seat that goes is dropped, and below 3 the game ends with no points.
  It begins by itself with the choices as they stand after `SETUP_MS` (180 s).
- **curtain**, after the rules say `over`: the final standings and the titles stay up until the host taps Back to the Table (`{ t: "close" }`), or `CURTAIN_MS` (120 s).
  Without it the room would put every page back at the Table the moment the match ended, and nobody would see the final screen.

The match itself is the rules exactly; every move in it is theirs.
`test/at-table.test.js` covers both steps through the Table's adapter.

The page is `party/public/games/paper-masks.js` and `.css`, with the owner's paintings in `party/public/games/paper-masks/art/` (made by `tools/make-art.mjs`, which snaps and cleans the alpha, resizes in premultiplied form and bleeds the edge colour, so no fringe shows) and two self-hosted OFL fonts.
It renders everything typed as text only, sends the author's decoy tap only on a real tap, shows the tap count as anonymous dots, marks nothing as the reader's own in the list, and keeps a half-typed answer on the device only.
`test/e2e-paper-masks.mjs` (`npm run test:paper-masks`, in the pre-deploy gate) plays three whole matches in real browsers and checks every message each page receives, and each page's whole document, against the secrecy rules.

## For the Table that hosts it

- **The seed must be secret.** Pass a fresh secure seed (`newSeed()` from the kit's `rng.js`), not the room's round seed, which the kit's contract says a game with secrets must not draw them from. Keep the state server side; send only `view`.
- **Map the kit's hooks:** `create({ seats, now, settings })` calls `create(seats, settings, newSeed(), now)`; `input(state, seat, data, now)` calls `apply` and returns `{ ok: false, error: refused, message }` on a refusal; `nextDeadline` as is; `tick(state, now)` applies `{ t: "tick" }` as `SYSTEM`; `snapshot(state, now, viewer)` is `view(state, viewer.seat)` for a player and `view(state, -1)` for a screen; `isOver` is `done`; `standings` as is. The state is plain JSON, so no `serialize` is needed.
- **Leaving.** The kit ends a turn-based game when a seat is gone for good (`abandon`). Paper Masks is meant to go on: the Table should apply `{ t: "leave", seat }` instead and let the match continue (it ends by itself below 3 players).
- **Late joiners** are `{ t: "join", seat }`; their seat then gets the watcher view and may guess.
- **The host** of the game is the room's picker; send `{ t: "host", seat }` when it moves.
- **Server logs** must never print an answer next to its author (rule 17): log refusals by code, not the state.
- **Seats.** The Table seats up to 8, the same as this module's 3 to 8; `test/scoring.test.js` plays a full 8-seat match and scores an 8-seat round by hand.
