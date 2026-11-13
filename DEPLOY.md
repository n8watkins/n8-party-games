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
- Only `dist/public` is served, rebuilt from an allowlist by `scripts/build-public.mjs` before every deploy, together with its `_headers` file (CSP and the other security headers).
- The games are separate repositories, installed as dependencies pinned in `package.json` and listed in `games.js`; `npm ci` must have run before a deploy. A game can also be deployed alone from its own repository, with its own checklist.
- `npm run assets:list` prints every file that will be public.
- The party room (`lobby/`) is a second room class, `LobbyRoom`, with its own API under `/api/lobby` and the same guards as the kit's. It counts all of its awake time against the same room budget.
- The site's root is a plain front page that leads into the party room; before the party room it redirected to Cork & Bell, which stays at `/cork-and-bell/`.
- The bot check on new rooms (Cloudflare Turnstile) stays off until both of its keys exist. Rate limits and the room budget apply either way.

## Before every deploy

1. Run `npm ci`, then `npm test`, and stop if anything fails.
2. Start `npm run dev` and run `npm run test:room`, `npm run test:lobby` and `npm run playtest:battle`, and stop if anything fails. The playtest needs the Windows Chrome (its default `--win=1`); with `--win=0` the software renderer is too slow and it reports missed moments.
3. Start `npx wrangler dev --local --env="" --port 8804 --local-upstream localhost:8804 --persist-to <an empty folder>` and run `npm run test:production -- http://localhost:8804` to check the production settings locally. `--local-upstream` keeps the local address; without it the custom domain becomes the Worker's own address and the QR check fails.
4. On that same server, confirm `/package.json`, `/wrangler.jsonc` and `/party-kit/README.md` answer 404.
5. Run `npm run assets:list` and read the list once: it must hold only the front page, the party room's page (`lobby/`, with `lobby/shared/` and nothing from `lobby/server/` or `lobby/test/`), the kit's browser files, and the games' pages, scripts, styles, models, textures and fonts.

## Deploying

6. Wrangler must be logged in to the owner's account: `npx wrangler whoami` should name account `b2c564cf83cb9184dd6d7cc4ff8b38bf`. **Owner:** if it is not, run `npx wrangler login`.
7. Run `npm run deploy`, which deploys the top level (`wrangler deploy --env=''`) and never the local environment. It runs any new Durable Object migrations by itself (the first deploy ran `v1` to `v3`; the first deploy with the party room runs `v4`, the `LobbyRoom` class); nothing is created by hand.
8. A deploy while a round is on lets that room finish on the old code for up to five minutes, so deploy when nobody is mid-round if you can.

## Check it after a deploy

The live address is shared by everyone, and Cloudflare sees your real address there, so the room limits (5 new rooms in ten minutes, 20 a day) count against you.
Make at most a handful of rooms when checking.

9. Open `https://partygames.n8builds.dev/api/party/config` and confirm `simLatency` is `false`, and that `turnstileSiteKey` is the site key once the bot check is on (`null` until then).
10. Confirm `https://partygames.n8builds.dev/cork-and-bell/` loads over HTTPS with `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` (`SAMEORIGIN`: the party room shows the game in a frame, and no other site may) and `Referrer-Policy` headers, and that `/package.json`, `/wrangler.jsonc` and `/party-kit/README.md` answer 404.
11. Open `https://partygames.n8builds.dev/` and confirm the front page shows "Start a party" and "Join with a code"; then open the game on a laptop, make a room, and join it by PIN from a phone.
12. Open `https://partygames.n8builds.dev/api/party/scores/cork-and-bell` and confirm it answers `{"ok":true,"top":[...]}`.

## Confirming that waiting rooms sleep

13. Play one round to the end, then leave the room open in the lobby on both devices for at least 8 minutes (an untouched room closes after 20).
14. In the Cloudflare dashboard, go to Workers & Pages, open Durable Objects, and look at the account-level usage, then open the `PartyRoom` namespace and its Metrics tab.
15. Expect activity during the round and only short blips (the 10 second pings) while the room waits in the lobby, not a solid block of active time.
16. Check the same period under Manage Account, Billing, Billable Usage, where Durable Objects duration (GB-seconds) should grow during the round and stay nearly flat while the room sleeps.
17. The room budget's own count lives in the `RoomBudget` namespace, in the `budget` object's storage under the `usage` key (room time this day and month); the site has no page for it, so read it from the object's storage view in the dashboard.
18. If duration keeps growing while every room waits in the lobby, something is keeping the rooms awake, so stop new rooms by setting `PARTY_ROOM_BUDGET_SHARE` to a tiny value and investigate.

