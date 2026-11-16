// Hot Potato's rules (public/game.js) against the real shipped lists, through the shared matcher:
// turn order, the fuse and its stages, misses and the burst, appeals, dead-end letters, pausing,
// and what the art is told. No DOM and no drawing here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BURST_MS,
  DOOM_MS,
  FUSE_SECONDS,
  GRACE_MS,
  LAST_STAGE,
  LIGHTS,
  SETTLE_MS,
  appeal,
  artState,
  canAppeal,
  canStart,
  drainEvents,
  fuseShare,
  hear,
  lightFuse,
  livesLeft,
  newRound,
  setPaused,
  speaking,
  startTurn,
  tick,
  timeUp,
} from "../public/game.js";
import { CATEGORIES } from "../shared/categories.js";
import { buildIndex } from "../shared/logic.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../shared/${name}`, import.meta.url), "utf8"));
const words = load("words.json");
const cities = buildIndex(load("cities.json"), words, CATEGORIES.cities);
const animals = buildIndex(load("animals.json"), words, CATEGORIES.animals);
const countries = buildIndex(load("countries.json"), words, CATEGORIES.countries);

const said = (text, confidence = 0.9) => [{ transcript: text, confidence }];
const types = (g) => drainEvents(g).map((e) => e.type);

/** Starts the holder's turn once the potato has settled, with the fuse lit. */
function go(g) {
  tick(g, SETTLE_MS);
  expect(startTurn(g)).toBe(true);
  lightFuse(g);
}
/** One whole turn: start, then say a word. */
function play(g, text) {
  go(g);
  return hear(g, said(text));
}
/** One turn where nobody speaks: the fuse burns down. */
function silence(g) {
  go(g);
  tick(g, g.fuse + 1);
  return g.last;
}

describe("a round", () => {
  it("starts healthy with the first player holding it, any letter and a full fuse", () => {
    const g = newRound({ index: cities, players: 4 });
    expect(g.holder).toBe(0);
    expect(g.stage).toBe(0);
    expect(livesLeft(g)).toBe(5);
    expect(g.need).toBe("");
    expect(g.phase).toBe("ready");
    expect(canStart(g)).toBe(true);
    expect(fuseShare(g)).toBe(1);
  });

  it("keeps 2 to 8 players", () => {
    expect(newRound({ index: cities, players: 1 }).players).toBe(2);
    expect(newRound({ index: cities, players: 12 }).players).toBe(8);
  });

  it("passes the potato round the circle, back to the first", () => {
    const g = newRound({ index: cities, players: 3 });
    const holders = [];
    for (const w of ["Paris", "Sydney", "York", "Kyoto"]) {
      holders.push(g.holder);
      expect(play(g, w).ok).toBe(true);
    }
    expect(holders).toEqual([0, 1, 2, 0]);
    expect(g.holder).toBe(1);
  });

  it("chains on the last letter and says why a word is refused", () => {
    const g = newRound({ index: cities, players: 2 });
    play(g, "Los Angeles");
    expect(g.need).toBe("s");
    const v = play(g, "Paris");
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("wrong-letter");
    expect(v.why).toBe("Paris starts with P, not S");
    const again = play(g, "Los Angeles");
    expect(again.ok).toBe(false);
    expect(again.why).toMatch(/Los Angeles/);
    const word = play(g, "salmon");
    expect(word.why).toBe('"Salmon" is not a city');
  });

  it("refuses a city already said", () => {
    const g = newRound({ index: cities, players: 2 });
    play(g, "Oslo");
    play(g, "Ottawa");
    play(g, "Amsterdam");
    const v = play(g, "Madrid");
    expect(v.ok).toBe(true);
    play(g, "Dublin");
    const back = play(g, "Nairobi");
    expect(back.ok).toBe(true);
    const repeat = play(g, "Istanbul");
    expect(repeat.ok).toBe(true);
    // L: London is fresh, but "Lima" twice is a repeat.
    play(g, "Lima");
    play(g, "Accra");
    const twice = play(g, "Athens");
    expect(twice.ok).toBe(true);
    play(g, "Seoul");
    const lima = play(g, "Lima");
    expect(lima.ok).toBe(false);
    expect(lima.reason).toBe("used");
    expect(lima.why).toBe("Lima was said already");
  });

  it("goes back a letter past a dead end, through the shared matcher (monkey needs an E among animals)", () => {
    const g = newRound({ index: animals, players: 2 });
    const v = play(g, "monkey");
    expect(v.ok).toBe(true);
    expect(g.need).toBe("e");
    expect(g.skipped).toEqual(["y"]);
    expect(v.skipped).toEqual(["y"]);
    expect(play(g, "eagle").ok).toBe(true);
  });

  it("goes on from the entry, not the plural (tomatoes are a tomato: next an O)", () => {
    const food = buildIndex(load("food.json"), words, CATEGORIES.food);
    const g = newRound({ index: food, players: 2 });
    const v = play(g, "tomatoes");
    expect(v.ok).toBe(true);
    expect(v.word.said.toLowerCase()).toBe("tomato");
    expect(g.need).toBe("o");
  });

  it("takes a typed word through the same matcher", () => {
    const g = newRound({ index: countries, players: 2 });
    go(g);
    const v = hear(g, [{ transcript: "germany", confidence: 1 }], { typed: true });
    expect(v.ok).toBe(true);
    expect(v.typed).toBe(true);
    // Y is a dead end among countries: after Germany comes an N.
    expect(g.need).toBe("n");
  });
});

