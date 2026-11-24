# Deploying to Cloudflare Workers

This is the checklist for putting the party site online and for every deploy after the first.
The site is live at https://partygames.n8builds.dev (first deployed on 2026-11-12).
Steps marked **Owner** need the owner's accounts, secrets or a decision only the owner can make.
Everything else is already in the repository.

## What is already prepared

- `wrangler.jsonc` top level is the production Worker: the account, the custom domain `partygames.n8builds.dev`, rate limits on, simulated latency off, the 10% room budget, Workers Logs on.
- The `workers.dev` address and version preview URLs are off (`"workers_dev": false`, `"preview_urls": false`), so every request goes through the zone.
- The custom domain is a Workers custom domain: the deploy creates its DNS record and certificate, and nothing is set up by hand in DNS.
- The `local` environment keeps the test switches for `npm run dev` and the playtests, has no custom domain (`"routes": []`), and is never deployed.
- Only `dist/public` is served, rebuilt from an allowlist by `scripts/build-public.mjs` before every deploy, together with its `_headers` file (CSP, the other security headers and the cache rules) and its `_redirects` file.
  The build lays the site out in release folders, so a returning phone asks for almost nothing: see "Release folders and the browser's cache".
- The games are separate repositories, installed as dependencies pinned in `package.json` and listed in `games.js`; `npm ci` must have run before a deploy. A game can also be deployed alone from its own repository, with its own checklist.
- `npm run assets:list` prints every file that will be public.
- The party room (`lobby/`) is a second room class, `LobbyRoom`, with its own API under `/api/lobby` and the same guards as the kit's. It counts all of its awake time against the same room budget.
- The site's root is a plain front page that leads into the party room; before the party room it redirected to Cork & Bell, which stays at `/cork-and-bell/`.
- The bot check on new rooms (Cloudflare Turnstile) stays off until both of its keys exist. Rate limits and the room budget apply either way.

## Before every deploy

1. Run `npm ci`, then `npm test`, and stop if anything fails.
2. Start `npm run dev` and run `npm run test:room`, `npm run test:lobby` and `npm run playtest:battle`, and stop if anything fails. The playtest needs the Windows Chrome (its default `--win=1`); with `--win=0` the software renderer is too slow and it reports missed moments.
3. Start `npx wrangler dev --local --env="" --port 8804 --local-upstream localhost:8804 --persist-to <an empty folder>` and run `npm run test:production -- http://localhost:8804` to check the production settings locally. `--local-upstream` keeps the local address; without it the custom domain becomes the Worker's own address and the QR check fails. The gate (`npm run gate`) also starts such a server of its own for `npm run test:cork:switches` (about a minute): with the production settings Cork & Bell's test switches play nobody's seat, in the party room or on the game's own page, and its high score board takes only a run it played again, once.
   That server builds with `--production`, which refuses a working tree with uncommitted or untracked changes; on a tree you are still changing, start it with `RELEASE_ALLOW_DIRTY=1` in front (the gate does this for its own servers).
   Its release record then says `dirty: true`.
   The variable only works for `wrangler dev`: a deploy refuses it outright.
4. On that same server, confirm `/package.json`, `/wrangler.jsonc` and `/party-kit/README.md` answer 404.
5. Run `npm run assets:list` and read the list once.
   At their own addresses it must hold only the pages (`index.html`, `lobby/index.html` and the others), the web app manifest `manifest.webmanifest` with its `icons/`, and `release.js`.
   Under `r/<release id>/` it must hold only the front page's files (with `front.js`), the party room's (`lobby/`, with `lobby/shared/` and nothing from `lobby/server/` or `lobby/test/`), the kit's browser files, and the games' pages, scripts and styles.
   Under `m/` are the pictures, sounds, models, textures, fonts and word lists, each named by a hash of its bytes.

## Deploying

