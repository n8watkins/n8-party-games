// Emotes: the kit's rules (party-kit/client/emotes.js) and the room judging them with a fake
// clock: the cooldown, what a game allows during play, and refusals that count as flooding.
import { describe, expect, it } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { boxFromManifest } from "../shared/vote.js";
import {
  DURING_PLAY,
  EMOTES,
  EMOTE_COOLDOWN_MS,
  EXPRESS_SLACK_MS,
  cooldownFraction,
  emoteMessage,
  mayEmote,
  playRules,
  readEmote,
  soundAllowedNow,
  soundPlaysHere,
  tooEager,
} from "../../party-kit/client/emotes.js";

function room(manifest = coinFlipManifest, now = 1000) {
  const boxes = [boxFromManifest(manifest, { test: true })];
  const core = new LobbyCore({ boxes, games: new Map([[manifest.id, coinFlip]]), seed: 3, code: "BCDFGH", now });
  for (const name of ["Mabel", "Tom"]) core.connect(core.join(name, now).token, now);
  return core;
}

describe("the emote list", () => {
  it("has unique ids, each with a name", () => {
    expect(new Set(EMOTES.map((e) => e.id)).size).toBe(EMOTES.length);
    for (const e of EMOTES) expect(e.name.length).toBeGreaterThan(1);
  });

  it("reads only messages that name an emote that exists", () => {
    expect(readEmote(emoteMessage("tomato"))).toBe("tomato");
    expect(readEmote({ t: "e", e: "nope" })).toBeNull();
    expect(readEmote({ t: "e", e: "__proto__" })).toBeNull();
    expect(readEmote({ t: "sb", k: "horn" })).toBeNull();
    expect(readEmote(null)).toBeNull();
  });
});

describe("the rules", () => {
  it("lets one through per cooldown, with a little slack for the network", () => {
    expect(mayEmote(-Infinity, 0).ok).toBe(true);
    expect(mayEmote(0, EMOTE_COOLDOWN_MS - EXPRESS_SLACK_MS).ok).toBe(true);
    expect(mayEmote(0, EMOTE_COOLDOWN_MS - EXPRESS_SLACK_MS - 1)).toEqual({ ok: false, wait: EXPRESS_SLACK_MS + 1 });
    expect(cooldownFraction(EMOTE_COOLDOWN_MS)).toBe(0);
    expect(cooldownFraction(0)).toBe(1);
  });

  it("allows emotes during play and keeps their sounds quiet unless the game says otherwise", () => {
    expect(DURING_PLAY).toEqual({ emotes: true, sounds: false });
    expect(playRules({})).toEqual(DURING_PLAY);
    expect(playRules({ lobby: { view: "x.js" } })).toEqual(DURING_PLAY);
    expect(playRules({ lobby: { emotes: false, emoteSounds: true } })).toEqual({ emotes: false, sounds: true });
    expect(mayEmote(-Infinity, 0, { playing: true })).toEqual({ ok: true, wait: 0 });
    expect(mayEmote(-Infinity, 0, { playing: true, rules: { emotes: false } })).toEqual({ ok: false, wait: -1 });
    expect(soundAllowedNow(false)).toBe(true);
    expect(soundAllowedNow(true)).toBe(false);
    expect(soundAllowedNow(true, { sounds: true })).toBe(true);
  });

  it("plays an emote's sound from the big screen only, when there is one", () => {
    expect(soundPlaysHere("screen", 1)).toBe(true);
    expect(soundPlaysHere("player", 1)).toBe(false);
    expect(soundPlaysHere("player", 0)).toBe(true);
  });

  it("counts only a far-too-early request as flooding", () => {
    expect(tooEager(200)).toBe(false);
    expect(tooEager(450)).toBe(false);
    expect(tooEager(EMOTE_COOLDOWN_MS - 100)).toBe(true);
    expect(tooEager(-1)).toBe(false);
  });
});

describe("the room judging them", () => {
  it("relays an emote to the others and refuses the next one until the cooldown is over", () => {
    const core = room();
    expect(core.emote(0, "tomato", 2000)).toEqual({ relay: { t: "e", s: 0, e: "tomato" } });
    const refused = core.emote(0, "popcorn", 2500);
    expect(refused.relay).toBeUndefined();
    expect(refused.refused).toEqual({ t: "wait", in: EMOTE_COOLDOWN_MS - 500 });
    // Another player has a cooldown of their own.
    expect(core.emote(1, "tomato", 2500).relay).toBeTruthy();
    expect(core.emote(0, "popcorn", 2000 + EMOTE_COOLDOWN_MS).relay).toBeTruthy();
  });

  it("tells a page that arrives in the middle how long it still waits", () => {
    const core = room();
    core.emote(0, "tomato", 2000);
    expect(core.view(2500).members[0].emoteCool).toBe(EMOTE_COOLDOWN_MS - 500);
    expect(core.view(2500).members[1].emoteCool).toBe(0);
  });

  it("sets no wake-up: a cooldown is a time written on the piece", () => {
    const core = room();
    const before = core.nextWake(2000);
    core.emote(0, "tomato", 2000);
    // Nothing sooner than before: only the slow "forgotten room" check moves, and later.
    expect(core.nextWake(2000)).toBeGreaterThanOrEqual(before);
    expect(core.count).toBeNull();
    expect(core.toss).toBeNull();
  });

  it("follows the game being played: emotes by default, none when it says so", () => {
    const core = room();
    expect(core.startGame("coin-flip", 2000).ok).toBe(true);
    expect(core.emote(0, "tomato", 2100).relay).toBeTruthy();
    const quiet = room({ ...coinFlipManifest, lobby: { emotes: false } });
    quiet.startGame("coin-flip", 2000);
    expect(quiet.emote(0, "tomato", 2100).refused).toEqual({ t: "wait", in: -1 });
  });

  it("ignores a seat nobody holds", () => {
    expect(room().emote(3, "tomato", 2000)).toBeNull();
  });
});
