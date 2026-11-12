// The one line of words under the room: what is going on and who is being waited for.
// Plain logic over the room view, so every state's wording is tested without a browser.

function names(list) {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function minutes(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
  if (vote.toss) {
    return { chip: "TIE", main: "A coin toss picks.", sub: `${names(vote.toss.between.map(box))}.`, waiting: [] };
  }
  if (vote.count) {
    const n = Math.max(1, Math.ceil((vote.countLeft ?? vote.count.endsIn) / 1000));
    const main = vote.leaders.length === 1 ? `${box(vote.leaders[0])} starts in ${n}.` : `A tie. The coin toss is in ${n}.`;
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

/** The shorter line a player's own device shows between its buttons: {vote, rest}. */
export function playerLine(room, vote, seat, closingLeft = null) {
  const box = (id) => room.boxes.find((b) => b.id === id)?.name ?? "";
  const mine = vote.standing[seat] ?? null;
  const waiting = vote.waiting.filter((s) => s !== seat).map((s) => room.members[s]?.name).filter(Boolean);
  const here = room.members.filter(Boolean).length;
  // There is little room between a phone's buttons: one name, or a number.
  let rest = waiting.length > 1 ? `Waiting for ${waiting.length} players` : waiting.length ? `Waiting for ${waiting[0]}` : `${here} here${room.screens ? "" : ", phones only"}`;
  if (room.closing) rest = `Room closes in ${minutes(closingLeft ?? room.closing.in)}`;
  else if (vote.toss) rest = "Tie: a coin toss picks";
  else if (vote.count) {
    const n = Math.max(1, Math.ceil((vote.countLeft ?? vote.count.endsIn) / 1000));
    rest = vote.leaders.length === 1 ? `${box(vote.leaders[0])} starts in ${n}` : `Tie: coin toss in ${n}`;
  } else if (!mine && vote.waiting.includes(seat) && !waiting.length && here > 1) rest = "Everyone is waiting for you";
  return { vote: mine ? box(mine) : "Not yet", voted: !!mine, rest };
}
