# n8 Party Games

Small party games for two to four people that share one room kit.
You open a room, friends join with a 4-digit PIN or a QR code, and everyone plays from their own phone or laptop.
Playing alone runs entirely in your browser.
Play it at https://partygames.n8builds.dev.

"n8 Party" is a working name.

## What is here

This repository is three things: the party kit, the party room (the lobby), and the party site that puts them and the games together.

- [`party-kit/`](party-kit/README.md) - the rooms: PINs, seats, reconnects, bots that take over a dropped seat, and a budget that caps how much hosted time rooms may use. It runs on Cloudflare Workers and Durable Objects. Games take it from here as a dependency.
- [`lobby/`](lobby/README.md) - the party room: one room where up to four players vote for the next game by standing in its light, play it, and come back with points. A first playable version.
- [`games.js`](games.js), [`worker.js`](worker.js), [`site/`](site/index.html) and [`scripts/`](scripts/build-public.mjs) - the party site: one Worker that serves the front page, the party room and every hosted game beside the kit.
  The front page asks "How do you want to play?" and opens three doors: In the room (the Floor), Round the table (the Table, started at `/table/`) and Pass one device.
  What it calls playable comes from the production wall (`lobby/wall.js`), which the build copies to `/home-wall.js`; `site/test/home.test.js` keeps the two in step.
- [`one-device/`](one-device/hot-potato/README.md) - games played on one phone or browser passed around the group, with no server: Hot Potato, a spoken word chain, at `/one-device/hot-potato/`, behind the front page's Pass one device door.
- [`landing/`](landing/public/index.html) - a new front page that is waiting for approval. Only the local build serves it, at `/preview/landing/`; its pictures are made by the scripts in `landing/tools/`.
- [`party-kit/GAME-CONTRACT.md`](party-kit/GAME-CONTRACT.md) - what a game must export for the site to host it.
- [`DEPLOY.md`](DEPLOY.md) - the checklist for every deploy.

Each game is its own repository, and plays on its own from there:

- [Cork & Bell](https://github.com/n8watkins/cork-and-bell) - a 1930s fairground shooting gallery at dusk. One stall on your own, or a battle of two to four stalls side by side. Built with three.js and light baked in Blender.

Cork & Bell hangs on the party room's wall and is played inside the room: when it wins the vote a battle starts for the party's seats, and the places go on the Tonight board.
Who Am I? hangs there too as an outside game: it plays on its own site, and winning the vote sends everyone there.
Coin Flip, a placeholder marked as a test, hangs only in local play and the test runs.

## Run it

```sh
npm install
npm run dev     # http://localhost:8791/ (the party room) and /cork-and-bell/ (the game on its own)
npm test
```

To try the party room on one laptop, open `http://localhost:8791/` in two browser windows, start a party in one and join with its code in the other.

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
Only rooms use paid compute, and only while they are awake.
A game's own room is awake while a round is being played and sleeps in between.
The party room is awake for the instant each move takes to pass on, and for the few seconds a game is played; a lobby nobody touches is asleep.
The room budget in the party kit closes rooms for the day or month once a set share of the plan's allowance is used.
The details are in the [party kit README](party-kit/README.md), and the party room's measured numbers are in the [lobby README](lobby/README.md).

## Credit

[![YouTube: @nicksaraev](https://img.shields.io/badge/YouTube-%40nicksaraev-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@nicksaraev)
[![YouTube: the Fable 5.2 demos video](https://img.shields.io/badge/YouTube-Demos%20video-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=wpFw66kKixU)
[![YouTube: the Fable 5.2 builds video](https://img.shields.io/badge/YouTube-Builds%20video-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=5mA9Hab09Do)
[![Skool: Maker Zero, where Nick's prompt packs are](https://img.shields.io/badge/Skool-Maker%20Zero-1d1d1f)](https://www.skool.com/maker-zero/about)

The party games started from build prompts by Nick Saraev, published with two of his Claude Fable 5.2 videos.
Each of his prompts is a single-player build; each game here takes one and remakes it for friends playing together on their phones.

| Game | Nick's prompt | From his video | State |
| --- | --- | --- | --- |
| [Cork & Bell](https://github.com/n8watkins/cork-and-bell) | The cork gallery | [I Threw $1000 at Fable 5.2 to Build The Coolest Demos Possible](https://www.youtube.com/watch?v=wpFw66kKixU) | Built |
| Flood | The tile river | [I Threw $1000 at Fable 5.2 to Build The Coolest Demos Possible](https://www.youtube.com/watch?v=wpFw66kKixU) | Planned |
| Bathtub Regatta (Tin Derby on the party room's wall) | Wind-up derby | [13 INSANE Things You Can Build w/ Claude Fable 5.2](https://www.youtube.com/watch?v=5mA9Hab09Do) | Planned |
| Fox Trouble | The fox knight, loosely | [13 INSANE Things You Can Build w/ Claude Fable 5.2](https://www.youtube.com/watch?v=5mA9Hab09Do) | Planned |

Where to find Nick:

- YouTube: [@nicksaraev](https://www.youtube.com/@nicksaraev)
- [Maker Zero](https://www.skool.com/maker-zero/about), his free community on Skool.
  Nick's prompt pack for each of the two videos is free there; both videos' descriptions send you there for it.
- [Maker School](https://www.skool.com/makerschool/about), his paid community on Skool.

The text of the four prompts in the table is kept unchanged in [`credits/nick-saraev/`](credits/nick-saraev/README.md), with where it came from and where to get his full prompt packs.
The MIT License here covers this project's own code and assets, apart from the exceptions under License; Nick's prompts and any wording taken from them remain his and are not licensed by this repository.
This project is not affiliated with Nick Saraev or endorsed by him.

## License

The code is under the [MIT License](LICENSE).
Each game carries its own license and the licenses of what it includes.
Nick Saraev's prompts, and any wording taken from them, are his and not under the MIT License, including the four prompts in `credits/nick-saraev/` (see [Credit](#credit)).

The front page's two fonts (`site/fonts/`, Baloo 2 and Nunito) are not under the MIT License: they are under the SIL Open Font License 1.1, whose text is beside each of them.

The party room's sounds (`lobby/public/sounds/*.mp3`) are not under the MIT License.
Every one of them was made from a recording released under Creative Commons Zero (CC0 1.0, public domain).
Most of the room's own sounds come from Kenney's Impact Sounds, Interface Sounds, Casino Audio and RPG Audio packs (kenney.nl).
The emote sounds, and a few room sounds, come from single recordings on Freesound by sammy214, semccab, schots, SpliceSound, DavidJGurney, tonmayster, Streety, dr_skitz, Breviceps, connerdrake98, DeezSoundzTho, esperar, keweldog, kaydinhamby, qubodup, Raventhornn, simkiott, skymary and florianreichelt.
[`lobby/public/sounds/CREDITS.txt`](lobby/public/sounds/CREDITS.txt) names the recording behind each file, with its page, and [`preview/recordings/sources.json`](preview/recordings/sources.json) keeps the full source record (title, author, page, licence as read on the page, and the date it was read).
`preview/recordings/ship.mjs` remakes the files from those recordings.
