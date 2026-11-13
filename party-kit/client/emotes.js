// Emotes and the soundboard: the rules, as plain data and numbers. Nothing here draws or plays.
//
// Shared by a room (which judges) and a page (which shows and plays), so both agree on what
// exists, what a message looks like and how long a player waits between two of them.
//
//   an emote   a tap shows a small picture over your piece on every device ("wave", "laugh").
//   a sound    a tap plays a short sound for the room ("air horn"), and shows a small picture
//              over your piece everywhere, so a device that is muted still sees who did it.
//
// Each is one tiny message to the room. The room checks the player's cooldown, passes it on to
// everybody else and is done: nothing is scheduled, so it costs one event and no wake-up.
//
//   page -> room   { t: "e", e: "wave" }               { t: "sb", k: "horn" }
//   room -> others { t: "e", s: seat, e: "wave" }      { t: "sb", s: seat, k: "horn" }
//   room -> sender { t: "wait", k: "emote" | "sound", in: ms }   refused: too soon (in > 0),
//                                                                or not allowed now (in: -1)
//
// The sounds themselves are in sounds.js and sound-recipes.js. How emotes look is waiting on
// the owner's picks (preview/emotes-artifact.html), so the lists below are the first set, not
// the final one. A room turns all of this on; a game says whether it may be used during play
// (GAME-CONTRACT.md, "Emotes and sounds").
//
// A player's own recorded clips (docs/SOUND-AND-VOICE.md, layer 3, not built) are meant to slot
// in as sounds named by their slot, "own:0" to "own:3", relayed with the sender's seat like any
// other: the room would check that the sender has that clip.

/** The emotes, in the order they are offered. `key` is the key that sends it from a keyboard. */
export const EMOTES = [
  { id: "wave", name: "Wave", key: "1" },
  { id: "laugh", name: "Laugh", key: "2" },
  { id: "taunt", name: "Taunt", key: "3" },
  { id: "hurry", name: "Hurry up", key: "4" },
  { id: "cheer", name: "Cheer", key: "5" },
  { id: "cry", name: "Cry", key: "6" },
  { id: "heart", name: "Love it", key: "7" },
  { id: "shrug", name: "Shrug", key: "8" },
];

/**
 * The sounds, in the order they are offered. Every one is made in the browser (sounds.js): no
 * audio file is shipped or fetched. `key` is the key that plays it from a keyboard: the row of
 * letters under the number keys, without W (it jumps).
 */
export const SOUNDS = [
  { id: "horn", name: "Air horn", key: "Q" },
  { id: "trombone", name: "Sad trombone", key: "E" },
  { id: "applause", name: "Applause", key: "R" },
  { id: "rimshot", name: "Ba-dum-tss", key: "T" },
  { id: "boing", name: "Boing", key: "Y" },
  { id: "crickets", name: "Crickets", key: "U" },
  { id: "ding", name: "Ding", key: "I" },
  { id: "scratch", name: "Record scratch", key: "O" },
];

const EMOTE_IDS = new Set(EMOTES.map((e) => e.id));
const SOUND_IDS = new Set(SOUNDS.map((s) => s.id));

/** A player may send an emote this often. */
export const EMOTE_COOLDOWN_MS = 1500;
/** And a sound this often: longer, since a sound is louder than a picture and the longest lasts under three seconds. */
export const SOUND_COOLDOWN_MS = 4000;
/** The room lets one through this much early: two messages never arrive exactly as far apart as they were sent. */
export const EXPRESS_SLACK_MS = 150;

export const COOLDOWNS = { emote: EMOTE_COOLDOWN_MS, sound: SOUND_COOLDOWN_MS };

/**
 * Whether a game lets players use them while it is being played. A game that says nothing gets
 * these: emotes yes (a picture over a piece disturbs nobody), sounds no (a game has sounds of its own).
 * In the room's lobby both are always on.
 */
export const DURING_PLAY = { emotes: true, sounds: false };

