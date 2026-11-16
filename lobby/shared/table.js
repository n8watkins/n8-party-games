// The Table's list of games: plain data and small rules, shared by the room (server) and the
// Table's page (/party/). At the Table the host picks a turn-based game from a plain list that
// simply follows the party's size: a game the party cannot play right now stays on the list,
// greyed, with the reason ("Needs 3 or more"). No characters, no lights, no vote.
//
// An entry is drawn from a game's manifest (tableEntry). The room sends the list in its view
// (`room.table`) with each entry's reason worked out for the party as it is (`why`), so a page
// never has to know the rules to draw it.

/**
 * The beat between the host's pick and the game: everyone at the Table sees "Count to ten is
 * starting" for this long, so nobody is dropped into a game mid-sentence. Nothing may switch the
 * room or start another game meanwhile (LobbyCore.starting).
 */
export const PLAY_BEAT_MS = 3000;

/**
 * An entry on the Table's list, from a game's manifest:
 *   id, name     the game's own
 *   pitch        one line that says what the game is ("Anonymous answers about you. Guess who wrote what.")
 *   min, max     how many players it takes (the manifest's `players`)
 *   art          the address of its door picture, or null (the page draws a plain tile)
 *   soon         listed, not playable yet ("Coming soon")
 *   test         a test game: the page shows it only when its address has #dev
 *   view         the address of the module that shows the game at the Table, or null (coming soon)
 * `extra` is what the site adds: `soon`, `test`, `view`, and `pitch` or `art` until the manifest has them.
 */
export function tableEntry(manifest, extra = {}) {
  return {
    id: manifest.id,
    name: manifest.name,
    pitch: manifest.pitch ?? manifest.blurb ?? extra.pitch ?? "",
    min: manifest.players?.min ?? 1,
    max: manifest.players?.max ?? 4,
    art: manifest.art ?? extra.art ?? null,
    soon: !!extra.soon,
    test: !!extra.test,
    // Where the page finds the module that shows the game (GAME-CONTRACT.md, "In the browser").
    view: extra.view ?? null,
  };
}

/** "2 players", "3-8 players". */
export function tablePlayers({ min, max }) {
  return min === max ? `${min} ${min === 1 ? "player" : "players"}` : `${min}-${max} players`;
}

/**
 * Why a party of `players` (connected players) cannot play an entry right now, in a few words,
 * or null when it can. The owner's examples: "Needs 3 or more" for a game of three to eight with
 * two at the Table; Who Am I? is for exactly two.
 */
export function tableWhyNot(entry, players) {
  if (entry.soon) return "Coming soon";
  if (players < entry.min) return entry.min === entry.max ? `Needs exactly ${entry.min}` : `Needs ${entry.min} or more`;
  if (players > entry.max) return entry.min === entry.max ? `For exactly ${entry.max}` : `For up to ${entry.max}`;
  return null;
}

/** Whether a page shows test games: only when its address ends in #dev. */
export const showsTests = (hash) => hash === "#dev";
