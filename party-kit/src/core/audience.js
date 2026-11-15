// A game for fewer seats than the party, with the rest as its audience (KR-12), and a game played
// on an upright phone (KR-14): the plain logic a room uses for both.
//
// Fewer seats. A game whose manifest says `audience: true` (with `players.max` its seats, Who Am
// I?'s two) may be voted for by a party larger than its seats. Its players are then chosen on
// marked spots before it starts: each spot is taken by the first piece to stand on it, freed when
// that piece steps off, and the game starts with the pieces on the spots. Everyone else watches.
// With no more members than seats, everyone plays and no spots are needed.
//
// The audience. A game that opts in (`game.audience: true`, or the manifest's `audience: true`)
// gives the members who are not in it the viewer `{role: "audience", seat}` (views.js, viewerFor)
// instead of a screen's: it may show them more than the big screen. They never play: an input
// from them is refused, they never place, and the game never hears of them coming or going.
//
// Upright. A game whose manifest says `devices.upright: true` is laid out for a phone held
// upright: the page stops asking for sideways while it is played (its view is letterboxed on a
// phone that stays sideways), and asks again when it ends.
//
// No network, no clock, no storage.

/** Whether the members who are not in the game are its audience (`game.audience` or `manifest.audience`). */
export function hasAudience(game, manifest) {
  return game?.audience === true || manifest?.audience === true;
}

/** Whether a game is played on an upright phone (`manifest.devices.upright`). */
export function isUpright(manifest) {
  return manifest?.devices?.upright === true;
}

/**
 * Whether a party of `members` must choose who plays a game first: the game takes an audience
 * (`audience: true` in its manifest) and the party has more members than the game has seats.
 * `seats` is the game's most (`players.max`).
 */
export function needsSpots({ audience, seats }, members) {
  return audience === true && Number.isInteger(seats) && seats >= 1 && members > seats;
}

/** Empty spots, one for each place in `places` (where a piece stands to take it: a light, say). */
export function openSpots(places) {
  return places.map((place) => ({ place, seat: null }));
}

/**
 * The spots after the pieces moved. `at` is {seat: the place that piece stands on, or null}, for
 * every piece that may hold a spot (a member who is here); a seat missing from it holds nothing.
 * A spot is kept by the piece on it (walking or not, while it stays on that place), freed when that
 * piece is elsewhere or gone, and a free spot is taken by a piece standing still on it that holds
 * no other spot, the lowest seat first when two arrive together. `moving` lists the seats that are
 * walking: one passing over a spot does not take it. Call it after every move, so "first" is the
 * first to stop there. Returns {spots, changed}; the spots given are not changed.
 */
export function takeSpots(spots, at, { moving = [] } = {}) {
  const next = spots.map((spot) => ({ ...spot }));
  for (const spot of next) if (spot.seat !== null && at[spot.seat] !== spot.place) spot.seat = null;
  // A piece holding a spot, or walking, takes no free one.
  const holding = new Set([...next.map((spot) => spot.seat).filter((seat) => seat !== null), ...moving]);
  const seats = Object.keys(at)
    .map(Number)
    .sort((a, b) => a - b);
  for (const spot of next) {
    if (spot.seat !== null) continue;
    const seat = seats.find((s) => !holding.has(s) && at[s] === spot.place);
    if (seat === undefined) continue;
    spot.seat = seat;
    holding.add(seat);
  }
  const changed = next.some((spot, i) => spot.seat !== spots[i].seat);
  return { spots: next, changed };
}

/** Whether every spot is taken. */
export function spotsFull(spots) {
  return spots.length > 0 && spots.every((spot) => spot.seat !== null);
}

/** The seats on the spots, in seat order: the game's players. */
export function spotSeats(spots) {
  return spots
    .map((spot) => spot.seat)
    .filter((seat) => seat !== null)
    .sort((a, b) => a - b);
}

/** Whether saved spots read back: a list of {place, seat}. */
export function validSpots(spots) {
  return Array.isArray(spots) && spots.length > 0 && spots.every((spot) => spot && typeof spot.place === "string" && (spot.seat === null || Number.isInteger(spot.seat)));
}
