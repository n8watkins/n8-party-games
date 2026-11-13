// The Tonight board as plain logic: who stands where on the night, and which games were played
// and who won each. The wall's small board and the large view both read from here.

/** How many games the room remembers by name. The count of games played carries on past it. */
export const HISTORY_MAX = 20;

/**
 * Adds a finished game to the night's list. `last` is the room's card for it
 * ({round, name, rows: [{name, colour, place, points}]}). A game nobody scored in is not a
 * game played. Returns the list, trimmed to the newest HISTORY_MAX.
 */
export function record(history, last) {
  if (!last?.rows?.length) return history;
  const winners = last.rows.filter((row) => row.place === 1).map((row) => ({ name: row.name, colour: row.colour }));
  history.push({ round: last.round, name: last.name, winners });
  while (history.length > HISTORY_MAX) history.shift();
  return history;
}

/**
 * The night's standings from the room's members: most points first, and equal points share a
 * place (3, 3, 1 points reads 1st, 1st, 3rd). Returns [{place, seat, name, colour, points, connected}].
 */
export function standings(members) {
  const rows = members.filter(Boolean).sort((a, b) => b.points - a.points || a.seat - b.seat);
  let place = 0;
  return rows.map((m, i) => {
    if (i === 0 || m.points !== rows[i - 1].points) place = i + 1;
    return { place, seat: m.seat, name: m.name, colour: m.colour, points: m.points, connected: m.connected };
  });
}

const ORDINALS = ["1st", "2nd", "3rd", "4th"];
export function ordinal(place) {
  return ORDINALS[place - 1] ?? String(place);
}

/** "Mabel", "Mabel and Tom", "Mabel, Tom and Dolly". */
export function nameList(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The games played, oldest first, as lines to read: [{number, name, winners, won}]. `number`
 * counts from the first game of the night even when the oldest have been forgotten.
 */
export function playedLines(tonight) {
  const played = tonight?.played ?? [];
  const first = (tonight?.games ?? played.length) - played.length + 1;
  return played.map((game, i) => ({ number: first + i, name: game.name, winners: game.winners, won: game.winners.length ? `${nameList(game.winners.map((w) => w.name))} won` : "No winner" }));
}
