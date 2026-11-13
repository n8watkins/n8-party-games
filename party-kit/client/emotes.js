// Emotes: the rules, as plain data and numbers. Nothing here draws or plays.
//
// Shared by a room (which judges) and a page (which shows and plays), so both agree on what
// exists, what a message looks like and how long a player waits between two of them.
//
// An emote is a tap that shows something over your piece on every device, and may carry a
// short sound of its own. It is one tiny message to the room. The room checks the player's
// cooldown, passes it on to everybody else and is done: nothing is scheduled, so it costs one
// event and no wake-up.
//
//   page -> room   { t: "e", e: "violin" }
//   room -> others { t: "e", s: seat, e: "violin" }
//   room -> sender { t: "wait", in: ms }    refused: too soon (in > 0), or not allowed now (in: -1)
//
// There is no soundboard: the owner dropped it on 2026-11-13 ("just emotes"). An emote's sound
// plays where the room's sounds play (soundPlaysHere) and the device's volume and mutes apply.
//
// Which emotes there will be waits on the owner's picks (preview/emotes-artifact-v4.html), so
// EMOTES below is every candidate in that preview: the room accepts any of them until the set
// is chosen. A player's wheel holds six, and number keys 1 to 6 send them from a keyboard.

/** Every candidate: the id the room checks, and the name people read. The page draws them. */
export const EMOTES = [
  { id: "violin", name: "World's smallest violin" },
  { id: "popcorn", name: "Popcorn" },
  { id: "slowclap", name: "Slow clap" },
  { id: "pointlaugh", name: "Point and laugh" },
  { id: "redcard", name: "Red card" },
  { id: "hurry", name: "Hurry up" },
  { id: "thumbsup", name: "Thumbs up" },
  { id: "confetti", name: "Confetti" },
  { id: "boo", name: "Boo" },
  { id: "trophy", name: "GG" },
  { id: "shush", name: "Shh" },
  { id: "lighter", name: "Lighter up" },
  { id: "scratch", name: "Huh?" },
  { id: "steam", name: "Fuming" },
];

const IDS = new Set(EMOTES.map((e) => e.id));

/** How many emotes a player's wheel holds, and so how many number keys send them. */
export const WHEEL_SLOTS = 6;

/** A player may send an emote this often. */
export const EMOTE_COOLDOWN_MS = 1500;
/** The room lets one through this much early: two messages never arrive exactly as far apart as they were sent. */
export const EXPRESS_SLACK_MS = 150;
/** A real page waits out its own cooldown, so the room refuses it by network jitter at most: never by this much. */
export const EAGER_MS = 500;

/**
 * Whether a game lets players use them while it is being played. A game that says nothing gets
 * these: emotes yes (a picture over a piece disturbs nobody), their sounds no (a game has sounds
 * of its own). In the room's lobby both are always on.
 */
export const DURING_PLAY = { emotes: true, sounds: false };

/** What a game's manifest says about play (`manifest.lobby.emotes`, `.emoteSounds`), with the defaults filled in. */
export function playRules(manifest) {
  const lobby = manifest?.lobby ?? {};
  return {
    emotes: typeof lobby.emotes === "boolean" ? lobby.emotes : DURING_PLAY.emotes,
    sounds: typeof lobby.emoteSounds === "boolean" ? lobby.emoteSounds : DURING_PLAY.sounds,
  };
}

/** Milliseconds until a player who last sent an emote at `at` may send another (0: now). */
export function cooldownLeft(at, now) {
  return Math.max(0, (at ?? -Infinity) + EMOTE_COOLDOWN_MS - now);
}

/** How full the cooldown is, 0 (just sent) to 1 (ready), for whatever shows it as a ring. */
export function cooldownFraction(left) {
  return 1 - Math.min(1, Math.max(0, left / EMOTE_COOLDOWN_MS));
}

/**
 * The room's verdict: {ok} or {ok: false, wait}. `at` is when this player's last emote went
 * through. `wait` is the milliseconds left, or -1 when emotes are not allowed at all now.
 */
export function mayEmote(at, now, { playing = false, rules = DURING_PLAY } = {}) {
  if (playing && !rules.emotes) return { ok: false, wait: -1 };
  const left = cooldownLeft(at, now);
  if (left > EXPRESS_SLACK_MS) return { ok: false, wait: left };
  return { ok: true, wait: 0 };
}

/**
 * A refusal that came far too soon is not a page that misjudged the clock by a few hundred
 * milliseconds: a real page never sends during its own cooldown. The room counts such a message
 * against the socket's rate limit, so a script that hammers the button loses its connection.
 */
export function tooEager(wait) {
  return wait > EAGER_MS;
}

// ---------------------------------------------------------------- the messages

export const emoteMessage = (id) => ({ t: "e", e: id });

/** The emote a page asked for, or null when it is not one or names nothing we know. */
export function readEmote(msg) {
  return msg?.t === "e" && IDS.has(msg.e) ? msg.e : null;
}

/** What the room passes on to everybody else. */
export const relayEmote = (seat, id) => ({ t: "e", s: seat, e: id });

/** What the room tells a page whose emote it refused. */
export const waitMessage = (wait) => ({ t: "wait", in: Math.round(wait) });

export const isEmote = (id) => IDS.has(id);
export const emoteById = (id) => EMOTES.find((e) => e.id === id) ?? null;

// ---------------------------------------------------------------- where an emote's sound is heard

/**
 * Whether this device plays an emote's sound. With a big screen in the room the sound comes
 * from the screen only, like a speaker in the room: four phones on one couch playing the same
 * sound a little out of step is not pleasant. With no screen (friends in different places) it
 * plays on every player's device.
 * @param {"player" | "screen"} role
 * @param {number} screens  big screens connected to the room now
 */
export function soundPlaysHere(role, screens) {
  return role === "screen" || !(screens > 0);
}

/** Whether an emote's sound plays now: during a game only if the game allows it. */
export function soundAllowedNow(playing, rules = DURING_PLAY) {
  return !playing || !!rules.sounds;
}
