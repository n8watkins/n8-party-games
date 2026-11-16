# Agent notes for n8-party-games

The party site and the room kit behind it, live at https://partygames.n8builds.dev on Cloudflare Workers.
Read `README.md` for what is here and `DEPLOY.md` before any deploy or rollback.
The global rules file (branches, pull requests, no merging without the owner's word, `trash` instead of `rm`, secrets only through `pass-env`) loads by itself and is not repeated here.

## Ports

- 8791: `npm run dev` and `npm run dev:lan`, the everyday local server (`wrangler dev --local --env local`).
- 8792: the wall as production hangs it, with `--var PARTY_TEST_GAMES:off` (see `lobby/README.md`).
- 8804: the production-settings check in `DEPLOY.md` (`wrangler dev --env=""`, then `npm run test:production`).
- 8853: `npm run predeploy` starts its own server here (`PREDEPLOY_PORT` changes it), so it never collides with a dev server on 8791.
  On the card (`TEST_GPU=1`) it also takes 8855 and 8856 (`PREDEPLOY_PORT` + 2 and + 3), one server per step, or a free port if one is taken.
- 8850 to 8854: handed out to build agents for their own servers.
  Use only the range your brief gives you, and stop the server when you finish.

## Run and test

- `npm ci`, then `npm test`: the unit tests (vitest, about a second).
  This is the check every pull request must pass.
- `npm run dev`, then the end-to-end scripts against that server: `npm run test:room` and `npm run test:lobby` (plain sockets, no browser), `npm run test:cork` (a headless browser, about four minutes), and the rest of the `test:*` scripts listed in `package.json`.
  Each script takes `--base=http://localhost:PORT`.
- In software (no `TEST_GPU`), run one browser test at a time.
  The PC was overloaded once by three software browser runs at once, and Blender renders must not overlap with them.
- Browsers run headless and muted.
  The Windows-Chrome playtest (`npm run playtest:battle`) is run by hand on the owner's PC.
- `TEST_GPU=1` makes the browser suites draw on the PC's graphics card instead of in software (`lobby/test/browser.mjs`: a private, invisible Xvfb display and Mesa's D3D12 driver, never the desktop).
  It takes far less CPU; agents on this PC use it for the browser suites and the gate (`TEST_GPU=1 npm run predeploy`), unless told the card is off limits.
  Without it nothing changes, and CI on GitHub's runners (no card) never sets it.
  If the card or Xvfb is missing, or WebGL still draws in software, the run fails at once with the reason.
