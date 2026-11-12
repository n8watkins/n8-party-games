# n8 Party Games

Small party games for two to four people that share one room kit.
You open a room, friends join with a 4-digit PIN or a QR code, and everyone plays from their own phone or laptop.
Playing alone runs entirely in your browser.
Play it at https://partygames.n8builds.dev.

"n8 Party" is a working name.

## What is here

This repository is two things: the party kit, and the party site that puts the games together.

- [`party-kit/`](party-kit/README.md) - the rooms: PINs, seats, reconnects, bots that take over a dropped seat, and a budget that caps how much hosted time rooms may use. It runs on Cloudflare Workers and Durable Objects. Games take it from here as a dependency.
- [`games.js`](games.js), [`worker.js`](worker.js) and [`scripts/`](scripts/build-public.mjs) - the party site: one Worker that serves every hosted game beside the kit, so a group can change games without leaving.
- [`party-kit/GAME-CONTRACT.md`](party-kit/GAME-CONTRACT.md) - what a game must export for the site to host it.
- [`DEPLOY.md`](DEPLOY.md) - the checklist for every deploy.

Each game is its own repository, and plays on its own from there:

- [Cork & Bell](https://github.com/n8watkins/cork-and-bell) - a 1930s fairground shooting gallery at dusk. One stall on your own, or a battle of two to four stalls side by side. Built with three.js and light baked in Blender.

A shared lobby, where the party stays together and votes on the next game, is being designed.

## Run it

```sh
npm install
npm run dev     # http://localhost:8791/cork-and-bell/
npm test
```

Everything runs locally; no Cloudflare account is needed to play or develop.
See the kit's README for the other commands.

The games are git dependencies, pinned in `package.json`.
npm 12 refuses those unless told otherwise, so [`.npmrc`](.npmrc) sets `allow-git=root`: the git dependencies this package names itself are allowed, and no others.
While the repositories are private, `npm install` also needs a GitHub login that can read them.

## How a game gets in

A game is installed as a development dependency and listed in `games.js`.
The build copies the files its manifest names from `node_modules/<game>/` to the game's path on the site, and the Worker takes its server definition for the rooms.
The game never carries its own copy of the kit: its server code names none, and its page loads the kit's browser files from `/party-kit/client/` on whichever site serves it.
The game in turn takes the kit from this repository as a development dependency, so neither install pulls in the other's.

## What it costs to host

Static files and solo play cost nothing.
Only multiplayer rooms use paid compute, and only while a round is being played: rooms sleep in between.
The room budget in the party kit closes battles for the day or month once a set share of the plan's allowance is used.
The details are in the [party kit README](party-kit/README.md).

## License

The code is under the [MIT License](LICENSE).
Each game carries its own license and the licenses of what it includes.
