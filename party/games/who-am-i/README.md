# Who Am I?: rules module for the Table

Each of two players is dealt a secret name: a famous person, a character or a brand mascot.
Your phone shows the name the other player is guessing, never your own.
You ask yes/no questions (or listen to clues), guess who you are, and the other player confirms the guess.

This folder is the pure rules and the names (server only); the page is `party/public/games/who-am-i.js` and `.css` (see "At the Table: the page").
It is the live game at whoami.n8builds.dev (`n8watkins/who-am-i`, `src/worker/engine.ts` and `src/worker/content`) remade in the shape every Table game keeps (`party-kit/GAME-CONTRACT.md`, "Games at the Table"; Paper Masks set it).
Where it departs from the live game, the departure is listed under "Differences from the live game".

| File | What it is |
| --- | --- |
| `rules.js` | `create`, `apply`, `view`, `nextDeadline`, `done`, `decided`, `result`, `standings`, `cleanOptions` |
| `deck.js` | The names, the packs, and the live game's rules for dealing two of them (with one more, below) |
| `deck-data.js` | The live game's 245 names with their hints and pictures. Generated: do not edit |
| `../draws.js` | The match's random draws: SHA-256 of the secret and a count (shared with Paper Masks) |
| `tools/copy-deck.mjs` | Copies the names from a who-am-i checkout again: `node party/games/who-am-i/tools/copy-deck.mjs [checkout]` |
| `index.js` | `game` (through `../table-game.js`) and `manifest`, listed in `games.js` (`TURN_GAMES`) |
| `test/` | Whole matches, timers and leaving, every refusal, secrecy properties, the names, and the game on the real party room |
| `test/e2e-who-am-i.mjs` | Three whole matches in real browsers with every secret checked (`npm run test:who-am-i`, in the pre-deploy gate) |

Everything is a pure function of plain JSON.
There is no clock and no hidden randomness: the room passes `now`, and every draw comes from the match's secret (`state.secret`) at a position kept in the state (`state.draws`; `../draws.js`).
It is on the Table's list (`games.js`, `TURN_GAMES`), in place of its "Coming soon" entry (`lobby/wall.js`, `TABLE_SOON`).
It is a Table game only (the owner's decision of 2026-11-16: the Floor and the Table are separate; it is not on the Floor's wall).
The front page's Table door plays it here, and its card links the live game at whoami.n8builds.dev as a second way to play (`site/home-data.js`, `ownSite`).

## The API

```js
import { create, apply, view, nextDeadline, done, result, standings, isRefusal, SYSTEM } from "./rules.js";

let state = create(seats, { host }, seed, now, { secret }); // seats: 2 to 8; secret: 128+ bits as hex
const out = apply(state, seat, { t: "guess" }, now);   // a new state, or { refused, message }
if (!isRefusal(out)) state = out;
view(state, seat);                                     // what that seat may see; -1 is a big screen
nextDeadline(state);                                   // when to send apply(state, SYSTEM, { t: "tick" }, now)
done(state) && standings(state);
```

`apply` never changes the state it is given, and a refusal leaves nothing behind.
`create` also takes the host's choices as options (below) and refuses bad seats or options the same way.

## Decisions

### Who plays

- **The owner's decision stands: a party of exactly two starts it.** `manifest.players` is `{ min: 2, max: 2 }`, so the Table's list says "For exactly 2" to a larger party, as its "coming soon" entry does today.
- **The rules already take a larger table** (2 to 8 seats), because the room deals in every connected phone and anyone may arrive later.
  With more than two seats, the setup step shows everyone, and the host picks the two who play; the rest watch.
  Raising `manifest.players.max` to 8 is all it takes to offer that; `test/at-table.test.js` plays a table of three on the real room that way.
- **The default pair** is the host and the next seat round the table (or the first two, if the host is not seated).
  The host does not have to play.
