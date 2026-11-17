// The rules of the vote, as plain logic: which games the party can play, who is voting for
// what, who leads, and what a place in a game is worth tonight. Shared by the room and the page.
import { playRules } from "../../party-kit/client/emotes.js";

/** Everyone stands in a light for this long and the game starts: long enough to shout about it, call a friend over or change your mind. The last three seconds tick harder. */
export const COUNT_MS = 10_000;
/** A tie is settled by a coin toss everybody watches for this long. */
export const TOSS_MS = 3200;
/** After a game the room rests this long before a new count may begin, so the result can be read. */
export const SETTLE_MS = 6000;

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
 * manifest carries one, `soon` for a game that is not built, `test` for a placeholder, and
 * `view` for a hosted game: the address of the module that shows it inside the room.
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
    // Where the page finds the view of a game that opens inside the room (GAME-CONTRACT.md, "In the browser").
    view: extra.view ?? null,
    art: extra.art ?? manifest.id,
    // Whether emotes and sounds may be used while it is played (the kit's defaults when the manifest says nothing).
    play: playRules(manifest),
    // Only that the game has settings, chosen in a step after the vote. The fields themselves go
    // to the pages in that step alone (the room view's `choosing`), not with every box.
    ...(manifest.settings ? { settings: true } : {}),
    // A game for fewer seats than the party (`audience: true`): a larger party may vote for it,
    // its players are chosen on spots, and the rest watch (party-kit/src/core/audience.js).
    ...(manifest.audience === true ? { audience: true } : {}),
    // A game laid out for an upright phone: the page stops asking for sideways while it is on.
    ...(manifest.devices?.upright === true ? { upright: true } : {}),
  };
}

/**
 * A poster on the wall that is not a game: it hangs in a frame as a box does, but it has no light,
 * nobody can vote for it and nothing lists it as a game (the front page leaves it out). `link` is
 * where tapping it goes, in a new tab; `where` is the short address printed on it.
 */
export function posterBox({ id, name, blurb, link, where }) {
  return { id, name, blurb, poster: true, link, where, soon: false, test: false, view: null, art: id, badge: "any", min: 0, max: 0, play: playRules(null) };
}

/**
 * The poster that hangs last on the Floor's wall (lobby/wall.js): it asks for ideas, and tapping it
 * opens the contact form on n8builds.dev in a new tab. No email address is printed in the room.
 */
export const IDEAS = posterBox({ id: "ideas", name: "Got a game idea?", blurb: "Tell me. I might build it.", link: "https://n8builds.dev/#contact", where: "n8builds.dev" });

/**
 * The lights that are the spots where a game's players are chosen (a party larger than the game's
 * seats): `n` lights side by side on the wall, around the winning game's own, as near the middle
 * of that run as the wall allows. The room's own lights and their drawing, so standing on a spot
 * is standing in a light. A poster (posterBox) is never a spot. Returns the boxes' ids, or null
 * when the wall has fewer than `n`.
 */
export function spotLights(wall, id, n) {
  const boxes = wall.filter((box) => !box.poster);
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
  // A poster has no light, and nothing to say about one.
  if (box.poster) return "";
  if (box.soon) return "Coming soon";
  if (party.players < box.min) return box.min === 1 ? "Needs a player" : `Needs ${box.min} players`;
  // A game with an audience takes a larger party: its players are chosen on spots, the rest watch.
  if (party.players > box.max && !box.audience) return box.max === 1 ? "For 1 player" : box.min === box.max ? `For ${box.max} players` : `For up to ${box.max} players`;
  if (box.badge === "screen" && party.screens < 1) return "Needs a big screen";
  return null;
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
