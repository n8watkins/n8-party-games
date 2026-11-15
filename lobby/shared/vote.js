// The rules of the vote, as plain logic: which games the party can play, who is voting for
// what, who leads, and what a place in a game is worth tonight. Shared by the room and the page.
import { playRules } from "../../party-kit/client/emotes.js";

/** Everyone stands in a light for this long and the game starts: long enough to shout about it, call a friend over or change your mind. The last three seconds tick harder. */
export const COUNT_MS = 10_000;
/** A tie is settled by a coin toss everybody watches for this long. */
export const TOSS_MS = 3200;
/** After a game the room rests this long before a new count may begin, so the result can be read. */
export const SETTLE_MS = 6000;
/**
 * A game that plays on a site of its own won the vote: every page shows where it is about to go
 * for this long, then goes there. Leaving the page without a word would be a surprise.
 */
export const AWAY_MS = 6000;

/** What a place in a game adds to the Tonight board: 3, 2, 1, and nothing after third. */
export const PLACE_POINTS = [3, 2, 1];
export function pointsForPlace(place) {
  return PLACE_POINTS[place - 1] ?? 0;
}

export const BADGES = {
  any: "Any device",
  phones: "A phone each",
  screen: "Phones + big screen",
};

/** The device badge a manifest's `devices` earns: "screen" (amber), "phones" (violet) or "any" (cyan). */
export function badgeFor(devices = {}) {
  if (devices.sharedScreen === "required") return "screen";
  if (devices.phone && !devices.desktop) return "phones";
  return "any";
}

/** "1-4 players", "2 players". */
export function playersLabel(min, max) {
  return min === max ? `${min} ${min === 1 ? "player" : "players"}` : `${min}-${max} players`;
}

/**
 * A box on the wall, from a game's manifest. `extra` is what the site adds: `blurb` until the
 * manifest carries one, `soon` for a game that is not built, `test` for a placeholder, and `url`
 * for an outside game: one that plays at an address of its own instead of inside the room,
 * and `view` for a hosted game: the address of the module that shows it inside the room.
 */
export function boxFromManifest(manifest, extra = {}) {
  return {
    id: manifest.id,
    name: manifest.name,
    blurb: manifest.blurb ?? extra.blurb ?? "",
    badge: badgeFor(manifest.devices),
    // A game that also plays alone (`players.solo`) can be picked by a party of one.
    min: manifest.players?.solo ? 1 : (manifest.players?.min ?? 1),
    max: manifest.players?.max ?? 4,
    soon: !!extra.soon,
    test: !!extra.test,
    url: extra.url ?? manifest.url ?? null,
    // Where the page finds the view of a game that opens inside the room (GAME-CONTRACT.md, "In the browser").
    view: extra.view ?? null,
    art: extra.art ?? manifest.id,
    // Whether emotes and sounds may be used while it is played (the kit's defaults when the manifest says nothing).
    play: playRules(manifest),
    // The game's settings, as its manifest describes them, for the step after the vote (the room
    // checks them: party-kit/src/core/settings.js). Only on a box whose game has them.
    ...(manifest.settings ? { settings: manifest.settings } : {}),
    // A game for fewer seats than the party (`audience: true`): a larger party may vote for it,
    // its players are chosen on spots, and the rest watch (party-kit/src/core/audience.js).
    ...(manifest.audience === true ? { audience: true } : {}),
    // A game laid out for an upright phone: the page stops asking for sideways while it is on.
    ...(manifest.devices?.upright === true ? { upright: true } : {}),
  };
}

/**
 * The lights that are the spots where a game's players are chosen (a party larger than the game's
 * seats): `n` lights side by side on the wall, around the winning game's own, as near the middle
 * of that run as the wall allows. The room's own lights and their drawing, so standing on a spot
 * is standing in a light. Returns the boxes' ids, or null when the wall has fewer than `n`.
 */
export function spotLights(boxes, id, n) {
  if (!(n >= 1) || boxes.length < n) return null;
  const at = Math.max(0, boxes.findIndex((box) => box.id === id));
  const first = Math.min(Math.max(0, at - Math.floor((n - 1) / 2)), boxes.length - n);
  return boxes.slice(first, first + n).map((box) => box.id);
}

/**
 * Why the party cannot play a box right now, in a few words, or null when its light is on.
 * `party` is {players, screens}: connected players and connected big screens.
 */
export function whyNot(box, party) {
  if (box.soon) return "Coming soon";
  if (party.players < box.min) return box.min === 1 ? "Needs a player" : `Needs ${box.min} players`;
  // A game with an audience takes a larger party: its players are chosen on spots, the rest watch.
  if (party.players > box.max && !box.audience) return box.max === 1 ? "For 1 player" : box.min === box.max ? `For ${box.max} players` : `For up to ${box.max} players`;
  if (box.badge === "screen" && party.screens < 1) return "Needs a big screen";
  return null;
}

/** Where an outside game is, as people would say it: "whoami.n8builds.dev", or "its own page" on this site. */
export function whereabouts(url) {
  return /^https:\/\/([^/]+)/.exec(url ?? "")?.[1] ?? "its own page";
}

/** How many stand in each light. `standing` is {seat: boxId or null}. Returns {boxId: count}. */
export function tally(standing) {
  const counts = {};
  for (const id of Object.values(standing)) if (id) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

/** The box or boxes with the most players, in wall order. More than one is a tie. */
export function leaders(counts, order) {
  const most = Math.max(0, ...Object.values(counts));
  return most === 0 ? [] : order.filter((id) => counts[id] === most);
}

/**
 * A game's result as places, when the game has no `standings` of its own yet: its result rows
 * come best first with a score each (Cork & Bell's do). Equal scores share a place.
 */
export function standingsFromRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  rows.forEach((row, i) => {
    if (!row || typeof row.seat !== "number") return;
    const prev = out[out.length - 1];
    const same = prev && typeof row.score === "number" && rows[i - 1]?.score === row.score;
    out.push({ seat: row.seat, place: same ? prev.place : i + 1 });
  });
  return out;
}