describe("the fuse and the stages", () => {
  it("does not burn while the potato is passed, or before the microphone is on", () => {
    const g = newRound({ index: cities, players: 2 });
    tick(g, 60_000);
    expect(g.phase).toBe("ready");
    expect(startTurn(g)).toBe(true);
    tick(g, 5000);
    expect(g.fuse).toBe(g.fuseMax);
    lightFuse(g);
    tick(g, 2500);
    expect(g.fuse).toBe(g.fuseMax - 2500);
    expect(fuseShare(g)).toBeCloseTo(0.75);
  });

  it("is shorter at every stage: 10, 9, 8, 7 and 6 seconds", () => {
    const g = newRound({ index: cities, players: 2 });
    const fuses = [];
    for (let i = 0; i < 5; i++) {
      go(g);
      fuses.push(g.fuseMax / 1000);
      tick(g, g.fuseMax + 1);
      if (g.phase === "doom") break;
    }
    expect(fuses).toEqual(FUSE_SECONDS);
  });

  it("makes it worse when the fuse runs out, and passes it on", () => {
    const g = newRound({ index: cities, players: 3 });
    const v = silence(g);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("slow");
    expect(v.why).toBe("Too slow");
    expect(g.stage).toBe(1);
    expect(g.holder).toBe(1);
    expect(types(g)).toEqual(["listen", "lit", "worse", "pass"]);
  });

  it("gives someone still speaking a moment to finish when the fuse runs out", () => {
    const g = newRound({ index: cities, players: 2 });
    go(g);
    speaking(g);
    tick(g, g.fuseMax);
    expect(g.phase).toBe("listen");
    expect(types(g)).toContain("grace");
    expect(hear(g, said("Berlin")).ok).toBe(true);
    // And if nothing comes in time, it is too slow.
    go(g);
    speaking(g);
    tick(g, g.fuseMax);
    tick(g, GRACE_MS);
    expect(g.last.reason).toBe("slow");
  });

  it("does not let the next turn start in the same instant as a verdict", () => {
    const g = newRound({ index: cities, players: 2 });
    play(g, "Oslo");
    expect(canStart(g)).toBe(false);
    expect(startTurn(g)).toBe(false);
    tick(g, SETTLE_MS);
    expect(canStart(g)).toBe(true);
  });

  it("does not heal on a right answer: it settles", () => {
    const g = newRound({ index: cities, players: 2 });
    silence(g);
    silence(g);
    expect(g.stage).toBe(2);
    play(g, "Oslo");
    play(g, "Ottawa");
    play(g, "Amsterdam");
    expect(g.stage).toBe(2);
  });
});

describe("the burst and the end", () => {
  it("bursts on the fifth miss, on whoever missed, after a moment to appeal", () => {
    const g = newRound({ index: cities, players: 3 });
    for (let i = 0; i < 4; i++) silence(g);
    expect(g.stage).toBe(LAST_STAGE);
    expect(livesLeft(g)).toBe(1);
    const who = g.holder;
    go(g);
    hear(g, said("hello"));
    expect(g.phase).toBe("doom");
    expect(g.holder).toBe(who);
    expect(canAppeal(g)).toBe(true);
    tick(g, DOOM_MS);
    expect(g.phase).toBe("burst");
    expect(g.burstOn).toBe(who);
    expect(livesLeft(g)).toBe(0);
    tick(g, BURST_MS);
    expect(g.phase).toBe("over");
    expect(types(g)).toEqual(expect.arrayContaining(["doom", "burst", "over"]));
  });

  it("keeps the chain and the count for the end screen", () => {
    const g = newRound({ index: cities, players: 2 });
    play(g, "Oslo");
    play(g, "Ottawa");
    for (let i = 0; i < 5; i++) silence(g);
    tick(g, DOOM_MS + BURST_MS);
    expect(g.phase).toBe("over");
    expect(g.chain.map((c) => c.said)).toEqual(["Oslo", "Ottawa"]);
    expect(g.chain.map((c) => c.by)).toEqual([0, 1]);
    expect(g.misses).toBe(5);
  });
});

