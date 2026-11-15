# Agent notes for n8-party-games

The party site and the room kit behind it, live at https://partygames.n8builds.dev on Cloudflare Workers.
Read `README.md` for what is here and `DEPLOY.md` before any deploy or rollback.
The global rules file (branches, pull requests, no merging without the owner's word, `trash` instead of `rm`, secrets only through `pass-env`) loads by itself and is not repeated here.

## Ports

- 8791: `npm run dev` and `npm run dev:lan`, the everyday local server (`wrangler dev --local --env local`).
- 8792: the wall as production hangs it, with `--var PARTY_TEST_GAMES:off` (see `lobby/README.md`).
- 8804: the production-settings check in `DEPLOY.md` (`wrangler dev --env=""`, then `npm run test:production`).
- 8853: `npm run predeploy` starts its own server here (`PREDEPLOY_PORT` changes it), so it never collides with a dev server on 8791.
- 8850 to 8854: handed out to build agents for their own servers.
  Use only the range your brief gives you, and stop the server when you finish.

## Run and test

- `npm ci`, then `npm test`: the unit tests (vitest, about a second).
  This is the check every pull request must pass.
- `npm run dev`, then the end-to-end scripts against that server: `npm run test:room` and `npm run test:lobby` (plain sockets, no browser), `npm run test:cork` (a headless browser, about four minutes), and the rest of the `test:*` scripts listed in `package.json`.
  Each script takes `--base=http://localhost:PORT`.
- Run one browser test at a time.
  The PC was overloaded once by three browser runs at once, and Blender renders must not overlap with them.
- Browsers run headless and muted.
  The Windows-Chrome playtest (`npm run playtest:battle`) is run by hand on the owner's PC.
- `npm run predeploy` runs the full gate: unit tests, then `test:room`, `test:lobby` and `test:cork` against its own server.
  The same script is the GitHub workflow `predeploy-gate`.

## The CI policy

1. A pull request runs small, targeted checks: `npm ci` and `npm test` on GitHub's hosted runners (`pr-checks`).
2. Merging runs nothing more.
3. The full suite (`npm run predeploy`, or the `predeploy-gate` workflow) runs once before a deploy, on the combined result of everything merged.
4. Merges and deploys both happen only on the owner's word.

## Deploying

Deploys run from the owner's PC, never from CI.
The short form, with the full checklist in `DEPLOY.md`:

1. On `main`, up to date, `npm ci`, then `npm run predeploy` and the manual checks in "Before every deploy".
2. `npx wrangler whoami` names account `b2c564cf83cb9184dd6d7cc4ff8b38bf`.
3. `npm run deploy` (it is `wrangler deploy --env=''`; never deploy `--env local`).
4. The checks in "Check it after a deploy".
5. If it is wrong, "Rolling back" in `DEPLOY.md`.

An agent never deploys or rolls back without the owner saying so in that session.

## Lanes

The plan is `PARTY-GAMES-PLAN.md` in the private ops repo (n8watkins/ops).
Its section "The work, in lanes" is the source for what each lane owns, and `PARTY-GAMES-STATUS.md` in the same repo holds the live state.
Stay inside the files your brief names.
`party-kit/src/core/room-core.js` and `lobby/server/lobby-core.js` are shared ground: lanes take turns there.
Generated files and `CHANGELOG.md` are never edited by hand.

## Where things live

- `party-kit/`: the room kit (server core, client, tests, `GAME-CONTRACT.md`).
- `lobby/`: the party room.
- `games.js`: the hosted games, each its own repository pinned in `package.json` (Cork & Bell is a git commit; bump it deliberately).
- `worker.js` and `wrangler.jsonc`: the Worker and its Durable Object migrations (`v1` to `v4`).
  A new migration changes what a rollback can do, so read "Rolling back" in `DEPLOY.md` first.
- `.github/`: the workflows and the predeploy script.