6. Wrangler must be logged in to the owner's account: `npx wrangler whoami` should name account `b2c564cf83cb9184dd6d7cc4ff8b38bf`. **Owner:** if it is not, run `npx wrangler login`.
7. Run `npm run deploy`; on the owner's PC, `TEST_GPU=1 npm run deploy` is faster (the gate's end-to-end steps run side by side on the graphics card, each with a local Worker of its own; see "Run and test" in `AGENTS.md`, and `PREDEPLOY_SEQUENTIAL=1` keeps them one after another). npm runs the script `predeploy` before it, so the full gate (unit tests, then every step in `.github/scripts/predeploy-steps.mjs`: `test:room`, `test:lobby`, `test:cork`, `test:hot-potato`, `test:hearing`, `test:mode`, `test:two-rooms`, `test:table` and `test:home`) runs first by itself and the deploy stops if it fails; do not run the gate first, which would run it twice. `npm run gate` runs the gate alone, on any tree, without deploying. In an emergency, and only on the owner's word, `npx wrangler deploy --env=''` deploys without the gate. The deploy itself is `wrangler deploy --env=''`, which deploys the top level (`wrangler deploy --env=''`) and never the local environment. It runs any new Durable Object migrations by itself (the first deploy ran `v1` to `v3`; the first deploy with the party room runs `v4`, the `LobbyRoom` class); nothing is created by hand.
8. A deploy while a round is on lets that room finish on the old code for up to five minutes, so deploy when nobody is mid-round if you can.
   What goes live is always one commit already on `origin/main`, and the release record says which.
   Before the gate starts, `predeploy` fetches `origin/main` and refuses at once: uncommitted or untracked changes anywhere (it lists them), a gitignored file inside a folder the site serves, a commit not on `origin/main`, or `RELEASE_ALLOW_DIRTY` set.
   The deploy's own build (`WRANGLER_COMMAND` is `deploy`) refuses the same again, so the emergency `npx wrangler deploy --env=''` is held to it too.
   To roll back by deploying an older commit, check that commit out: it is on `origin/main`, so it passes.
   `npx wrangler deploy --dry-run --env=''` is an upload to Wrangler too, so it is refused the same way on a branch that is not on `origin/main` (or on a dirty tree); try a dry run from main, or build with `npm run build` instead.
   The deploy's build also holds the files of the two releases that were live before it, for the pages still open on them ("Release folders and the browser's cache", "The releases a deploy carries").
   It needs the network for that: it asks the live site what it is, then builds each of those releases again from its commit (a copy of the commit's files in a temporary folder, `npm ci` there, its own build; about ten seconds each).
   `predeploy` asks the live site before the gate starts and says what will be carried; a deploy that cannot carry them stops and says why.
   Only on the owner's word, `RELEASE_CARRY=none npm run deploy` deploys without them: the very first deploy of a new site needs it, and so does a deploy while the live site cannot be reached.

## Releases

Every build writes a release record (`scripts/release.mjs`): `dist/release.js`, which the Worker imports as `n8-party-games/release` (an alias in `wrangler.jsonc`), the same at `/release.js` for anyone who looks, and, cut down to its id and the site's version, `release.js` in the release's own folder (`/r/<id>/release.js`), which the pages import, so a page and the room agree on what a release is.

- `id` is a 12-digit hash of every file of the built site as it is served (the `_headers` file with the CSP and the cache rules, and the `_redirects` file, included) and of the site's version, so rebuilding the same code keeps it and any change a browser could see makes a new one.
  A version bump alone is therefore a new release too: the pages show the version.
  It is also the name of the release's folder, which the pages name, so it is worked out from the site as built with a placeholder where the id goes; the releases a build carries and the local build's preview pages are not part of it.
  The pages' own copy of the record holds only the id and the version, because its address is kept for a year: everything a deploy serves from a release's folder is the same bytes every time that release is built.
  `site` is the site's version from `package.json`; `commit`, `dirty` and `pushed` (the commit is on `origin/main`) say what it was built from; `builtAt` is when; `games` holds each game's own version; `carries` lists the releases whose files the build also holds, newest first, each with its commit.
- `GET /api/version` answers with the record, never cached, in the shape of Who Am I?'s (`ok`, `name`, `version`, `commit`), plus `release`, `dirty`, `pushed`, `builtAt`, `games`, `carries` and `worker` (the Worker version's id, tag and upload time, from the version metadata binding `CF_VERSION_METADATA`).
- The front page shows "Version 0.1.0, build 797991e34665" under "Made in the open"; the Floor shows it at the foot of the room picker, and the Table under "Who is here".

The site's version is set by release-kit (`RELEASING.md`): Conventional Commits, `npm run release`, a `vX.Y.Z` tag and a GitHub Release.
Making the first tag is the owner's call.
The Floor, the Table and Hot Potato share the site's version.

The games' versions:

- Cork & Bell is its own repository with release-kit, pinned in `package.json`. Its record carries the version and the git ref it is pinned at.
  It is still pinned by commit because it has no release yet.
  Once its first `vX.Y.Z` tag exists, pin it as `github:n8watkins/cork-and-bell#vX.Y.Z`.
