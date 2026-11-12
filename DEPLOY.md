# Going live on Cloudflare Workers

This is the owner's checklist for putting the party games online.
Nothing has been deployed yet.
Steps marked **Owner** need your accounts or a decision only you can make.
Everything else is already in the repository.

## What is already prepared

- `wrangler.jsonc` top level is the production Worker: rate limits on, simulated latency off, the 10% room budget, Workers Logs on.
- The `local` environment keeps the test switches for `npm run dev` and the playtests, and is never deployed.
- Only `dist/public` is served, rebuilt from an allowlist by `scripts/build-public.mjs` before every deploy.
- The games are separate repositories, installed as dependencies pinned in `package.json` and listed in `games.js`; `npm install` must have run before a deploy. A game can also be deployed alone from its own repository, with its own checklist.
- `npm run assets:list` prints every file that will be public.
- The bot check on new rooms (Cloudflare Turnstile) stays off until both of its keys exist.

## Before the first deploy

1. **Owner:** create a private GitHub repository for this project and push the `main` branch to it.
2. **Owner:** make sure the Cloudflare account is on the Workers Paid plan, since the room budget is a share of that plan's included Durable Object time.
3. **Owner:** pick the address, for example `games.n8builds.dev` on a zone in the same Cloudflare account.
4. Add it to the top level of `wrangler.jsonc` as `"routes": [{ "pattern": "games.n8builds.dev", "custom_domain": true }]`.
5. **Owner:** decide whether the `workers.dev` address should also answer, and set `"workers_dev": false` in `wrangler.jsonc` if not.
6. **Owner:** in the Cloudflare dashboard, open Turnstile and add a widget in Managed mode for that hostname only.
7. Put its site key in the top-level `vars` of `wrangler.jsonc` as `TURNSTILE_SITE_KEY`, since the site key is public.
8. **Owner:** store the widget's secret key with `! pass-env set n8-party-games/TURNSTILE_SECRET_KEY` and add that entry name to the project's `.env.pass`.
9. Run `npm test`, then start `npm run dev` and run `npm run test:room` and `npm run playtest:battle`, and stop if anything fails.
10. Start `npx wrangler dev --local --env="" --port 8804 --persist-to <an empty folder>` and run `npm run test:production -- http://localhost:8804` to check the production settings locally.
11. Run `npm run assets:list` and read the list once: it must hold only the games' pages, scripts, styles, models, textures and fonts.

## The first deploy

12. **Owner:** log in with `npx wrangler login`.
13. **Owner:** run `npm run deploy`, which deploys the top level (`wrangler deploy --env=''`) and never the local environment.
14. **Owner:** set the secret with `pass-env pipe n8-party-games/TURNSTILE_SECRET_KEY -- npx wrangler secret put TURNSTILE_SECRET_KEY --env=''`.
15. Until step 14 is done the bot check is off and rooms can be made without it, so do it straight after the deploy.

## Check it after going live

16. Open `https://<your address>/api/party/config` and confirm `simLatency` is `false` and `turnstileSiteKey` is your site key.
17. Open the game on a laptop, make a room (the bot check runs, and usually shows nothing), and join it by PIN from a phone.
18. Confirm that `https://<your address>/package.json`, `/wrangler.jsonc` and `/party-kit/README.md` all answer 404.
19. Play one round to the end, then leave the room open in the lobby on both devices for at least 15 minutes.
20. In the Cloudflare dashboard, go to Workers & Pages, open Durable Objects, and look at the account-level usage, then open the `PartyRoom` namespace and its Metrics tab.
21. Expect activity during the round and only short blips (the 10 second pings) while the room waits in the lobby, not a solid block of active time.
22. Check the same period under Manage Account, Billing, Billable Usage, where Durable Objects duration (GB-seconds) should grow during the round and stay nearly flat while the room sleeps.
23. If duration keeps growing while every room waits in the lobby, something is keeping the rooms awake, so stop new rooms by setting `PARTY_ROOM_BUDGET_SHARE` to a tiny value and investigate.
24. A deploy while a round is on lets that room finish on the old code for up to five minutes, so deploy when nobody is mid-round if you can.

## Do not

- Do not run `npm run test:production` against the live address, because Cloudflare replaces the test's client address with yours and it would rate limit you for ten minutes.
- Do not put `TURNSTILE_SECRET_KEY` in `vars`, a `.dev.vars` file or any committed file.
- Do not deploy with `--env local`.

## Sources

- Static assets, `.assetsignore` and the 25 MiB file limit: https://developers.cloudflare.com/workers/static-assets/binding/ and https://developers.cloudflare.com/workers/platform/limits/
- Custom builds before dev and deploy: https://developers.cloudflare.com/workers/wrangler/configuration/#custom-builds
- Environments and non-inheritable keys: https://developers.cloudflare.com/workers/wrangler/environments/
- Durable Object duration billing and hibernation: https://developers.cloudflare.com/durable-objects/platform/pricing/ and https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- Durable Objects metrics in the dashboard: https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
- Deferred Durable Object code updates: https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/
- Turnstile server-side validation and test keys: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ and https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- Workers Logs: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