- The card is shared with the owner's desktop and with Blender renders.
  Four GPU test jobs may draw at once (`DEFAULT_CARD_SLOTS` in `lobby/test/browser.mjs`; one lock file per slot, `/tmp/test-gpu-1.lock` to `/tmp/test-gpu-4.lock`).
  A fifth waits its turn, first come first served, and says so: "waiting for a card slot, 2 ahead".
  `TEST_GPU_JOBS=N` changes the number of slots; do not raise it to get around a wait.
  Why four (measured on the owner's RX 7800 XT on 2026-11-15, `GPU-PLAYBOOK.md` in the private ops repo): copies of `e2e-room-pick` at once scale almost in step up to six, fail now and then from eight, and at twelve some browsers do not get the card at all; heavy drawing fills the card at three or four, past which the owner's desktop shares a full card.
  Four is half the point where failures start, takes about 3 GB of the 10 GB of video memory free, and 2.6 of the 14 CPU threads.
  A plain `flock /tmp/test-gpu-1.lock <command>` holds one slot of the four, not the card: up to three tests still draw beside it.
  Work that needs the card to itself (a render, an image or language model) runs through the owner's `gpu-run --kind blender|image|model`, which holds every slot, so no test draws beside it.
  `TEST_NO_GPU=1` keeps every test off the card, whatever else is set: the one switch when the card is busy or misbehaves.
- Some browsers stay on software even with `TEST_GPU=1`: the still tools (`shoot*.mjs`, `weigh-baked.mjs`), whose pictures are for a person or compared with earlier ones; the browsers that stand for a device without hardware 3D (`e2e-feel`, `e2e-emotes`, the plain browser in `e2e-leave-rooms`), since a card gets the 3D look instead of the flat one; and `party-kit/test/e2e-turnstile.mjs`, which ships to game repos.
  GPU pixels differ from software ones and can change with a driver update, so any stored-image comparison must run on software.
- `npm run predeploy` runs the full gate: unit tests, then `test:room`, `test:lobby` and `test:cork` against its own server, one after another.
  The same script is the GitHub workflow `predeploy-gate`.
- One gate runs at a time on this machine: a second one waits for the first and says so (a flock on `$TMPDIR/n8-party-games-predeploy.lock`), so two gates never pick the same port.
- On this PC the fastest safe way is `TEST_GPU=1 npm run predeploy` (or `TEST_GPU=1 npm run deploy`): the unit tests run first, then the three steps run side by side, each against a local Worker of its own with empty storage, and the gate takes about as long as its slowest step, `test:cork`.
  Measured on 2026-11-15: 221 and 236 s side by side on the card, against 614 s one after another on the card and 637 s in software (2,172 CPU seconds in software, about 320 on the card).
  Most of the gain is `test:cork` on a server of its own: it no longer waits minutes for the earlier steps' rooms to go quiet before it reads the room budget (415 s after the other steps, 212 to 226 s alone).
  Each step's output is printed whole when it ends, then a table of every step's time; the first failure stops the others and fails the gate.
  `PREDEPLOY_SEQUENTIAL=1` keeps the steps one after another on the card.
  Without `TEST_GPU` the gate is one after another, exactly as on GitHub's runners, because a software browser beside other work loads the whole PC.

## The CI policy

1. A pull request runs small, targeted checks: `npm ci` and `npm test` on GitHub's hosted runners (`pr-checks`).
2. Merging runs nothing more.
3. The full suite (`npm run predeploy`, or the `predeploy-gate` workflow) runs once before a deploy, on the combined result of everything merged.
4. Merges and deploys both happen only on the owner's word.

## Deploying

Deploys run from the owner's PC, never from CI.
The short form, with the full checklist in `DEPLOY.md`:

1. On `main`, up to date, `npm ci`, then the manual checks in "Before every deploy".
2. `npx wrangler whoami` names account `b2c564cf83cb9184dd6d7cc4ff8b38bf`.
3. `npm run deploy` (it is `wrangler deploy --env=''`; never deploy `--env local`).
   npm runs a script named `pre<name>` before `npm run <name>`, so `npm run deploy` runs the whole gate (`predeploy`) first by itself and stops if it fails.
   Do not run `npm run predeploy` before it: that runs the gate twice.
   `npm run predeploy` alone runs the gate without deploying.
   In an emergency, and only on the owner's word, `npx wrangler deploy --env=''` deploys without the gate.
4. The checks in "Check it after a deploy".
5. If it is wrong, "Rolling back" in `DEPLOY.md`.

An agent never deploys or rolls back without the owner saying so in that session.

## Lanes

The plan is `PARTY-GAMES-PLAN.md` in the private ops repo (n8watkins/ops).
Its section "The work, in lanes" is the source for what each lane owns, and `PARTY-GAMES-STATUS.md` in the same repo holds the live state.
Stay inside the files your brief names.
`party-kit/src/core/room-core.js` and `lobby/server/lobby-core.js` are shared ground: lanes take turns there.
Generated files and `CHANGELOG.md` are never edited by hand.

### The character interface

A piece is a character, and no draw site names one: each asks the character's definition.
A character is one entry in each of three lists, which a test keeps the same: `lobby/shared/characters.js` (the room's), `lobby/public/characters/index.js` (its emotes and flat drawing) and `lobby/public/look3d/characters.js` (its model, for the 3D and baked looks).
A lane that adds a character adds a definition; it does not edit `scene.js`, `bump-draw.js`, `room3d.js` or `room-baked.js`.
A lane that draws rooms reads a piece through the handles every model has, and never reaches into one character's parts: not a body's `mat` or `colour` (a ghost's are its white sheet), and a test scans every page file for it.
A rendered room gives a body its finish with the character's own `bake` and its floor reflection with `Reflection`, as `room-baked.js` does.
The interface, part by part, is in `lobby/README.md`, "Characters".

## Where things live

- `party-kit/`: the room kit (server core, client, tests, `GAME-CONTRACT.md`).
- `lobby/`: the party room.
- `one-device/`: games on one passed-around device, no server (Hot Potato; its matcher and lists in `one-device/hot-potato/shared/`, shared with `lab/hot-potato/`).
- `games.js`: the hosted games, each its own repository pinned in `package.json` (Cork & Bell is a git commit; bump it deliberately).
- `worker.js` and `wrangler.jsonc`: the Worker and its Durable Object migrations (`v1` to `v4`).
  A new migration changes what a rollback can do, so read "Rolling back" in `DEPLOY.md` first.
- `.github/`: the workflows and the predeploy script.