- **No rotation inside a match.** One match is one pair. When it ends everyone is back at the Table, and the host picks the game and the pair again.
  The Table's adapter carries nothing from one match to the next (no `carry`), so "whoever has not played yet" cannot be remembered by the rules; a rotation would be a page feature (the host's pick defaulting to who has not played tonight), not a rule.

### What a watcher and the big screen see

**Neither name, until the round's reveal.**
A watcher sees what the big screen sees: both players' scores, whose turn it is, the turn's questions, answers and hints, the timers, and each round's reveal with both names and pictures.
Showing watchers both names ("the audience is in on it") would be more fun for the room, but it cannot be made safe at the Table:

- a watcher's phone lies on the same table as the players, face up;
- a watcher may be a player's own second phone or tab (the room cannot tell people apart, only devices);
- the big screen is in plain sight of both players.

So no screen shows a name a player could read about themselves before the reveal.
The fun of the room is kept by the reveal itself, which everyone sees, and by the shared log of questions and answers.
This matches the owner's note of 2026-11-15 ("a late joiner sees the match without identities").

### Turn timers, and a match that never stalls

The Table's adapter passes the room's `presence` hook on as `{ t: "presence", seat, connected, away }`: a seat is **here** while its phone is connected and its page is shown.
The timers do not pause for an absent phone (as the live game does); every step has a deadline on the room's alarm, and nothing waits on one phone for ever:

| Step | Deadline | What happens at it |
| --- | --- | --- |
| Setup | 120 s | The match begins with the choices and pair as they stand |
| A turn (a move, in trade turns) | the host's timer: 60 s, 90 s (default), or "no timer", which is a 5-minute backstop with no countdown shown | Trade turns: the move ends (as live). Keep going: the turn ends as timed out (as live) |
| A guess waiting for confirmation | the turn's timer pauses; once the other player's phone has not been here for 30 s (counted from the guess at the earliest) the guesser may confirm their own guess (`selfConfirm`); at 120 s it lapses | The guess lapses as if rejected, with a note |
| The reveal | 90 s | The next round, or the end of a decided match |

Two more rules end a match nobody is playing:

- in trade turns, four timed-out moves in a row with no player here end the round as timed out for both;
- a whole round in which no player was here at any moment ends the match with no points (`ended.how: "idle"`).

A turn that runs out while the players are here is ordinary play: in a spoken match they may talk through every turn without a tap.

**Not checked on a phone:** a phone put face down with the page still open stays here, and the Table's page keeps the screen awake during a match (a screen wake lock), so a phone does not lock itself mid-conversation. A phone locked by hand hides the page (away), so two players who lock both phones for a whole round end the match as idle, and a guesser who locks theirs on their own turn forfeits after two minutes (below, "Hidden on your own turn"). A phone that cannot keep its screen awake (no wake lock, low-power mode) says so and is never charged for being hidden, only for dropping, as before.

### Leaving, dropping, reconnecting, reloading

- **Dropping and coming back, reloading, a restart of the room:** the room keeps the seat for its grace (two minutes at the Table) and the rules hear only that it is not here, then here again; `view` is a pure function of the state, so a phone that comes back gets exactly the view it had.
- **Hidden on your own turn** (another app, a text message, the lock screen, with the socket open): the rules export `needs(state, seat)`, true for the guesser whose turn it is while they ask, and for the other player while a question typed in the app waits for their answer (the guesser can neither guess nor pass until then), so the room runs that seat's grace (two minutes) while its page is hidden then, and gives it up as gone at the end of it (the owner's rule of 2026-11-15: "put a timer so they can't hide their page, and if they don't come back they just lose").
  Hidden while waiting (the other player's turn with no typed question waiting on you, a guess waiting to be confirmed, the setup, the reveal, a watcher) costs nothing: the clock is held still, and the time used on one's own turn waits for the next one. A move gives no time back; only time with the page shown does.
  This holds while the socket stays open: on iOS a lock often closes it, and that is a dropped phone, with the room's plain two minutes from the drop (never less, whatever was used on one's own turns before).
  The room trusts the page's word that it is hidden, and that it cannot keep its screen awake (`party-kit/GAME-CONTRACT.md`, "A screen kept awake, and the page's word").
  The other phone and the big screen show "Bo is away" and, while the clock runs, "back within 1:45 or the match ends"; the player who comes back is told how much was left, when that absence cost them anything (`party-kit/GAME-CONTRACT.md`, "One clock for a missing seat"; `lobby/test/party-room-table-away.test.js`).
