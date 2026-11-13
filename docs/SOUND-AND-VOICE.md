# Emotes, soundboard, voice lines and live voice

Written 2026-11-12.
It covers how players express themselves in the party room and in games, from the cheapest idea to the hardest.
Everything here belongs to the party kit, not to any one game, so it is built once and every game inherits it.

## Status (2026-11-13)

The owner's decisions on 2026-11-13, after the first preview:

- **Just emotes.** The soundboard (layer 2) is dropped: "I think we just kill the idea of a soundboard. Just emotes." Own voice lines (layer 3) are parked with it, since they were pads on that board.
- **An emote may carry its own short sound**, a recording from a public-domain library rather than one made in the browser (he judged the made-up ones bad by ear). Only CC0 or an equally free licence, each file's source recorded, nothing committed until he picks.
- **The wheel** (hold the button and flick) is the way to send one on a phone; a laptop uses the number keys 1 to 6 for the same six.
- Of the first round of emotes, four made sense to him: the world's smallest violin, popcorn, the slow clap, and point and laugh (without the other piece looking knocked out). A second round, built to that standard, was shown next; the third gave the pawn detailed floating hands, which the owner found "kind of creepy"; in the fourth (`preview/emotes-artifact-v4.html`) every limb is a stick arm in the piece's colour, with no arms, a mitten or a small cartoon hand depending on what the emote needs, and every emote is data (`preview/emotes/rig.js`) that both the flat room and the 3D look can draw. His sound picks so far: violin A, popcorn B, slow clap C, red card B, lighter C.

Built (branch `feat/emotes-sounds`):