## The party room

19. Open `https://partygames.n8builds.dev/` on a laptop, start a party as the room's screen, and join it from two phones with the code or the QR code on the wall.
20. Check the wall: Cork & Bell, Who Am I?, Tin Derby, Flood and Fox Trouble, and no Coin Flip (the test game hangs only where `PARTY_TEST_GAMES` is `"on"`, which production is not). Stand both phones in Cork & Bell's light: the battle opens on both phones and the laptop shows both stalls, and ninety seconds later everyone is back in the room with the scores on a card and points on the Tonight board. Then walk about, and put the phones down with the room open for at least 8 minutes. Last of all, stand both phones in Who Am I?'s light: after the count a card says "Off to Who Am I?" and the laptop and both phones go to `https://whoami.n8builds.dev/`.
21. In the dashboard open the `LobbyRoom` namespace's Metrics tab: expect requests while people moved, one block of duration of about a minute and a half for the round of Cork & Bell (the room is awake for all of a round, as a game's own room is), and nothing at all while the phones lay still. An outside game adds no duration: nothing is played in the room.
22. If duration grows while nobody touches anything, something is keeping the room awake, so set `PARTY_ROOM_BUDGET_SHARE` to a tiny value (open party rooms close within three minutes and no new ones open) and investigate.
23. Confirm that `https://partygames.n8builds.dev/api/lobby/debug` answers 404: the door into the budget's books is for local tests only.
24. After a busy evening, compare Durable Objects requests under Billable Usage with the numbers in `lobby/README.md`: requests, not duration, are what a busy party room uses most of. The `usage` key in step 17 also holds the requests the party rooms counted (`dayRequests`, `monthRequests`).
25. `node lobby/test/e2e-budget.mjs` checks locally what a spent allowance does to the party room; its header says which server to start.

## The bot check (Turnstile)

Optional: until both keys exist, rooms are made without it and the rate limits and the room budget still apply.

26. **Owner:** in the Cloudflare dashboard, open Turnstile, add a widget in Managed mode for the hostname `partygames.n8builds.dev` only, and keep the page with its two keys open.
27. **Owner:** store the secret key with `! pass-env set n8-party-games/TURNSTILE_SECRET_KEY` and add the line `TURNSTILE_SECRET_KEY=n8-party-games/TURNSTILE_SECRET_KEY` to the project's `.env.pass`.
28. Put the site key in the top-level `vars` of `wrangler.jsonc` as `TURNSTILE_SITE_KEY` (it is public), through a pull request, and deploy.
29. **Owner:** set the secret with `pass-env pipe n8-party-games/TURNSTILE_SECRET_KEY -- npx wrangler secret put TURNSTILE_SECRET_KEY --env=''`.
30. Check step 9 again (the site key shows), then make one room in a browser: the bot check runs and usually shows nothing.

## The high score board

31. Play a solo round, chalk up three letters, and confirm the chalk board on the left wall shows them; the `ScoreBoard` namespace's Metrics tab should show one short blip per score and nothing in between.
32. To wipe the board, delete the `scores:cork-and-bell` object's storage from the dashboard (Durable Objects, `ScoreBoard`, the object, Storage); the house's scores show again.

## Do not

- Do not run `npm run test:production` or `npm run test:room` against the live address: the first makes six rooms to prove the limit and would rate limit you for ten minutes, and the second needs the local test switches.
- Do not put `TURNSTILE_SECRET_KEY` in `vars`, a `.dev.vars` file or any committed file.
- Do not deploy with `--env local`.
- Do not set `PARTY_DEBUG` on the production Worker: it opens the budget's books and each party room's inner state to anyone.

## Sources

- Custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Static assets, `.assetsignore` and the 25 MiB file limit: https://developers.cloudflare.com/workers/static-assets/binding/ and https://developers.cloudflare.com/workers/platform/limits/
- Custom builds before dev and deploy: https://developers.cloudflare.com/workers/wrangler/configuration/#custom-builds
- Environments and non-inheritable keys: https://developers.cloudflare.com/workers/wrangler/environments/
- Durable Object duration billing and hibernation: https://developers.cloudflare.com/durable-objects/platform/pricing/ and https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- Durable Objects metrics in the dashboard: https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
- Deferred Durable Object code updates: https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/
- Turnstile server-side validation and test keys: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ and https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- Workers Logs: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