describe("appeals", () => {
  it("'that was right' takes a refused word and undoes the damage", () => {
    const g = newRound({ index: cities, players: 2 });
    play(g, "Oslo");
    const v = play(g, "Leopold");
    expect(v.ok).toBe(false);
    expect(g.stage).toBe(1);
    expect(canAppeal(g)).toBe(true);
    expect(appeal(g)).toBe(true);
    expect(g.stage).toBe(0);
    expect(g.chain.at(-1).said).toBe("Leopold");
    expect(g.need).toBe("d");
    expect(g.misses).toBe(0);
    // Once only.
    expect(canAppeal(g)).toBe(false);
    expect(appeal(g)).toBe(false);
  });

  it("'that was wrong' takes back an accepted word and counts the miss", () => {
    const g = newRound({ index: cities, players: 2 });
    play(g, "Oslo");
    const v = play(g, "Orange");
    expect(v.ok).toBe(false);
    play(g, "Osaka");
    expect(g.need).toBe("a");
    expect(appeal(g)).toBe(true);
    expect(g.chain.map((c) => c.said)).toEqual(["Oslo"]);
    expect(g.need).toBe("o");
    expect(g.stage).toBe(2);
    // Osaka may be said again now.
    tick(g, SETTLE_MS);
    expect(play(g, "Osaka").ok).toBe(true);
  });

  it("can save the potato from the burst", () => {
    const g = newRound({ index: cities, players: 2 });
    for (let i = 0; i < 4; i++) silence(g);
    go(g);
    hear(g, said("Leopold"));
    expect(g.phase).toBe("doom");
    tick(g, DOOM_MS / 2);
    expect(appeal(g)).toBe(true);
    expect(g.phase).toBe("ready");
    expect(g.stage).toBe(LAST_STAGE);
    tick(g, DOOM_MS);
    expect(g.phase).toBe("ready");
  });

  it("bursts it on the speaker when the last life's word is overturned", () => {
    const g = newRound({ index: cities, players: 3 });
    for (let i = 0; i < 4; i++) silence(g);
    const who = g.holder;
    play(g, "Oslo");
    expect(appeal(g)).toBe(true);
    expect(g.phase).toBe("burst");
    expect(g.burstOn).toBe(who);
  });

  it("is not offered for silence, nor once the next turn has started", () => {
    const g = newRound({ index: cities, players: 2 });
    silence(g);
    expect(canAppeal(g)).toBe(false);
    play(g, "Leopold");
    expect(canAppeal(g)).toBe(true);
    go(g);
    expect(canAppeal(g)).toBe(false);
  });
});

describe("pausing", () => {
  it("stops the fuse, the doom and the burst, and nothing can start while paused", () => {
    const g = newRound({ index: cities, players: 2 });
    go(g);
    tick(g, 1000);
    expect(setPaused(g, true)).toBe(true);
    tick(g, 60_000);
    expect(g.fuse).toBe(g.fuseMax - 1000);
    expect(g.phase).toBe("listen");
    setPaused(g, false);
    tick(g, 1000);
    expect(g.fuse).toBe(g.fuseMax - 2000);
    timeUp(g);
    setPaused(g, true);
    tick(g, SETTLE_MS);
    expect(canStart(g)).toBe(false);
    expect(startTurn(g)).toBe(false);
  });

  it("cannot pause a burst or a finished round", () => {
    const g = newRound({ index: cities, players: 2 });
    for (let i = 0; i < 5; i++) silence(g);
    tick(g, DOOM_MS);
    expect(g.phase).toBe("burst");
    expect(setPaused(g, true)).toBe(false);
  });
});

describe("what the art is told", () => {
  it("only the stage, growth, strain, light colour and phase", () => {
    const g = newRound({ index: cities, players: 2 });
    expect(Object.keys(artState(g)).sort()).toEqual(["growth", "light", "paused", "phase", "stage", "strain"]);
  });

  it("grows a step every miss, strains as the fuse burns, and goes dark when it bursts", () => {
    const g = newRound({ index: cities, players: 2 });
    const seen = [];
    for (let i = 0; i < 5; i++) {
      seen.push(artState(g));
      if (i < 4) silence(g);
    }
    expect(seen.map((s) => s.growth)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(seen.map((s) => s.light)).toEqual(LIGHTS.slice(0, 5));
    go(g);
    const calm = artState(g).strain;
    tick(g, g.fuseMax / 2);
    expect(artState(g).strain).toBeGreaterThan(calm);
    tick(g, g.fuseMax);
    tick(g, DOOM_MS);
    const end = artState(g);
    expect(end.phase).toBe("burst");
    expect(end.light).toBe(LIGHTS[5]);
    expect(end.growth).toBe(1);
  });
});