- The rules, in the kit (`party-kit/client/emotes.js`): the message shapes, a per-player cooldown the room enforces (1.5 s), and a game's say during play (`manifest.lobby.emotes` and `.emoteSounds`; by default emotes yes, their sounds no).
- The room passes each emote on and is done: one event, no wake-up, no timer. It tells a page that sent one too soon how long is left, and a script that keeps sending them is closed within about two seconds.
- The player on each device (`party-kit/client/sounds.js`) for an emote's recording: volume, "mute all sounds" and "mute this player", kept on the device. It plays nothing before the browser allows sound and never plays a backlog when it does. It plays from the big screen only when the room has one, and on every player's device when it has none.
- Until the look is chosen, the room says who did what in a note at the top ("Tom: Slow clap"), so a sound is never the only signal.
- The tools that find, check and prepare the recordings: `preview/recordings/` (each file's title, author, page, licence line and the date it was read are in `records.json`).

Waiting on the owner's picks: which emotes, how they look over a piece, and which recording each carries. When he picks, the chosen files go in with a credits file.

Not done: live voice (layer 4). The sections below are the plan as it was written on 2026-11-12; layers 2 and 3 are kept for the record.

## The short version

- There are four layers, and each one works without the next: emotes, a soundboard, your own voice lines, and live voice.
- Layers 1 to 3 can be built now, cost close to nothing to run, and need no new infrastructure.
- Layer 4 (live voice) can also be free at our scale, but the risk is how phones behave, not money.
- Recommendation: build layers 1 and 2 together, then layer 3, then run a small live voice test on real phones before deciding on layer 4.
- Video calling is out of scope.

## Layer 1: emotes

What it is: a tap shows a bubble or a small animation over your piece, as in TFT or League of Legends.

- The first set, picked by the owner earlier: wave, laugh, taunt, hurry up.
- The phone gets an emote button that opens a small wheel; a laptop uses number keys.
- The big screen shows every emote, so the couch sees it.
- An emote is one tiny message through the room's existing connection, and the room goes back to sleep after passing it on.
- Each player has a short cooldown so nobody can flood the room.
- Emotes work in the waiting room first; a game may allow them during play.

## Layer 2: soundboard (dropped by the owner on 2026-11-13)

What it is: a tap plays a short sound that everyone hears, such as an air horn, a sad trombone, applause, a drum sting, or a spoken "Hurry up!".

- The sounds ship with the kit as small audio files, so sending one is still just a tiny message naming the sound.
  (A first build made them in the browser instead; the owner judged them bad by ear on 2026-11-13.)
- No microphone, no permission prompt, and no privacy question.
- Where the sound plays matters:
  - If the room has a big screen, the sound plays from the big screen only, like a speaker in the room.
    Four phones on one couch playing the same sound slightly out of step would be unpleasant.
  - If there is no big screen (friends in different places), it plays on every phone.
- Controls every player gets: a volume slider, "mute sounds", and "mute this player".
- A longer cooldown than emotes, and the room refuses a sound sent during a cooldown.
- Phones only play sound after a tap, so a player who has not touched the page yet sees the emote bubble without the sound.
- The sounds need a source with a clear licence: recorded by us, generated, or from a library whose licence allows open source redistribution.
  This must be settled before any file is committed, because the repository is public and MIT.

## Layer 3: your own voice lines (parked with the soundboard on 2026-11-13)

What it is: you record a few short clips of your own voice (or any sound) and they appear on your soundboard next to the built-in ones.

How it would work:

1. In the room, a player opens "My sounds" and holds a button to record a clip of at most 3 seconds.
   The browser asks for the microphone once, the normal way.
2. The clip is trimmed, made mono and kept small (about 15 to 40 KB each).
3. Clips are saved on the player's own device, so they are there next time without any account.
4. When the player joins a room, the clips are sent to the room once, and the room hands them to the other players.
   After that, playing a line is a tiny message naming the clip, the same as a built-in sound.
5. The room keeps the clips only while it is open and deletes them when it closes.

Limits that keep it cheap and safe:

- At most 4 clips per player and 3 seconds each, so a full room of four holds well under 1 MB.
- The room checks size and count and refuses anything larger.
- Nothing is stored on a server beyond the life of the room, and nothing is ever public.
- "Mute this player" covers a friend who records something annoying.
- A clip is by its nature a recording, and the screen says so plainly when you record it.

Cost: a handful of slightly larger messages when a player joins, then the same as the soundboard.

How it would have slotted in beside the board's sounds (designed, not built, and parked with the board):

- A clip is named by who owns it and which of their slots it is, so there are no global ids to manage: a page sends `{ t: "sb", k: "own:2" }` and the room relays `{ t: "sb", s: <seat>, k: "own:2" }`.
- The room checks the clip exists for that seat, with the same 4-second cooldown and flood rule as any sound.
- On each page a clip is one more named sound for the player (`defineSound` in `party-kit/client/sounds.js`), so muting, "mute this player", the big-screen rule and unlocking need nothing new.
- On the board, a player's own clips are pads beside the built-in ones (the preview shows three mock pads).

To check on real phones before building: iPhones and Android phones record in different audio formats, and each must be able to play the other's clips.
The safe route is to convert every clip to one plain format on the device before sending it.

## Layer 4: live voice

What it is: friends in different places talk to each other through the page, with the normal microphone prompt.

### Why audio does not go through the room

The room's connection (a WebSocket) is the wrong tool for live audio.
Every sound would pass through the room, which would keep it awake for the whole call and spend the shared 10% allowance, and the delay would be noticeable.
Live audio uses a different browser feature made for calls, WebRTC, where the phones send audio to each other.

### The infrastructure

1. **Introductions through the room.** When a player turns voice on, the phones exchange a few short set-up messages through the room's existing connection, then the room goes back to sleep.
2. **Audio between the phones.** With four players each phone connects to the other three, six connections in all.
   That is fine for audio at this size.
3. **A relay for when direct fails.** Some networks, mobile data especially, block direct connections.
   Cloudflare runs a relay for this (Realtime TURN).
   Without it those players would get silence with no error, so the relay is required, not optional.
4. **A small Worker route** that hands each phone a short-lived pass for the relay.

### What it costs

| Item | Cost at our scale |
| --- | --- |
| Set-up messages through the room | A few billed requests per call, close to nothing |
| Room awake time during a call | None, the room sleeps while people talk |
| Audio sent directly between phones | Free, it never touches Cloudflare |
| Audio through Cloudflare's relay | First 1,000 GB a month free, then $0.05 per GB |

Twenty one-hour parties of four in a month come to about 4 GB even if every connection used the relay, so the bill is $0.
Prices are from Cloudflare's pricing page, last updated 2026-09-22.

### Privacy

- **Internet addresses.** A direct connection shows each player's internet address to the others.
  Sending all audio through the relay hides it and is still free at our scale, so the plan is relay only.
- **Opt in.** Voice is off for everyone until they turn it on themselves, each time they join.
- **Mic light.** A clear indicator on your own screen and next to your piece whenever your microphone is live.
- **No recording.** Live voice is never recorded or stored by the site.
  The site cannot stop a listener from recording on their own device, the same as any call, and the privacy note should say so.
- **A privacy note** on the site covering the microphone, what is kept (nothing) and the relay.
- **Not researched yet:** rules about children using voice features on a public site.

### The stranger question, explained

A room is joined with a 4-digit code, so there are 10,000 possible codes.
Someone who types codes at random could land in a room that is not theirs.
Today that only means an unknown piece walks into the room, which is harmless.
With voice it would mean a stranger could hear the party, or speak to it.

What already protects a room:

- Guessing is rate limited: 20 code tries per ten minutes and 60 per hour from one address.
- A room holds at most four players.

What voice would add:

- **Lock the door.** Once everyone is in, the host locks the room and no new device can join.
  Voice only works in a locked room.
- **New arrivals are announced** by name on every screen, so nobody is in the room unnoticed.
- A longer code is possible but makes joining slower for everyone, and the lock solves the problem better.

### Risks that are about phones, not money

- **iPhone audio mode.** Opening the microphone can switch an iPhone into call mode, which makes game sounds quieter or moves them to the earpiece.
  Nobody could confirm how bad this is without a test on real phones.
- **Locking the phone.** The microphone may cut out when the phone locks or the page goes to the background, and must be picked up again on return.
  Sources disagree on the details.
- **Same room.** Several open microphones near each other cause echo and howling.
  Live voice is meant for friends in different places, and it is push to talk, so a microphone is only open while a button is held.
- **Bluetooth headsets** drop to a lower sound quality when the microphone opens.
- **Testing.** It has to be tried on real iPhones and Android phones, on Wi-Fi and on mobile data.

### A test before deciding

Before building live voice properly, build a throwaway page that does only this: two to four phones join, hold a button to talk, with a game sound looping in the background.
Try it on the owner's own phones and one friend's on mobile data.
It answers the iPhone audio question, the lock screen question and whether the relay connects, and that decides whether layer 4 is worth building.

## Where this sits in the party kit

- The kit owns the emote wheel, the soundboard, "My sounds", the voice button, mute controls and the mic light.
- The party room turns all of it on.
- The game contract gains a small optional section, so a game that says nothing keeps working:
  - whether emotes and sounds are allowed during play (default: emotes yes, sounds no),
  - whether the game wants the room to lower or mute voice at some moment, which Who Am I may want during a turn.
- Outside games get all of it without writing any code.

## Cost summary

| Layer | New infrastructure | Running cost | Microphone |
| --- | --- | --- | --- |
| 1. Emotes | None | Close to nothing | No |
| 2. Soundboard | None | Close to nothing | No |
| 3. Own voice lines | None | Close to nothing | Once, to record |
| 4. Live voice | Cloudflare's relay and one small route | $0 at our scale | Yes, while talking |

All four count against the shared 10% room allowance only for the brief moments the room passes a message.

## Order of work

1. Emotes and the built-in soundboard together, since they share the button, the cooldown, the mute controls and the big screen rule.
   This starts after the current room feel work is merged, because it touches the same files.
2. Own voice lines.
3. The live voice test on real phones.
4. Live voice, only if the test goes well and the owner still wants it.

Each step is a well-specified build, so none of them needs the most capable model; the live voice test and build are the exception because of the phone behaviour involved.

## Decisions for the owner

1. The first emotes and sounds: is the starting list right (wave, laugh, taunt, hurry up; air horn, sad trombone, applause, drum sting, "Hurry up!")?
2. Where the built-in sounds come from: recorded by us, generated, or a licensed library.
   Decided: recordings from public-domain (CC0) libraries, each one with its source recorded and approved by the owner before it is committed.
3. Own voice lines: are 4 clips of 3 seconds each the right size?
4. Whether to run the live voice test after layer 3, or leave live voice alone for now.

## Not verified

- The share of connections that need the relay today; the figures found (15 to 20%) are from 2016 or from vendors, and mobile data may be worse.
- Whether Cloudflare's relay gets through the most restrictive networks.
- How iPhones and Android phones treat an open microphone when the phone locks.
- How an open microphone on an iPhone affects a game's own sound.
- Whether the page's microphone works while the phone is also on a Discord or phone call.
- Which audio format both iPhones and Android phones can record and play for own voice lines.