/** What a game's manifest says about play (`manifest.lobby.emotes`, `.sounds`), with the defaults filled in. */
export function playRules(manifest) {
  const lobby = manifest?.lobby ?? {};
  return {
    emotes: typeof lobby.emotes === "boolean" ? lobby.emotes : DURING_PLAY.emotes,
    sounds: typeof lobby.sounds === "boolean" ? lobby.sounds : DURING_PLAY.sounds,
  };
}

/**
 * Whether `kind` ("emote" or "sound") may be used right now. `playing`: a game is on. `rules`:
 * that game's playRules (ignored in the lobby).
 */
export function allowedNow(kind, playing, rules = DURING_PLAY) {
  if (!playing) return true;
  return kind === "emote" ? !!rules.emotes : !!rules.sounds;
}

/** Milliseconds until a player who last sent `kind` at `at` may send another (0: now). */
export function cooldownLeft(kind, at, now) {
  return Math.max(0, (at ?? -Infinity) + COOLDOWNS[kind] - now);
}

/** How full a cooldown is, 0 (just sent) to 1 (ready), for whatever shows it as a ring. */
export function cooldownFraction(kind, left) {
  return 1 - Math.min(1, Math.max(0, left / COOLDOWNS[kind]));
}

/**
 * The room's verdict on one: {ok} or {ok: false, wait}. `at` is when this player's last one of
 * this kind went through. `wait` is the milliseconds left, or -1 when it is not allowed at all now.
 */
export function mayExpress(kind, at, now, { playing = false, rules = DURING_PLAY } = {}) {
  if (!allowedNow(kind, playing, rules)) return { ok: false, wait: -1 };
  const left = cooldownLeft(kind, at, now);
  if (left > EXPRESS_SLACK_MS) return { ok: false, wait: left };
  return { ok: true, wait: 0 };
}

/** A real page waits out its own cooldown, so the room refuses it by network jitter at most: never by this much. */
export const EAGER_MS = 500;

/**
 * A refusal that came far too soon is not a page that misjudged the clock by a few hundred
 * milliseconds: a real page never sends during its own cooldown. The room counts such a message
 * against the socket's rate limit, so a script that hammers the button loses its connection.
 */
export function tooEager(kind, wait) {
  return wait > EAGER_MS;
}

// ---------------------------------------------------------------- the messages

export const emoteMessage = (id) => ({ t: "e", e: id });
export const soundMessage = (id) => ({ t: "sb", k: id });

/** What a page asked for: {kind, id}, or null when it is not a message of ours or names nothing we know. */
export function readRequest(msg) {
  if (msg?.t === "e" && EMOTE_IDS.has(msg.e)) return { kind: "emote", id: msg.e };
  if (msg?.t === "sb" && SOUND_IDS.has(msg.k)) return { kind: "sound", id: msg.k };
  return null;
}

/** What the room passes on to everybody else. */
export function relayFor(kind, seat, id) {
  return kind === "emote" ? { t: "e", s: seat, e: id } : { t: "sb", s: seat, k: id };
}

/** What the room tells a page whose request it refused. */
export const waitMessage = (kind, wait) => ({ t: "wait", k: kind, in: Math.round(wait) });

export const isEmote = (id) => EMOTE_IDS.has(id);
export const isSound = (id) => SOUND_IDS.has(id);
export const emoteById = (id) => EMOTES.find((e) => e.id === id) ?? null;
export const soundById = (id) => SOUNDS.find((s) => s.id === id) ?? null;

// ---------------------------------------------------------------- where a sound is heard

/**
 * Whether this device plays the room's sounds. With a big screen in the room the sound comes
 * from the screen only, like a speaker in the room: four phones on one couch playing the same
 * sound a little out of step is not pleasant. With no screen (friends in different places) it
 * plays on every player's device.
 * @param {"player" | "screen"} role
 * @param {number} screens  big screens connected to the room now
 */
export function soundPlaysHere(role, screens) {
  return role === "screen" || !(screens > 0);
}
