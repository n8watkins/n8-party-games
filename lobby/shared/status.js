// The one line of words under the room: what is going on and who is being waited for.
// Plain logic over the room view, so every state's wording is tested without a browser.

function names(list) {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** What the count says a box will do: a game in the room starts, an outside game opens on its own site. */
function verb(room, id) {
  return room.boxes.find((b) => b.id === id)?.url ? "opens" : "starts";
}

/** Who chooses a game's settings (the room view's `choosing.by`), as people would say it. */
function chooser(room) {
  const by = room.choosing?.by;
  return by === -1 ? "The room's screen" : (room.members[by]?.name ?? "The host");
}

function minutes(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Whether the settings step only chooses the game's players on spots: it has no settings of its own. */
function onlySpots(room) {
  const c = room.phase === "settings" ? room.choosing : null;
  return !!c && Array.isArray(c.spots) && !c.fields?.length;
}

/** Which spot a seat holds while players are chosen on spots (0 for the first), or -1. */
function spotOf(room, seat) {
  const spots = room.phase === "settings" ? room.choosing?.spots : null;
  return Array.isArray(spots) ? spots.findIndex((spot) => spot.seat === seat) : -1;
}

/**
 * The bottom line for the big screen: {chip, main, sub, waiting}.
 * `room` is the room view, `vote` its vote (with `countLeft` and `tossLeft` in ms filled in by
 * the page), `closingLeft` the ms until a room that was told to close does.
 */
export function statusLine(room, vote, closingLeft = null) {
  const box = (id) => room.boxes.find((b) => b.id === id)?.name ?? "";
  const here = room.members.filter(Boolean);
  const waiting = vote.waiting.map((seat) => room.members[seat]).filter(Boolean);
  if (room.closing) {
    return { chip: "CLOSING", main: "Today's hosting allowance is used up.", sub: `This room closes in ${minutes(closingLeft ?? room.closing.in)}.`, waiting: [] };
  }
  if (room.phase === "playing") return { chip: "PLAYING", main: `${room.game?.name ?? "A game"} is on.`, sub: "", waiting: [] };
  // A step that chooses who plays on spots says how to play first: that is what the room has to do.
  if (onlySpots(room)) return { chip: "WHO PLAYS", main: `Stand in a lit spot to play ${room.choosing.name}`, sub: `${chooser(room)} starts it once every spot is taken.`, waiting: [] };
  if (room.phase === "settings" && Array.isArray(room.choosing?.spots)) return { chip: "WHO PLAYS", main: `Stand in a lit spot to play ${room.choosing.name}`, sub: `${chooser(room)} is choosing the settings.`, waiting: [] };
  if (room.phase === "settings" && room.choosing) return { chip: "SETTINGS", main: `Choosing settings for ${room.choosing.name}`, sub: `${chooser(room)} is choosing.`, waiting: [] };
  if (vote.toss) {
    return { chip: "TIE", main: "A coin toss picks.", sub: `${names(vote.toss.between.map(box))}.`, waiting: [] };
  }
  if (vote.count) {
    const n = Math.max(1, Math.ceil((vote.countLeft ?? vote.count.endsIn) / 1000));
    const main = vote.leaders.length === 1 ? `${box(vote.leaders[0])} ${verb(room, vote.leaders[0])} in ${n}.` : `A tie. The coin toss is in ${n}.`;
    return { chip: here.length > 1 ? "EVERYONE IS IN A LIGHT" : "IN A LIGHT", main, sub: "Step out of your light to stop the count.", waiting: [] };
  }
  if (!here.length) return { chip: "JOIN", main: "Scan the code or type it to join.", sub: "The first player in picks the game.", waiting: [] };
  return {
    chip: "VOTE",
    main: "Stand in a light to pick that game.",
    sub: waiting.length ? "Waiting for" : "",
    waiting: waiting.map((m) => ({ name: m.name, colour: m.colour })),
  };
}

/**
 * The shorter line a player's own device shows between its buttons: {label, vote, voted, rest}.
 * `label` names what `vote` is: the player's vote while the room votes, the spot they hold while
 * players are chosen on spots, the game being set up or played after that. `voted` is false when
 * `vote` is a "not yet" (drawn dimmer).
 */
export function playerLine(room, vote, seat, closingLeft = null) {
  const box = (id) => room.boxes.find((b) => b.id === id)?.name ?? "";
  const mine = vote.standing[seat] ?? null;
  const waiting = vote.waiting.filter((s) => s !== seat).map((s) => room.members[s]?.name).filter(Boolean);
  const here = room.members.filter(Boolean).length;
  // There is little room between a phone's buttons: one name, or a number.
  let rest = waiting.length > 1 ? `Waiting for ${waiting.length} players` : waiting.length ? `Waiting for ${waiting[0]}` : `${here} here${room.screens ? "" : ", phones only"}`;
  if (room.closing) rest = `Room closes in ${minutes(closingLeft ?? room.closing.in)}`;
  else if (onlySpots(room)) rest = room.choosing.by === seat ? "You start the game" : `${chooser(room)} starts the game`;
  else if (room.phase === "settings" && room.choosing) rest = room.choosing.by === seat ? "You choose the settings" : `${chooser(room)} is choosing settings`;
  else if (vote.toss) rest = "Tie: a coin toss picks";
  else if (vote.count) {
    const n = Math.max(1, Math.ceil((vote.countLeft ?? vote.count.endsIn) / 1000));
    rest = vote.leaders.length === 1 ? `${box(vote.leaders[0])} ${verb(room, vote.leaders[0])} in ${n}` : `Tie: coin toss in ${n}`;
  } else if (!mine && vote.waiting.includes(seat) && !waiting.length && here > 1) rest = "Everyone is waiting for you";
  // While players are chosen on spots, a piece in a light is not a vote: it is the spot it holds,
  // named as the card names it ("Player 2"), and a light somebody else holds is nothing yet.
  if (room.phase === "settings" && Array.isArray(room.choosing?.spots)) {
    const k = spotOf(room, seat);
    return { label: "You are", vote: k >= 0 ? `Player ${k + 1}` : "watching", voted: k >= 0, rest };
  }
  // The vote is over: the line names the game being set up, then the one being played.
  if (room.phase === "settings" && room.choosing) return { label: "Up next", vote: room.choosing.name, voted: true, rest };
  if (room.phase === "playing") {
    const game = room.game;
    const watching = !!game?.audience && Array.isArray(game.seats) && !game.seats.includes(seat);
    return { label: "Now", vote: game?.name ?? "A game", voted: true, rest: !room.closing && watching ? "You are watching" : rest };
  }
  return { label: "Your vote", vote: mine ? box(mine) : "Not yet", voted: !!mine, rest };
}