- **Gone for good** (left the party, the phone gone past the room's grace, or hidden on one's own turn for the whole of it) reaches the rules as `{ t: "leave", seat }`:
  - a watcher just goes;
  - before the match begins, the table goes on without the seat (the default pair is worked out again), and ends with no points below two;
  - one of the two players, in a match not yet decided: **they forfeit**, and the player who stayed is first whatever the score (the owner's rule of 2026-11-15), even with their page hidden at that moment (another app, a locked phone: "something's gotta make you forfeit, go with something safe"); the unfinished round's names are revealed to everyone, and the room's card says it plainly ("Bo left, so Ann wins.");
  - the same, but the player who stayed has no phone connected either: nobody is there to win it, so the match ends with no places (`ended.how: "abandoned"`);
  - on the reveal that decided the match, whoever goes keeps the place the match gave them (the room keeps a seat that goes once the game says `decided`; `test/leaving-at-the-end.test.js`).
  - one of the two players, on the reveal of the round that decided the match: the match ends with its real places, the one who left placed with the rest (as the contract asks of a decided match).
- **The host** is the room's picker; when it moves the room sends `{ t: "host", seat }`, and the rules pass it to the first player still here when the host's seat goes.

### Scoring into the Tonight board

`standings(state)` gives the room its places, and the room turns them into points (3 for first, 2 for second).
They are given once the match is over, and already on the reveal of the round that decided it: `decided(state)` is true there, so through the Table's adapter the host's own "End the game" on that screen ends the match as finished and scores it once (`test/at-table.test.js`), and the page asks the Table to hide that button there (`ctx.decided`).
The winner of a decided match is first and the other second; a tie shares first.
A forfeit places only the player who stayed; an idle or abandoned match, or one that ended before it began, places nobody.
`result(state)` is a list of rows, best first, `{ seat, score, correct, skips, hints, left, place, forfeit? }`, so the room's end card shows each player's score beside their place.
Watchers never place.

## The state machine

| Phase | Who acts | It ends when | Then |
| --- | --- | --- | --- |
| `setup` | the host chooses, picks the pair and begins | `begin`, or the deadline | `playing`, round 1 |
| `playing` | the guesser asks, hints, guesses, passes or skips; the other player answers, confirms or rejects | trade turns: the first right guess, or both players out; keep going: both turns done | `reveal` |
| `reveal` | either player or the host taps `next` | `next`, or the deadline | the next round, or `over` when the match is decided |
| `over` | nobody | | |

The first guesser of round 1 is drawn from the match's secret; it then alternates every round (as live).

## Options (the host's choices in the setup step)

| Option | Choices | Default |
| --- | --- | --- |
| `pack` | `mixed`, `actors`, `movie-characters`, `historical-figures`, `video-games`, `brand-mascots`, `anime-cartoons` | `mixed` |
| `difficulty` | `easy`, `medium`, `hard` (the live overlapping pools) | `medium` |
| `mode` | `twenty_questions` ("Ask"), `describe_it` ("Clues") | `twenty_questions` |
| `turnFormat` | `trade` (one question and one guess a move; first right guess wins the round), `keep_going` (a whole turn each) | `trade` (Clues always keeps going, as live) |
| `timer` | `0` (no timer: 5-minute backstop), `60`, `90` seconds | `90` |
| `match` | `first-to-3`, `first-to-5`, `rounds-5`, `rounds-10` | `first-to-3` |
| `hints` | `true`, `false` | `true` |
| `questions` | `spoken`, `app`, `both` | `both` |

`view().setup.choices` lists them for the page, with each pack's name and description (`CHOICES`).

## Moves

Players send moves as their own seat number; the room sends its own as `SYSTEM`.

| Move | Who | When | What it does |
| --- | --- | --- | --- |
| `{ t: "choose", ...options }` | the host | `setup` | Changes any of the options above |
| `{ t: "pick", seats: [a, b] }` | the host | `setup` | The two who play, from the table |
| `{ t: "begin" }` | the host | `setup` | Begins the match |
| `{ t: "ask", text }` | the guesser | asking, not `spoken` | A typed yes/no question (1 to 140 characters, tidied, at most 6 a minute; trade: one a move; never while one waits for its answer) |
| `{ t: "answer", id, answer }` | the other player | a question waiting | `yes`, `no`, `sort_of` or `dont_know` |
| `{ t: "count" }` | either player (trade: the guesser) | asking, Ask mode | One more question asked out loud, on the counter (trade: one a move) |
| `{ t: "hint" }` | the guesser | asking, hints on | The next of three hints about their own name, into the shared log |
| `{ t: "guess" }` | the guesser | asking (trade: no question waiting) | "I guessed it": the turn's timer pauses for the other player's judgement |
| `{ t: "confirm" }`, `{ t: "reject" }` | the other player | a guess waiting | Right: a point, and the turn (trade: the round) is won. Wrong: back to asking; trade: the move ends |
| `{ t: "selfConfirm" }` | the guesser | a guess waiting, the other phone not here for 30 s (`selfConfirmAt`) | The guesser confirms their own guess |
| `{ t: "pass" }` | the guesser | asking, trade turns, no question waiting | Ends the move |
| `{ t: "skip" }` | the guesser | their turn | Gives up on this round |
| `{ t: "next" }` | either player, or the host | `reveal` | The next round, or the end |
| `{ t: "tick" }` | `SYSTEM` | any time | Acts at the deadline (the table above); harmless before it |
| `{ t: "join", seat }` | `SYSTEM` | not `over` | Before the match: onto the table, may be picked. After: a watcher |
| `{ t: "leave", seat }` | `SYSTEM` | not `over` | A seat gone for good (above) |
| `{ t: "host", seat }` | `SYSTEM` | not `over` | The room's host moved |
| `{ t: "presence", seat, connected, away }` | `SYSTEM` | not `over` | Who is here changed |

Every refusal code: `bad_seats`, `bad_option`, `bad_secret`, `bad_host`, `bad_move`, `not_system`, `over`, `not_now`, `not_host`, `not_playing`, `not_your_turn`, `not_guesser`, `not_judge`, `bad_pick`, `spoken_only`, `ask_mode_only`, `not_trade`, `one_question`, `question_waiting`, `not_text`, `too_long`, `empty`, `rate_limited`, `no_question`, `answered`, `bad_answer`, `hints_off`, `no_hints_left`, `confirming`, `no_guess`, `too_soon`, `judge_here`, `already_in_game`, `full`.
Each comes with a sentence for people (`message`); `test/refusals.test.js` earns every one.

## Views

`view(state, seat)` is the only thing a phone may be sent.
Every view has `game`, `phase`, `round`, `options`, `match` (`{ points }` or `{ rounds }`), `trade`, `host`, `until` (the setup or reveal deadline), `you` (`seat`, `role`: `player`, `watcher` or `screen`; `host`), `players` (seat, score, correct, skips, hintsUsed, left), `watchers` and `notes`.

| Phase | Adds |
| --- | --- |
| `setup` | `setup`: `pool` (everyone at the table), `pick` (the two), `choices`, `timers` |
| `playing` | `order` (first and second guesser), `results` (this round so far), `turn` (`seat` of the guesser, `phase` `asking` or `confirming`, `deadline`, `paused`, `timed`, `questionCount`, `hintsUsed`, `hintsLeft`, `log` (the latest 50 entries), `moveAsked`, `questionWaiting`, `confirmSince`, `selfConfirmAt`, `lapseAt`); for a player only, `opponent`: `{ seat, name, pack, picture }`, the name the OTHER player is guessing |
| `reveal` | `reveal`: `round`, `matchOver`, `entries` (each player's `seat`, `name`, `pack`, `picture`, `result`, `hints`, `questions`) |
| `over` | `result`, and `reveal` for the last round played (the unfinished one after a forfeit) |

A `result` per round is `correct`, `skipped`, `timed_out`, `beaten` (the other player got it first in trade turns) or `unfinished` (a match that ended mid-round).
Notes: `began` (`how`: `host` or `time`), `reshuffled`, `timed_out`, `guess_lapsed`, `self_confirmed`, `watching`, `left`, `host_passed`, `ended` (`how`: `decided`, `forfeit`, `abandoned`, `idle`, `too_few`).

## How each secret is kept, and the test that proves it

- **Your own name** is read in exactly two places: `hint` (the guesser's own hint, shown because they asked for it) and the reveal.
  `view` reads only the other player's name for a player, and no name at all for anyone else, while a round is on.
  `test/secrecy.test.js` plays 300 random matches from 300 seeds (every kind of move, watchers arriving, players leaving, two to four seats), and checks every view of every state for every viewer (each player, each watcher, a player who left, the big screen, an unknown seat): a player's view holds the other's name and never their own (name, any alias as a whole word, id, slug or picture address); a watcher's and the screen's hold neither.
  A sanity test proves the check finds a name hidden as text, in a sentence, as an alias or as a picture address.
- **No difference at all.** For thousands of states, swapping a player's own name for another leaves that player's view identical, and swapping both names leaves a watcher's and the screen's identical; a whole match played twice with different names for one seat looks the same to that seat at every step, with the same deadlines.
  (A hint is about your own name by design, so states after the viewer asked for one are left out of that comparison.)
- **One name giving the other away.** The live lists hold pairs where what one player's phone shows names the other player: "Link from The Legend of Zelda" says "Zelda" to Princess Zelda's player; Princess Zelda's picture is the file `Link_to_the_Past_Zelda.png`; Katniss Everdeen's picture is a file named after Jennifer Lawrence; also The Joker and Batman, Tails and Sonic, Donkey Kong and King Kong, and a few more.
  `deck.js` (`mentions`, `pairable`) never deals two names together when the name, hints or picture of one names the other or an alias of it (picture addresses read with their percent-encoding undone, and a name of six letters or more found inside an author credit's run-together words, as "Kingkongphoto" on Robin Williams and Nelson Mandela); `test/deck.test.js` checks the pairs, and the random matches found the first one.
  Pairs that give each other away in other words (a hint about Dr. Eggman describes Sonic; Snoopy's names "Peanuts") are kept apart by a hand-kept list, `BLOCKED_PAIRS`; add to it when a new one turns up.
  Every name stays dealable in every pack and level (`test/deck.test.js`).
- **Ids say nothing.** Names have no id in any view (a page gets name, pack and picture).
  Question and hint ids are plain counts (`q1`, `h2`): nothing secret goes into them, and they are the same whoever was dealt what (`test/secrecy.test.js`, "ids and order say nothing").
- **The deal comes from a real secret.** The room's seed is 32 bits and a page may learn it; an earlier version drew names from it and a 32-bit generator, so one entry id (or a few revealed names) let a player search for the seed and replay their own name.
  Now the Table's adapter draws 256 bits from `crypto.getRandomValues` for each match and the rules draw from it alone: draw n is SHA-256("who-am-i/draw/n/secret") (`draws.js`), a keyed stream that names revealed so far say nothing about.
  SHA-256 is written out in the module because the rules are synchronous and `crypto.subtle.digest` is not; the tests check it against `node:crypto`.
  `test/secrecy.test.js` checks that the room's seed does not change the deal, that the review's search finds nothing, that no view holds any part of the secret or of a draw, and that a match restored from its saved state deals on exactly as before.
- **Order and counts.** Whether the pack reshuffles is settled from the names already revealed, before anything is drawn, and dealing calls the generator the same number of times whatever comes out (`test/deck.test.js`).
- **Timing.** The rules keep no timers; every deadline is a fixed offset from a move or a tick, never from a name.
- **The secret** is kept in the state, which only the server holds, and no view holds it, the draw count, the deck or the assignments (`test/secrecy.test.js`).
- **Through the room:** `test/at-table.test.js` scans every frame each socket of a real party room receives during a whole match: no phone hears its own name before the reveal, the big screen hears neither, a late joiner hears neither; a reconnect, a reload and a restart keep it so.

The names live in `deck-data.js`, server only (nothing in `party/games` reaches the site), but this repository is public, as the who-am-i repository is: anyone can read the lists.
That is no help in a game: you do not know which of 245 names you were dealt.

## For the page builder

- **Mount at the Table** (`manifest.table.view`, `games/who-am-i.js`, in `party/public/games/`), upright, a phone each; read only the view you are given.
- **Your own name:** show "Your name: hidden" during a round; the view has no field for it. Show `opponent` (name, picture with its credit) big on a player's phone.
- **Watchers and the big screen** have no `opponent`: show the log, scores, whose turn, the timers, and the reveal.
- **Pictures** load from `upload.wikimedia.org` (the party's page needs that host in `img-src`, with no referrer, as the live site does), and carry their credit (`author`, `license`, `filePage`); `free: false` pictures are non-free images from Wikipedia articles.
- **Timers:** show `turn.deadline` as a countdown only when `turn.timed`; while confirming show `selfConfirmAt` (null while the other phone is here; otherwise the guesser's "Confirm it myself" button appears then) and `lapseAt`. `until` is the setup or reveal deadline.
- **Questions:** render question text as text only (`textContent`), never as HTML; 140 characters; the in-app answer buttons are Yes, No, Sort of, Don't know.
- **Trade turns:** after one question (typed or counted) the guesser may guess or pass; a wrong guess ends the move.
- **The setup step** is the host's form (choices, the pick for a table of more than two, Begin) with the time left; everyone else sees the choices as they stand.
- **Send moves with ids** (`inputId()`): a tap sent twice is answered, never applied twice.
- **The end:** the room shows its own card with places and scores; the last snapshot holds the final reveal.

## Differences from the live game

1. **Who plays:** the live game seats exactly two in its own room; here a party's table of 2 to 8 is dealt in, the host picks the two, and the rest watch with no names shown (the live game has no watchers).
2. **The host's choices** come in a setup step inside the match (the Table has no settings step), with a 120-second deadline; the live game has a lobby with ready buttons and a Start the host must tap.
3. **No "who starts" setting:** the first guesser is drawn at random, then alternates (live: me, my opponent or random; rematches start with the loser).
4. **No per-player difficulty:** one level for the match (live: each player may pick their own).
5. **No rematch vote:** the match ends and everyone is back at the Table, where the host picks again; the next match draws fresh names (live: a one-tap rematch that avoids the last match's names).
6. **Match lengths:** first to 3 (default), first to 5, 5 rounds or 10 rounds (live: first to 5 or 10 rounds).
7. **The timer:** 90 s by default, and "no timer" still has a 5-minute backstop (live: no timer by default, and none at all when off).
8. **Absent phones:** the live timer pauses while a player is disconnected or away and the host may confirm their own guess after the other has been gone 30 s. Here the timer runs, the guesser (host or not) may confirm their own guess once the other phone has been gone 30 s, and an unanswered guess lapses after 2 minutes.
9. **Idle tables end:** four timed-out moves in a row with no player here end a trade round, and a round with no player here at all ends the match with no points (the live game would go on until its room expired).
10. **Leaving:** a player who leaves forfeits and the other is first, even with a hidden page, or nobody places when the other has no phone connected either (live: leaving sends the room back to its lobby).
11. **Dealing:** two names are never dealt together when one's name, hints or picture names the other (live: only names that could be mistaken for each other are kept apart); and whether the pack reshuffles is decided before the draw.
12. **Question text:** a tab or line break in a typed question becomes a space (live: removed, joining the words on either side); more invisible characters are removed (the soft hyphen, the Arabic letter mark, U+2060 to U+2064, tag characters, and the zero-width joiner outside emoji), a character keeps at most three combining marks, and a turn's log keeps its latest 50 entries.
13. **No version numbers or expected-version checks:** the room's answered inputs (ids) do that job.
14. **Pictures:** on for every name that has one; the live site's switch (`PICTURES=off`) is `PICTURES_ON` in `deck.js` here, since the rules see no environment.

## At the Table: the page

`party/public/games/who-am-i.js` and `.css`, with Nunito (OFL, `party/public/games/who-am-i/fonts/`), in the live game's look: its purple, its question-mark mark, the "Answer as" headband card, chat bubbles for questions and amber rows for hints, light or dark with the phone's setting.

- **Setup:** the host's form (category, level, mode, turns and questions for Ask, match, timer, hints, the pick for a table of more than two) with Start the game and the time left; everyone else sees the choices as they stand.
- **A turn, the guesser:** the other player's name small at the top, "Your name: hidden", the log, and at the bottom the suggested questions, a box, "+1 asked out loud", Hint, Pass (trade) or Give up, and I Guessed It. While a guess waits: the time left to confirm it, and, once the other phone has been away 30 s (`selfConfirmAt`), Confirm it myself.
- **A turn, the other player:** the name to answer as, big, with its picture and credit; Yes, No, Sort of, Don't know for a typed question; Not quite or Yes, correct for a guess; "+1" in keep-going Ask.
- **A watcher and the big screen:** whose turn it is, the log, the scores, the timer; never a name. The big screen fills the rest of the screen and never scrolls (the turn on the left, the log on the right).
- **The reveal:** both names with pictures, each result, hints and questions, the scores, Next round (either player), and the time until it goes on by itself. On the reveal that decides the match: who won, and Back to the Table.
- **Secrecy on the page:** nothing is stored on the device (no names, hints, questions or drafts; a half-typed question lives in its box only); every name and question is set as text; pictures load only from `https://upload.wikimedia.org/` with no referrer; the site's CSP allows that one host, for images only, on the Table's pages (`/party/*`) only (`scripts/build-public.mjs`, `PICTURE_HOST` and `TABLE_PAGES`; `party-kit/test/deploy-config.test.js`).
- `test/e2e-who-am-i.mjs` checks every message each page receives, and each page's whole document and storage, after every step; and compares a player's screen in the same role in two rounds (two different own names), element for element and box for box.

### Differences from the live game's screens

- No lobby, ready buttons, invite or QR code: the Table does that. The host's choices are a setup step in the match.
- No rematch, share card or "Change settings" at the end: Back to the Table, where the host picks again.
- No sound toggle, theme switch or footer: the Table has its own bar; the theme follows the phone.
- Pack tiles are plain choice buttons (no pack art); a name with no picture shows its initials on a pack colour, not the live portrait art.
- The guesser's view of the other player's name is a small card that is always open (live: a collapsible row).
- The opponent-away banner is replaced by the self-confirm countdown, which is what the rules time from.
- Watchers and the big screen are new: the live game has neither.

## What was not checked

- The page was seen in headless Chromium only (Android user agent, touch), not on a real phone or in Safari.
- Pictures were served by the test in place of upload.wikimedia.org (the CSP and no-referrer were checked against them); the real addresses were not loaded.
- The deck was copied from who-am-i `main` at `7afaad4` (199 pictures of 245, as live); the pictures' addresses were not fetched.
- How a locked phone behaves at the Table (away with its socket open, or dropped) decides whether a talking game survives phones put down on the table: locked phones are not here, so both locked for a whole round end the match as idle; one dropped for two minutes forfeits. That needs one real-phone check.
