# Agent notes for n8-party-games

The party site and the room kit behind it, live at https://partygames.n8builds.dev on Cloudflare Workers.
Read `README.md` for what is here and `DEPLOY.md` before any deploy or rollback.
The global rules file (branches, pull requests, no merging without the owner's word, `trash` instead of `rm`, secrets only through `pass-env`) loads by itself and is not repeated here.

## Ports

- 8791: `npm run dev` and `npm run dev:lan`, the everyday local server (`wrangler dev --local --env local`).
- 8792: the wall as production hangs it, with `--var PARTY_TEST_GAMES:off` (see `lobby/README.md`).
- 8804: the production-settings check in `DEPLOY.md` (`wrangler dev --env=""`, then `npm run test:production`).
- 8853: the gate (`npm run gate`, and `npm run deploy` through `predeploy`) starts its own server here (`PREDEPLOY_PORT` changes it), so it never collides with a dev server on 8791.
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
  It takes far less CPU; agents on this PC use it for the browser suites and the gate (`TEST_GPU=1 npm run gate`), unless told the card is off limits.
  Without it nothing changes, and CI on GitHub's runners (no card) never sets it.
  If the card or Xvfb is missing, or WebGL still draws in software, the run fails at once with the reason.
- The card is shared with the owner's desktop and with Blender renders.
  The card counts browsers, not jobs: three card browsers may draw at once, each holding one token (`DEFAULT_CARD_SLOTS` in `lobby/test/browser.mjs`; one lock file per token, `/tmp/test-gpu-1.lock` to `/tmp/test-gpu-3.lock`).
  A fourth waits its turn, first come first served, and says so: "waiting for a card token, 2 ahead".
  `TEST_GPU_JOBS=N` changes the number of tokens; the owner raises it (4, 5) as measured runs allow; do not raise it to get around a wait.
  Why (measured on the owner's RX 7800 XT on 2026-11-15, `GPU-PLAYBOOK.md` in the private ops repo): real suites ran fine to about six browsers at once and failed now and then from eight; heavy drawing fills the card at three or four, past which the owner's desktop shares a full card.
  Under a job that holds tokens (`gpu-run`, or the gate), a browser draws only on that job's tokens (`TEST_GPU_TOKENS`), never on more.
  The gate side by side holds three tokens itself, so at most three of its card browsers draw at once; the steps without a card browser run beside them.
  Run the gate through `gpu-run` and give it its three: `gpu-run --label gate --kind browser-test --tokens 3 --admit-timeout-runs -- npm run gate`.
  There `gpu-run` first waits for the card to settle (load, video memory, heat, recent driver events), and `--admit-timeout-runs` makes a busy card delay the gate, never fail it.
  Run bare (`TEST_GPU=1 npm run gate`, and `npm run deploy`, which runs the gate first), the gate gets no such check: it takes its tokens and starts whatever the card's state.
  The cap of three only fully holds once every checkout that runs card tests has this helper: an older `lobby/test/browser.mjs` (another worktree, an older branch) counts four slots and takes them without the gate, so beside it one more browser can draw.
  Another repo's Playwright run on the card with N workers is N browsers: run it as `gpu-run --tokens N ...`.
  A plain `flock /tmp/test-gpu-1.lock <command>` holds one token, not the card: the other tokens still draw beside it.
  Work that needs the card to itself (a render, an image or language model) runs through the owner's `gpu-run --kind blender|image|model`, which holds every token, so no test draws beside it.
  `TEST_NO_GPU=1` keeps every test off the card, whatever else is set: the one switch when the card is busy or misbehaves.
- Some browsers stay on software even with `TEST_GPU=1`: the still tools (`shoot*.mjs`, `weigh-baked.mjs`), whose pictures are for a person or compared with earlier ones; the browsers that stand for a device without hardware 3D (`e2e-feel`, `e2e-emotes`, the plain browser in `e2e-leave-rooms`), since a card gets the 3D look instead of the flat one; and `party-kit/test/e2e-turnstile.mjs`, which ships to game repos.
  GPU pixels differ from software ones and can change with a driver update, so any stored-image comparison must run on software.
- `npm run gate` runs the full gate on any tree: unit tests, then `test:room`, `test:lobby`, `test:cork`, `test:hot-potato` and `test:hearing` against its own server, one after another.
  The same script is the GitHub workflow `predeploy-gate`.
- One gate runs at a time on this machine: a second one waits for the first and says so (a flock on `$TMPDIR/n8-party-games-predeploy.lock`), so two gates never pick the same port.
- On this PC the fastest safe way is `TEST_GPU=1 npm run gate` (or `TEST_GPU=1 npm run deploy`): the unit tests run first, then the five steps run side by side, each against a local Worker of its own with empty storage, and the gate takes about as long as its slowest step, now `test:hot-potato`.
  Measured on 2026-11-16 with the five steps: 348 s side by side on the card (`test:hot-potato` 280 s, `test:cork` 218 s; 391 CPU seconds), against 858 s one after another in software.
  Measured on 2026-11-15: 221 and 236 s side by side on the card, against 614 s one after another on the card and 637 s in software (2,172 CPU seconds in software, about 320 on the card).
  Most of the gain is `test:cork` on a server of its own: it no longer waits minutes for the earlier steps' rooms to go quiet before it reads the room budget (415 s after the other steps, 212 to 226 s alone).
  Each step's output is printed whole when it ends, then a table of every step's time; the first failure stops the others and fails the gate.
  `PREDEPLOY_SEQUENTIAL=1` keeps the steps one after another on the card.
  Without `TEST_GPU` the gate is one after another, exactly as on GitHub's runners, because a software browser beside other work loads the whole PC.

## The CI policy

1. A pull request runs small, targeted checks: `npm ci` and `npm test` on GitHub's hosted runners (`pr-checks`).
2. Merging runs nothing more.
3. The full suite (`npm run gate`, or the `predeploy-gate` workflow) runs once before a deploy, on the combined result of everything merged.
4. Merges and deploys both happen only on the owner's word.

## Deploying

Deploys run from the owner's PC, never from CI.
The short form, with the full checklist in `DEPLOY.md`:

1. On `main`, up to date, `npm ci`, then the manual checks in "Before every deploy".
2. `npx wrangler whoami` names account `b2c564cf83cb9184dd6d7cc4ff8b38bf`.
3. `npm run deploy` (it is `wrangler deploy --env=''`; never deploy `--env local`).
   npm runs a script named `pre<name>` before `npm run <name>`, so `npm run deploy` runs `predeploy` first by itself: it refuses at once a tree a deploy may not ship (uncommitted or untracked changes, a commit not on `origin/main`, `RELEASE_ALLOW_DIRTY` set; `scripts/release.mjs`), then runs the whole gate, and stops if it fails.
   Do not run the gate before it: that runs the gate twice.
   `npm run gate` runs the gate alone, on any tree, without deploying.
   In an emergency, and only on the owner's word, `npx wrangler deploy --env=''` deploys without the gate; its build still refuses such a tree.
   The deploy's build also holds the files of the two releases that were live before it, built again from their commits, and needs the network for that; it stops, saying why, when it cannot (`scripts/carried.mjs`; `DEPLOY.md`, "The releases a deploy carries").
   `RELEASE_CARRY=none` deploys without them, only on the owner's word.
   After cloning, `npm run hooks` once turns on the commit and push hooks (`.githooks`); it is not an install script, because this package is installed as a git dependency by the games.
   Re-running `npx release-kit apply .` adds a `prepare` script and `.github/workflows/auto-merge.yml` back; take both out again (unattended merging is the owner's call).
4. The checks in "Check it after a deploy".
5. If it is wrong, "Rolling back" in `DEPLOY.md`.

An agent never deploys or rolls back without the owner saying so in that session.

## Release folders: how a page names a file

The build serves each release's files from the release's own folder, `/r/<release id>/`, and media from `/m/<hash>`, both kept by a browser for a year; only the pages stay at their own addresses (`DEPLOY.md`, "Release folders and the browser's cache"; `party-kit/build/folders.mjs`).
So that every address stays inside the release:

- A page script names a file beside itself, from the module: `new URL("./sounds/jump.mp3", import.meta.url)`.
  Never by site path (`"/lobby/sounds/jump.mp3"`) and never from the page's address: no file is there.
  `site/test/addresses.test.js` fails on a site path in a script.
- A path the room sends (a game's view, its picture) goes through `siteUrl` (`site/site-path.js`).
- Imports by site path (`import "/party-kit/client/sounds.js"`), a page's own tags and a stylesheet's `url()` stay as they are: the build rewrites them.
- A browser test that wants one of the page's modules asks the page where its release's files are: `siteFile` in `lobby/test/browser.mjs`.
  `import("/lobby/x.js")` in `page.evaluate` is a 404.
- `node scripts/build-public.mjs --out=DIR` must keep building any commit with no network and the same release id: a later deploy builds that commit again to carry its files.

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
- `games/`: every in-house game, one self-contained folder and npm workspace package each (`games/<id>`, with its own `package.json`, README and tests): Tin Derby (the Floor), Paper Masks and Who Am I? (the Table), Hot Potato (one passed-around device, no server; its hearing test in `games/hot-potato/lab/`).
  A game reaches the hub only by the hub's package name (`n8-party-games/...`, the exports in the root `package.json`), never by a `../` path; the served addresses (`/tin-derby/`, `/party/games/<id>.js`, `/one-device/hot-potato/`, `/lab/hot-potato/`) do not follow the folders and are pinned by `site/test/served-addresses.test.js`.
- `games.js`: the hosted games: those in `games/`, and those from their own repositories pinned in `package.json` (Cork & Bell is a git commit; bump it deliberately).
- `worker.js` and `wrangler.jsonc`: the Worker and its Durable Object migrations (`v1` to `v4`).
  A new migration changes what a rollback can do, so read "Rolling back" in `DEPLOY.md` first.
- `.github/`: the workflows and the predeploy script.

<!-- release-kit -->
## Commits and releases

- Write every commit message as a Conventional Commit: `type(scope): subject`, with type one of feat, fix, perf, security, refactor, docs, test, build, ci, chore, style, revert. A hook and a CI check reject anything else; see RELEASING.md.
- Use `feat` and `fix` only for changes a user would notice: they become the release notes and the public build log.
- Write those subjects as patch notes, for users: what they can now do or what works better, not the file, library or test you touched. When the subject must stay technical, add a `Release-note: <plain sentence>` line to the body, or `Release-note: skip` for a change no user would notice.
- Don't bump versions, edit CHANGELOG.md or releases.json, or create tags by hand: `npm run release` does all of it.
- Land changes through pull requests: a pre-push hook blocks pushing straight to main or a release branch, force pushes and moving release tags. Don't get around it with `--no-verify` or `RELEASE_KIT_ALLOW_DIRECT_PUSH=1` (that is for emergencies the owner asks for, and a Direct push alarm reports it either way).
<!-- /release-kit -->