- Tin Derby and Paper Masks are folders of this repository, workspace packages (`games/*` in `package.json`), each with its version in its own `games/<id>/package.json`.
- Who Am I? at the Table lives in `party/games/who-am-i/index.js`, with `version` in its manifest.
- release-kit moves only the site's version.
  A game kept in this repository has its version bumped in the pull request that changes it: a minor for a feature, a patch for a fix.
  A unit test refuses a manifest without one.

## Release folders and the browser's cache

A returning phone asks the server for the page and almost nothing else, and no open page is ever served another release's code.
The build does it (`scripts/build-public.mjs`, with `party-kit/build/folders.mjs`); nothing is set up in Cloudflare by hand.

- **The pages** (`/`, `/lobby/`, `/party/`, `/table/` and the others) stay at their own addresses and are sent with Workers' own `public, max-age=0, must-revalidate`: a browser asks for a page again every time, so a page is always the live release's.
  Each page points only into its own release's folder.
- **`/r/<release id>/...`** holds every file of the release that is not media: scripts, styles, small data, and a copy of each page (a game shown in the party room's frame loads its page from there).
  An address in it never serves other bytes, so it is sent with `public, max-age=31536000, immutable`: kept for a year and never asked for again.
  It is also sent with `X-Robots-Tag: noindex`: the page copies there are not the site's pages.
  (A local build's preview pages are the one exception to the year: they are no part of the release id, so their files under `/r/<id>/preview/` are asked for again each time.)
- **`/m/<hash>.<ext>`** holds the media (pictures, sounds, models, textures, fonts, data files of 16 KiB and more), each named by a hash of its bytes and shared by every release that holds the same file.
  The same header: a new release makes a phone load new code, and no picture or sound it already has.
- **`_redirects`** sends `/r/<id>/<path of a media file>` on to its `/m/` address for good (301, kept for a year like the folder).
  A script that builds an address beside itself (`new URL("./sounds/jump.mp3", import.meta.url)`) lands in its folder and is sent on, once per release, with no bytes moved.
  Pages and stylesheets name media straight by its `/m/` address.
- **What else stays at its own address**, asked for again each time: `manifest.webmanifest` and `icons/` (an installed site reads them there) and `/release.js` (`STABLE` in `scripts/build-public.mjs`).
  Cork & Bell's own page (`/cork-and-bell/`) still names its baked set from the page, so those five addresses answer with a redirect that is never kept (`STABLE_MEDIA`); take the entry out once the game names them from `import.meta.url` (`party-kit/GAME-CONTRACT.md`, "Rules a game keeps").
- **A file that is not there** is a 404 sent `no-store` by the Worker (`assetOr404` in `party-kit/src/worker/http.js`), never a page.
  Workers would otherwise send a missing file under `/r/` with the folder's year, and a browser would keep the 404.
- Nothing else is kept: the API answers `no-store` as before, and the socket is not a file.

A page script must never name a file by its site path (`"/art/x.webp"`): that address is outside the folder.
It names its own files from the module (`import.meta.url`), and a path the room sends (a game's view, its picture) through `siteUrl` (`site/site-path.js`).
Imports by site path (`import "/party-kit/client/sounds.js"`) are fine: the build makes them relative.
Nor from the page's own address (`img.src = "bar.jpg"`): the page stays where it is, and the picture is not beside it.
`site/test/addresses.test.js` fails on a site path in a script.
`npm run test:release` loads and scrolls every page the build makes, on a deploy that carries no old flat site, and fails on any file asked for outside the page's release folder, the media, the API and the files listed above, and on anything missing.

### The releases a deploy carries

A Worker version serves only its own files.
A page still open on the release before keeps asking for that release's files (what it loads later: the 3D look, a game's view, a sound) until the "new version" switch reloads it at a safe point.
So each deploy also holds the files of the two releases that were live before it (`scripts/carried.mjs`): their `/r/<id>/` folders, their media and their redirects.

- Where they come from: the build asks the live site (`GET /api/version` names its release, its commit and the releases it carries), takes the first two that are not the release being built, and builds each again from its commit, in a temporary folder with that commit's own packages.
  The id of what it built must be the id the live site gave, so the files carried are byte for byte the ones that were served; otherwise the deploy stops.
  The one file the id does not cover, the pages' own copy of the record in the release's folder, must hold its id and the site's version and nothing else, or the deploy stops too.
  The commit must be on `origin/main` (every deploy is made from one that is), and it is built outside git, whatever folder the temporary files are in.
  Nothing is stored anywhere and no secret is needed; a git tag is not needed either.
- The files under `/r/<id>/` are that release's, but the headers they are sent with are the carrying deploy's.
  A page's import map names its own release's folder, so the policy of a deploy allows the inline scripts of the page copies it carries beside its own (`withCarried` in `party-kit/build/folders.mjs`); everything else in the policy is the new deploy's.
  Without that, a game opened in a frame from a page still on the release before would be refused its import map.
- The record of the new release lists what it carries, so the next deploy finds the chain again the same way.
- `predeploy` checks before the gate that the live site answers and that this clone has the commits, on `origin/main`; run `git fetch origin` if it says one is missing.
- A local build, a dev server and the gate carry nothing and need no network.
  `node scripts/build-public.mjs --carry=live --out=<a folder>` is a dress rehearsal of a deploy's build, from any tree.
- A commit can be built again only while its own build still runs: `node scripts/build-public.mjs --out=DIR` must keep working, with no network, and keep giving the same id (the script's header says so).
- Limits to watch (Cloudflare's, checked 2026-11-23): 2,000 static redirects and 100 header rules.
  A release has one redirect for each media file (about 180 today), and a deploy holds three releases' worth; the build stops, saying so, before it would write more than 2,000.

### The first deploy with release folders

The release that is live before it has no folders: its open pages load their code and media by the old addresses (`/lobby/main.js`, `/party-kit/client/sounds.js`).
The first deploy with folders carries that release in that form: every file of it but the pages, at its old address, exactly as it was served (built again from its commit, the id checked).
An open page of the old release therefore keeps working until the switch reloads it into the new one, and a reload always gets the new page.
The deploy after it still holds those files, and the one after that lets them go.
`npm run test:release` plays this out (a flat build, then the first with folders).

What to expect on that one deploy:

- Every phone loads every file once more (the addresses are all new), then keeps them.
- The check before the gate prints "This deploy will carry the releases before it: <id> (commit <commit>)", with the id the live `/api/version` shows.
- After it, `/api/version` shows `carries` with that id.

## The seat's token and the logs

Workers Logs are on at full sampling, and they keep every request's address.
A seat's token is therefore never part of an address or a header: it is the first message on the socket (`party-kit/README.md`, "The socket handshake").
Nothing in the Worker prints a token either.

The deploy that brought this in (the handshake changed in November 2026) is the one deploy where pages already open matter.
How a room takes new code decides what its devices see:

- A room that is asleep, or that falls asleep within 300 seconds of the deploy, takes the new code quietly: its sockets stay connected and the room still knows whose each one is.
- A room still busy after 300 seconds (a round of a ticking game is on, or people keep moving and tapping) is reset by Cloudflare at that deadline, and every socket in it is cut at once (Cloudflare's "Durable Objects code updates", in Sources).
  `npm run deploy -- --durable-objects-code-update-mode immediate` resets every busy room at once instead.
  A ticking round cut short this way is lost, and both kinds of room put everyone back in the lobby; the seats are saved and kept (in a game's own room, such as Cork & Bell's, a phone has the 30 second grace to come back to its seat, which a reconnect takes a few seconds of).

What a device that is in a room sees across it:

- **Its socket stays open** when its room takes the new code quietly. Nothing changes on that device until its page opens a new socket.
- **When its socket is cut** (the room was reset at the deadline, or the signal went), its page opens a new one by itself, as after any drop. A page loaded after the deploy says hello with its token. A page loaded before it still puts the token in the address (`?token=`), and the room takes that, for now, as that socket's hello (`HONOUR_TOKEN_IN_ADDRESS` in `party-kit/src/worker/hello-logic.js`). Either way the phone is back in its own seat, and a turn-based game goes on.
- **A reload** loads the new page, which says hello with the saved session and has its seat back.
- **Making or joining a room from a page that was open before the deploy** is refused with "This page is out of date. Reload it to play." until the page is reloaded, so an old page can only ever carry a token it was given before the deploy.
- **A room that is in the middle of a ticking round** keeps the old code until the round is over or the deadline comes. A page loaded during that time (a reload, or someone joining) speaks the new way to a room that does not know it yet, is refused as a seat that is gone, and lands on the front page with **Rejoin**. Deploying when nobody is mid-round (step 8) avoids it.

What cannot be fixed: a page loaded before the deploy keeps sending its token in the socket's address at every reconnect until it is reloaded, and each of those addresses is written to the logs.
Those tokens are the ones its first connect already wrote there, they are good only while their room is open (four hours at most), and no old page can be given a new one.
Refusing them would protect nothing and cost those phones their seats, which is why the room takes them for now.

What cannot be undone: the logs from before that deploy hold the tokens of the sockets opened until then, in each request's address, for as long as Workers Logs keep them (seven days on the paid plan).
A token is only good while its room is open (a party lasts four hours at most, and closes sooner when it is empty or untouched), so every token in those logs is dead within hours of the deploy.
Nothing needs deleting.

## To remove after

- **`HONOUR_TOKEN_IN_ADDRESS`** (`party-kit/src/worker/hello-logic.js`, added 2026-11-15): in the first release deployed more than four hours after the one that ships it, delete the constant and the seating of the old form it guards in both rooms (`fetch` in `party-kit/src/worker/room.js` and `lobby/server/lobby-room.js`).
  Keep a one-line branch in its place that closes a `?token=` socket at once with 4003 (`CLOSE_BAD_TOKEN`).
  Without it such a socket becomes an ordinary one that never says hello: it is closed 4009 at the next sweep, 4009 tells an old tab to try again for ever, and in a room that no longer exists nothing sweeps it at all.
  Change the old-form checks in the tests and end-to-end scripts to expect that 4003 (search for `oldForm` and `?token=`).

## What open pages do after a deploy

Pages already open load the new version by themselves (`site/release-switch.js`), and the room's side is `lobby/server/release-points.js`.
- A player's page reloads at the room's next safe point (the lobby, a result put away; never mid-round, during a count or a game's settings) and comes straight back to its seat.
  A phone in full screen reloads too and drops out of full screen; the player's next tap takes it back in.
- Until then it shows "New version ready after this round" in the bottom bar (on the Floor) or under the heading (at the Table).
- A big screen never reloads by itself: at a safe point it shows "New version, tap to load".
- A browser that keeps no session storage cannot come back to its seat after a reload, so it only says "New version next time you join".
- A party's reloads are spread over up to 30 seconds so that a party behind one address stays under the zone's "Slow down floods" rule.
- `npm run test:release` (in the gate) plays this out against a local Worker of its own.

## Check it after a deploy

The live address is shared by everyone, and Cloudflare sees your real address there, so the room limits (5 new rooms in ten minutes, 20 a day) count against you.
Make at most a handful of rooms when checking.

9. Open `https://partygames.n8builds.dev/api/party/config` and confirm `simLatency` is `false`, and that `turnstileSiteKey` is the site key once the bot check is on (`null` until then).
10. Confirm `https://partygames.n8builds.dev/cork-and-bell/` loads over HTTPS with `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` (`SAMEORIGIN`: the party room shows the game in a frame, and no other site may) and `Referrer-Policy` headers, and that `/package.json`, `/wrangler.jsonc` and `/party-kit/README.md` answer 404.
11. Open `https://partygames.n8builds.dev/` and confirm the front page shows "Start a party" and "Join with a code"; then open the game on a laptop, make a room, and join it by PIN from a phone.
12. Open `https://partygames.n8builds.dev/api/party/scores/cork-and-bell` and confirm it answers `{"ok":true,"top":[...]}`.
    Open `https://partygames.n8builds.dev/api/version` and confirm `commit` is the commit you deployed, `dirty` is `false` and `worker.id` is the version `npx wrangler deployments status --env=''` names; the line at the foot of the front page shows the same `release`.
    Confirm `carries` names the release that was live before (and the one before that), unless the deploy was made with `RELEASE_CARRY=none`.
    Then the cache, with the `release` id from that answer: `curl -sI https://partygames.n8builds.dev/lobby/` shows `cache-control: public, max-age=0, must-revalidate`; `curl -sI https://partygames.n8builds.dev/r/<release>/lobby/main.js` shows `200` and `cache-control: public, max-age=31536000, immutable`; `curl -sI https://partygames.n8builds.dev/r/<release>/lobby/sounds/jump.mp3` shows `301`, a `location` under `/m/` and the same `immutable` header; `curl -sI https://partygames.n8builds.dev/r/<release>/nope.js` shows `404` and `cache-control: no-store`; and `main.js` under the id in `carries` shows `200` (after the first deploy with folders, the carried release is the old site instead: `curl -sI https://partygames.n8builds.dev/lobby/main.js` shows `200`).

## Confirming that waiting rooms sleep

13. Play one round to the end, then leave the room open in the lobby on both devices for at least 8 minutes (an untouched room closes after 20).
14. In the Cloudflare dashboard, go to Workers & Pages, open Durable Objects, and look at the account-level usage, then open the `PartyRoom` namespace and its Metrics tab.
15. Expect activity during the round and only short blips (the 10 second pings) while the room waits in the lobby, not a solid block of active time.
16. Check the same period under Manage Account, Billing, Billable Usage, where Durable Objects duration (GB-seconds) should grow during the round and stay nearly flat while the room sleeps.
17. The room budget's own count lives in the `RoomBudget` namespace, in the `budget` object's storage under the `usage` key (room time this day and month); the site has no page for it, so read it from the object's storage view in the dashboard.
18. If duration keeps growing while every room waits in the lobby, something is keeping the rooms awake, so stop new rooms by setting `PARTY_ROOM_BUDGET_SHARE` to a tiny value and investigate.

## The party room

19. Open `https://partygames.n8builds.dev/` on a laptop, start a party as the room's screen, and join it from two phones with the code or the QR code on the wall.
20. Check the wall: Cork & Bell, Flood, Tin Derby, Fox Trouble and the "Got a game idea?" poster, with no Who Am I? and no Coin Flip (the test game hangs only where `PARTY_TEST_GAMES` is `"on"`, which production is not). Stand both phones in Cork & Bell's light: the battle opens on both phones and the laptop shows both stalls, and when the round is over (at ninety seconds, or sooner once both phones have spent all their corks) everyone is back in the room with the scores on a card and points on the Tonight board. Then walk about, and put the phones down with the room open for at least 8 minutes. Last of all, stand both phones under the ideas poster: no light comes on and no count starts; tap the poster on a phone and the contact form on `https://n8builds.dev/#contact` opens in a new tab.
21. In the dashboard open the `LobbyRoom` namespace's Metrics tab: expect requests while people moved, one block of duration of about a minute and a half for the round of Cork & Bell (the room is awake for all of a round, as a game's own room is), and nothing at all while the phones lay still.
22. If duration grows while nobody touches anything, something is keeping the room awake, so set `PARTY_ROOM_BUDGET_SHARE` to a tiny value (open party rooms close within three minutes and no new ones open) and investigate.
23. Confirm that `https://partygames.n8builds.dev/api/lobby/debug` answers 404: the door into the budget's books is for local tests only.
24. After a busy evening, compare Durable Objects requests under Billable Usage with the numbers in `lobby/README.md`: requests, not duration, are what a busy party room uses most of. The `usage` key in step 17 also holds the requests the party rooms counted (`dayRequests`, `monthRequests`).
25. `node lobby/test/e2e-budget.mjs` checks locally what a spent allowance does to the party room; its header says which server to start.

## The bot check (Turnstile)

Making a party (a new room, which is what costs room time) is checked; joining a party by its code, the big screen joining, and a reload of a page already in a party never are.
The widget is Managed with appearance "interaction-only", so a normal phone sees nothing; only a visitor Turnstile is unsure of gets a box to tick.
The Worker checks the token with siteverify before the room is made, once (a spent token is refused), for the action `create-room` and this site's hostname (`party-kit/src/worker/turnstile.js`).
It fails closed: if siteverify cannot be reached in 5 seconds, no room is made and the page says "Could not check you are a person just now. Try again in a moment."; a refused check says "Could not check you are a person. Try again.", and the button works again.
If Turnstile's script is blocked (often a content blocker) or does not load in 15 seconds, the page says so and the button works again; joining by code still works.
Only the pages that make rooms may load anything from `https://challenges.cloudflare.com`: the build finds them as the pages that load the kit's bot check (today `/lobby/*`, `/table/*` and `/cork-and-bell/*`; `roomMakingPages` in `party-kit/build/public.mjs`).
A deploy whose secret is one of Cloudflare's public test secrets makes no room at all (they pass any token) and logs why; so does a secret set without `TURNSTILE_SITE_KEY`, once.

It is off until the secret exists: with no secret, rooms are made without it, `/api/party/config` hands out no site key, and the rate limits and the room budget still apply.
The widget "Party games new party" (Managed, hostname `partygames.n8builds.dev` only, site key `0x4AAAAAAGM24cDseqMFt3A0`) was made on 2026-11-21 and its site key is already in the top-level `vars` of `wrangler.jsonc`.
To switch it on:

26. **Owner:** in the Cloudflare dashboard open Turnstile, the widget "Party games new party", copy its secret key, and store it with `! pass-env set n8-party-games/TURNSTILE_SECRET_KEY` (`.env.pass` already names it).
27. Deploy the code that holds the site key, if it is not live yet (steps 1 to 8); until step 28 the live site behaves exactly as before.
28. **On the owner's word:** set the secret, which switches the check on at once: `pass-env pipe n8-party-games/TURNSTILE_SECRET_KEY -- npx wrangler secret put TURNSTILE_SECRET_KEY --env=''`.
29. Check step 9 again (the site key shows), then start a party on a phone: nothing should show, and the party should open as before. Join it by code from a second phone: no check.
30. To switch it off again: `npx wrangler secret delete TURNSTILE_SECRET_KEY --env=''` (on the owner's word; it is a delete), and the site behaves as before.

`npm run test:turnstile` checks all of it locally with Cloudflare's test keys (its header lists the servers to start; `--lobby=1` adds the party room's way in on phones and a big screen).

## The high score board

31. Play a solo round, chalk up three letters, and confirm the chalk board on the left wall shows them; the `ScoreBoard` namespace's Metrics tab should show one short blip per score and nothing in between.
32. To wipe the board, delete the `scores:cork-and-bell` object's storage from the dashboard (Durable Objects, `ScoreBoard`, the object, Storage); the house's scores show again.

## Rolling back

A rollback puts the Worker's code, bindings and static assets back to an earlier version at 100% of traffic.
It is a deploy: do it only when the owner says so.
It does not touch Durable Object data, and it does not change the repository, so `main` still holds the bad change (see the last step).

### The commands

Run them from the repository with `npm ci` done and Wrangler logged in as in step 6.
They are the commands of Wrangler 4 and the Cloudflare page "Rollbacks" (https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

1. `npx wrangler deployments status --env=''` shows what is live now and the version ID.
2. `npx wrangler deployments list --env=''` shows the last 10 deployments, newest first, and `npx wrangler versions list --env=''` shows the last 10 versions with their IDs, dates and messages.
   Pick the last version that was good.
   Cloudflare keeps only the 100 most recent versions.
3. `npx wrangler rollback <VERSION_ID> --env='' --message "why"` makes that version live.
   Without an ID it asks you to choose from a list.
   `--yes` skips the confirmation.
   It first checks that the rollback is allowed (see below) and refuses if it is not.
4. A room that is awake keeps running its old code until its code update happens: by default Durable Objects pick up new code on a "deferred" schedule of at most 300 seconds (the same five minutes as step 8).
   Add `--durable-objects-code-update-mode immediate` to switch them at once, which resets rooms that are awake and drops their players.
   Use it only when waiting is worse than a reset, for example a security fix.
5. Check it like a deploy: steps 9 to 12 under "Check it after a deploy", plus `npx wrangler deployments status --env=''`.
6. Fix `main`: open a pull request that reverts the bad change, and merge it on the owner's word.
   Until then, `npm run deploy` from `main` would put the bad version back.

The dashboard does the same under the Worker's Deployments tab.

### When a Durable Object migration is in between

`wrangler.jsonc` has four migrations, each one adding a class: `v1` (`PartyRoom`, `PinDirectory`, `RateLimiter`), `v2` (`RoomBudget`), `v3` (`ScoreBoard`), `v4` (`LobbyRoom`, the party room).
Cloudflare treats a migration as one atomic change to the account.
It refuses a rollback to any version from before a migration that has happened since: "You cannot roll back to a previous version of your Worker if ... a Durable Object class lifecycle change ... has occurred between the version in the active deployment and the version selected."

What that means here, stated plainly:

- Safe: a rollback between two versions that both already have `v4` (every ordinary change since the party room deployed), as long as no later migration has been deployed since.
  This is the case for almost every rollback.
  It is a code-and-assets swap, and the rooms' stored data stays where it is.
- Not possible: a rollback to a version from before `v4`, that is, to the site before the party room existed, once `v4` is live.
  The same holds for `v1` to `v3` and anything older than the first deploy of 2026-11-12.
  Wrangler will refuse; do not try to get round it.
- Not possible: a rollback across any migration added in the future (a `v5`).
  Before deploying a version that adds a migration, know that there is no way back past it, and deploy it on its own, with no other change in the same deploy, so that a problem can be told apart from it.
  Cloudflare also does not allow such a version to be uploaded as a gradual deployment; it goes out with `npm run deploy`.
- Not undone by a rollback in any case: data.
  A rollback restores code, not storage.
  If the newer code wrote rows or object state in a shape the older code cannot read (the `RoomBudget`, `ScoreBoard`, `PinDirectory` and the rooms' own storage), the older code runs against that newer data.
  Nothing in this repository has been tested for that, so after any rollback check the budget and the score board (steps 12 and 17) and expect rooms that were open to be unreliable.
- Never use a migration to undo a migration: deleting a class (`deleted_classes`) permanently deletes every object of that class and its stored data.
  If a new class was a mistake, ship a version that stops using it and leave the class in place.

When the rollback is refused or is not enough, go forward: fix the problem in a pull request and deploy that, as a normal deploy (`npm run deploy` runs the gate first).

### Other things a rollback does not undo

- Secrets (`TURNSTILE_SECRET_KEY`) belong to a version: Cloudflare's changelog says a rollback through its API asks for confirmation when the secret's value differs from the one the version had; read what Wrangler prints and do not force it without the owner.
  Check step 9 afterwards (`turnstileSiteKey`).
- Plain settings in `wrangler.jsonc` (`PARTY_ROOM_BUDGET_SHARE` and the others) come back as the old version had them, which may be a different room allowance than today's.
  Read the old values with `npx wrangler versions view <VERSION_ID> --env=''` before rolling back if that matters.
- A rollback serves exactly what that version was deployed with: its own release's folder, and the two releases it carried then.
  So pages open on a release older than the bad one keep working if the version rolled back to carried it.
  The bad release's own folder is not in it: a page still open on the bad release that asks for a file it had not loaded yet gets a 404 (never kept by the browser), until the "new version" switch reloads it at its next safe point into the release rolled back to.
  A reload fixes it at once.
  Cloudflare's page "Version skew and static assets" covers this.
- The next deploy after a rollback carries the release rolled back to and what that one carried: the live site's `/api/version` is where it reads the chain.
  It does not carry the bad release.
- Rolling back to a version from before release folders puts the old site back whole: every file at its old address, asked for again each time, and none of the `/r/` folders.
  Pages open on a release with folders then ask for addresses that are gone, until they reload.
- The Workers Logs and the metrics keep running as before, so use them to confirm the old code is serving.

## Do not

- Do not run `npm run test:production` or `npm run test:room` against the live address: the first makes six rooms to prove the limit and would rate limit you for ten minutes, and the second needs the local test switches.
- Do not put `TURNSTILE_SECRET_KEY` in `vars`, a `.dev.vars` file or any committed file.
- Do not deploy with `--env local`.
- Do not set `PARTY_DEBUG` on the production Worker: it opens the budget's books and each party room's inner state to anyone.

## Sources

- Custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Static assets, `.assetsignore` and the 25 MiB file limit: https://developers.cloudflare.com/workers/static-assets/binding/ and https://developers.cloudflare.com/workers/platform/limits/
- Release folders (checked 2026-11-23). Headers on static files, the default `Cache-Control`, one splat and placeholders in a rule, `!` to detach, 100 rules: https://developers.cloudflare.com/workers/static-assets/headers/ . Redirects, which win over a file at the same address and over the headers file's order, 2,000 static ones: https://developers.cloudflare.com/workers/static-assets/redirects/ . A version serves only its own files, a deploy takes a few seconds to reach every location, and a missing file goes to the Worker: https://developers.cloudflare.com/workers/versions-and-deployments/version-skew/ and https://developers.cloudflare.com/workers/static-assets/routing/worker-script/ . The file and rule limits: https://developers.cloudflare.com/workers/platform/limits/#static-assets
  Not in the documentation, read from the code Workers serves static files with (the asset worker in `workers-sdk`, the same one `wrangler dev` runs) and checked by `npm run test:release`: a `_headers` rule is also sent with a redirect and with a missing file's 404 at a matching address.
- Custom builds before dev and deploy: https://developers.cloudflare.com/workers/wrangler/configuration/#custom-builds
- Environments and non-inheritable keys: https://developers.cloudflare.com/workers/wrangler/environments/
- Durable Object duration billing and hibernation: https://developers.cloudflare.com/durable-objects/platform/pricing/ and https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- Durable Objects metrics in the dashboard: https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
- Deferred Durable Object code updates: https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/ and https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/ (a busy object is reset when `max_delay`, 300 seconds by default, is reached, and a forced update disconnects its WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- Turnstile server-side validation and test keys: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ and https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- Workers Logs: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
