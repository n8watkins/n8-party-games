# n8 Party Games

Small party games for two to four people that share one room kit.
You open a room, friends join with a 4-digit PIN or a QR code, and everyone plays from their own phone or laptop.
Playing alone runs entirely in your browser.

"n8 Party" is a working name.

## What is here

- [`cork-and-bell/`](cork-and-bell/README.md) - Cork & Bell, a 1930s fairground shooting gallery at dusk. One stall on your own, or a battle of two to four stalls side by side. Built with three.js and light baked in Blender.
- [`party-kit/`](party-kit/README.md) - the rooms: PINs, seats, reconnects, bots that take over a dropped seat, and a budget that caps how much hosted time rooms may use. It runs on Cloudflare Workers and Durable Objects.
- [`DEPLOY.md`](DEPLOY.md) - the checklist for putting it online.

A shared lobby, where the party stays together and votes on the next game, is being designed.

## Run it

```sh
npm install
npm run dev     # http://localhost:8791/cork-and-bell/
npm test
```

Everything runs locally; no Cloudflare account is needed to play or develop.
See the two READMEs above for the other commands.

## What it costs to host

Static files and solo play cost nothing.
Only multiplayer rooms use paid compute, and only while a round is being played: rooms sleep in between.
The room budget in the party kit closes battles for the day or month once a set share of the plan's allowance is used.
The details are in the [party kit README](party-kit/README.md).

## License

The code is under the [MIT License](LICENSE).

Third-party parts keep their own licenses:

- three.js, in `cork-and-bell/game/vendor/`, MIT (`LICENSE-three`).
- Abril Fatface and Playfair Display, in `cork-and-bell/game/fonts/`, SIL Open Font License 1.1 (the `OFL-*.txt` files beside them).
