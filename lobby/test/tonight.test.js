// The Tonight board's logic (lobby/shared/tonight.js) and the room keeping the night's games.
import { describe, expect, it } from "vitest";
import { game as coinFlip, FLIP_MS, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { HISTORY_MAX, nameList, ordinal, playedLines, record, standings } from "../shared/tonight.js";
import { boxFromManifest } from "../shared/vote.js";

const member = (seat, name, points, connected = true) => ({ seat, name, colour: "#123456", points, connected });

describe("the night's standings", () => {
  it("puts most points first, and equal points share a place", () => {
    const rows = standings([member(0, "Ann", 3), member(1, "Bo", 5), null, member(3, "Di", 3)]);
    expect(rows.map((r) => [r.place, r.name, r.points])).toEqual([
      [1, "Bo", 5],
      [2, "Ann", 3],
      [2, "Di", 3],
    ]);
    expect(standings([member(0, "Ann", 0), member(1, "Bo", 0)]).map((r) => r.place)).toEqual([1, 1]);
    expect(standings([member(0, "Ann", 4), member(1, "Bo", 4), member(2, "Cy", 1)]).map((r) => r.place)).toEqual([1, 1, 3]);
    expect(standings([null, null])).toEqual([]);
  });

  it("names places and lists of people", () => {
    expect([1, 2, 3, 4, 5].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "5"]);
    expect(nameList([])).toBe("");
    expect(nameList(["Ann"])).toBe("Ann");
    expect(nameList(["Ann", "Bo"])).toBe("Ann and Bo");
    expect(nameList(["Ann", "Bo", "Cy"])).toBe("Ann, Bo and Cy");
  });
});

describe("the games played tonight", () => {
  const card = (round, name, firsts) => ({ round, name, rows: firsts.map((who) => ({ name: who, colour: "#abcdef", place: 1, points: 3 })).concat({ name: "Zed", colour: "#000000", place: firsts.length + 1, points: 1 }) });

  it("keeps each game's name and who won it, a shared win included", () => {
    const history = [];
    record(history, card(1, "Coin Flip", ["Ann"]));
    record(history, card(2, "Cork & Bell", ["Bo", "Cy"]));
    expect(history).toEqual([
      { round: 1, name: "Coin Flip", winners: [{ name: "Ann", colour: "#abcdef" }] },
      { round: 2, name: "Cork & Bell", winners: [{ name: "Bo", colour: "#abcdef" }, { name: "Cy", colour: "#abcdef" }] },
    ]);
    expect(playedLines({ games: 2, played: history }).map((l) => `${l.number}. ${l.name}: ${l.won}`)).toEqual(["1. Coin Flip: Ann won", "2. Cork & Bell: Bo and Cy won"]);
  });

  it("does not count a game nobody scored in", () => {
    expect(record([], { round: 1, name: "Stand-in", rows: [] })).toEqual([]);
    expect(record([], null)).toEqual([]);
  });

  it("forgets the oldest past a limit and keeps numbering from the first game", () => {
    const history = [];
    for (let i = 1; i <= HISTORY_MAX + 3; i++) record(history, card(i, `Game ${i}`, ["Ann"]));
    expect(history.length).toBe(HISTORY_MAX);
    const lines = playedLines({ games: HISTORY_MAX + 3, played: history });
    expect(lines[0]).toMatchObject({ number: 4, name: "Game 4" });
    expect(lines.at(-1)).toMatchObject({ number: HISTORY_MAX + 3 });
    expect(playedLines({ games: 0, played: [] })).toEqual([]);
    expect(playedLines(undefined)).toEqual([]);
  });
});

describe("the room keeps the night", () => {
  function played() {
    const wall = { boxes: [boxFromManifest(coinFlipManifest, { test: true })], games: new Map([["coin-flip", coinFlip]]) };
    const core = new LobbyCore({ ...wall, seed: 7, code: "BCDFGH", now: 1000 });
    for (const name of ["Ann", "Bo"]) core.connect(core.join(name, 1000).token, 1000);
    core.startGame("coin-flip", 2000);
    const ended = core.gameTick(2000 + FLIP_MS).ended;
    return { wall, core, ended };
  }

  it("shows every client the games played and who won each", () => {
    const { core, ended } = played();
    const winner = ended.last.rows[0].name;
    expect(core.view(9000).tonight).toEqual({ games: 1, played: [{ round: 1, name: "Coin Flip", winners: [{ name: winner, colour: ended.last.rows[0].colour }] }] });
  });

  it("remembers them through a sleep", () => {
    const { wall, core } = played();
    const woken = LobbyCore.restore(wall, structuredClone(core.serialize()), 60_000);
    expect(woken.view(60_000).tonight).toEqual(core.view(60_000).tonight);
    // A room saved before the list existed wakes with an empty one.
    const old = structuredClone(core.serialize());
    delete old.history;
    expect(LobbyCore.restore(wall, old, 60_000).view(60_000).tonight.played).toEqual([]);
  });
});
