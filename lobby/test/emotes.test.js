// Emotes and sounds: the kit's rules (party-kit/client/emotes.js) and the room judging them
// with a fake clock: cooldowns, what a game allows during play, and refusals that count as flooding.
import { describe, expect, it } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { boxFromManifest } from "../shared/vote.js";
import {
  DURING_PLAY,
  EMOTES,
  EMOTE_COOLDOWN_MS,
  EXPRESS_SLACK_MS,
  SOUNDS,
  SOUND_COOLDOWN_MS,
  allowedNow,
  cooldownFraction,
  emoteMessage,
  mayExpress,
  playRules,
  readRequest,
  soundMessage,
  soundPlaysHere,
  tooEager,
} from "../../party-kit/client/emotes.js";

function room(manifest = coinFlipManifest, now = 1000) {
  const boxes = [boxFromManifest(manifest, { test: true })];
  const core = new LobbyCore({ boxes, games: new Map([[manifest.id, coinFlip]]), seed: 3, code: "BCDFGH", now });
  for (const name of ["Mabel", "Tom"]) core.connect(core.join(name, now).token, now);
  return core;
}

describe("the emote and sound lists", () => {
  it("has unique ids and unique keys that clash with no move", () => {
    const keys = [...EMOTES, ...SOUNDS].map((x) => x.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    // Walking (A, D), jumping (W, Space) and bumping (B, X) keep their keys.
    for (const taken of ["a", "d", "w", " ", "b", "x"]) expect(keys).not.toContain(taken);
    expect(new Set(EMOTES.map((e) => e.id)).size).toBe(EMOTES.length);
    expect(new Set(SOUNDS.map((s) => s.id)).size).toBe(SOUNDS.length);
  });

  it("reads only messages that name something that exists", () => {
    expect(readRequest(emoteMessage("wave"))).toEqual({ kind: "emote", id: "wave" });
    expect(readRequest(soundMessage("horn"))).toEqual({ kind: "sound", id: "horn" });
    expect(readRequest({ t: "e", e: "nope" })).toBeNull();
    expect(readRequest({ t: "sb", k: "__proto__" })).toBeNull();
    expect(readRequest({ t: "m" })).toBeNull();
    expect(readRequest(null)).toBeNull();
  });
});

describe("the rules", () => {
  it("lets one through per cooldown, with a little slack for the network", () => {
    expect(mayExpress("emote", -Infinity, 0).ok).toBe(true);
    expect(mayExpress("emote", 0, EMOTE_COOLDOWN_MS - EXPRESS_SLACK_MS).ok).toBe(true);
    expect(mayExpress("emote", 0, EMOTE_COOLDOWN_MS - EXPRESS_SLACK_MS - 1)).toEqual({ ok: false, wait: EXPRESS_SLACK_MS + 1 });
    expect(mayExpress("sound", 0, 1000)).toEqual({ ok: false, wait: SOUND_COOLDOWN_MS - 1000 });
    expect(SOUND_COOLDOWN_MS).toBeGreaterThan(EMOTE_COOLDOWN_MS);
    expect(cooldownFraction("sound", SOUND_COOLDOWN_MS)).toBe(0);
    expect(cooldownFraction("sound", 0)).toBe(1);
  });

  it("allows emotes and not sounds during play unless the game says otherwise", () => {
    expect(DURING_PLAY).toEqual({ emotes: true, sounds: false });
    expect(playRules({})).toEqual(DURING_PLAY);
    expect(playRules({ lobby: { view: "x.js" } })).toEqual(DURING_PLAY);
    expect(playRules({ lobby: { emotes: false, sounds: true } })).toEqual({ emotes: false, sounds: true });
    expect(allowedNow("sound", false)).toBe(true);
    expect(allowedNow("sound", true)).toBe(false);
    expect(allowedNow("emote", true)).toBe(true);
    expect(mayExpress("sound", -Infinity, 0, { playing: true })).toEqual({ ok: false, wait: -1 });
  });

  it("plays sounds from the big screen only, when there is one", () => {
    expect(soundPlaysHere("screen", 1)).toBe(true);
    expect(soundPlaysHere("player", 1)).toBe(false);
    expect(soundPlaysHere("player", 0)).toBe(true);
  });

  it("counts only a far-too-early request as flooding", () => {
    expect(tooEager("emote", 200)).toBe(false);
    expect(tooEager("sound", 450)).toBe(false);
    expect(tooEager("emote", EMOTE_COOLDOWN_MS - 100)).toBe(true);
    expect(tooEager("sound", 1000)).toBe(true);
    expect(tooEager("sound", -1)).toBe(false);
  });
});

describe("the room judging them", () => {
  it("relays an emote to the others and refuses the next one until the cooldown is over", () => {
    const core = room();
    expect(core.express(0, "emote", "wave", 2000)).toEqual({ relay: { t: "e", s: 0, e: "wave" } });
    const refused = core.express(0, "emote", "laugh", 2500);
    expect(refused.relay).toBeUndefined();
    expect(refused.refused).toEqual({ t: "wait", k: "emote", in: EMOTE_COOLDOWN_MS - 500 });
    // Another player has a cooldown of their own, and a sound has its own clock.
    expect(core.express(1, "emote", "wave", 2500).relay).toBeTruthy();
    expect(core.express(0, "sound", "horn", 2500)).toEqual({ relay: { t: "sb", s: 0, k: "horn" } });
    expect(core.express(0, "emote", "laugh", 2000 + EMOTE_COOLDOWN_MS).relay).toBeTruthy();
    expect(core.express(0, "sound", "horn", 2500 + SOUND_COOLDOWN_MS - 1000).refused.in).toBe(1000);
  });

  it("tells a page that arrives in the middle how long it still waits", () => {
    const core = room();
    core.express(0, "sound", "horn", 2000);
    const me = core.view(3000).members[0];
    expect(me.soundCool).toBe(SOUND_COOLDOWN_MS - 1000);
    expect(me.emoteCool).toBe(0);
  });

  it("sets no wake-up: a cooldown is a time written on the piece", () => {
    const core = room();
    const before = core.nextWake(2000);
    core.express(0, "emote", "wave", 2000);
    core.express(0, "sound", "horn", 2000);
    // Nothing sooner than before: only the slow "forgotten room" check moves, and later.
    expect(core.nextWake(2000)).toBeGreaterThanOrEqual(before);
    expect(core.count).toBeNull();
    expect(core.toss).toBeNull();
  });

  it("follows the game being played: emotes by default, sounds only when it allows them", () => {
    const core = room();
    expect(core.startGame("coin-flip", 2000).ok).toBe(true);
    expect(core.express(0, "emote", "wave", 2100).relay).toBeTruthy();
    expect(core.express(0, "sound", "horn", 2100).refused).toEqual({ t: "wait", k: "sound", in: -1 });
    const loud = room({ ...coinFlipManifest, lobby: { emotes: false, sounds: true } });
    loud.startGame("coin-flip", 2000);
    expect(loud.express(0, "emote", "wave", 2100).refused.in).toBe(-1);
    expect(loud.express(0, "sound", "horn", 2100).relay).toBeTruthy();
  });

  it("ignores a seat nobody holds", () => {
    expect(room().express(3, "emote", "wave", 2000)).toBeNull();
  });
});
