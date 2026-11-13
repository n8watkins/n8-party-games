// The front page's one bit of script: a short line about the party this device has just come
// from, at the top of the page. The party room (lobby/public/farewell.js) leaves the note in
// sessionStorage and comes here; this reads it once.
//
//   - Things that are over (the room closed, the allowance is spent) are said at once and the
//     note is let go, so a reload does not say them again.
//   - Things you can undo (you left, your seat was given up, this screen stopped showing) are
//     said only when the party is still open, with the way back in. The room is asked once; if
//     it has gone, or does not answer, nothing is shown. The page never moves by itself, so a
//     rejoin that fails cannot loop or flash.
const NOTE_KEY = "party-room:note";
/** A note older than this is about a party long gone. */
const NOTE_LIFE_MS = 15 * 60_000;

function readNote() {
  try {
    const note = JSON.parse(sessionStorage.getItem(NOTE_KEY) ?? "null");
    return note && Date.now() - note.at < NOTE_LIFE_MS ? note : (forget(), null);
  } catch {
    return null;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(NOTE_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

const party = (pin) => (pin ? `party ${pin}` : "the party");
const Party = (pin) => (pin ? `Party ${pin}` : "The party");

/** What each way of leaving says: [line, action word or null, whether the action is to show the room]. */
function says(note) {
  const p = note.pin;
  switch (note.kind) {
    case "left":
      return { line: `You left ${party(p)}.`, act: "Rejoin" };
    case "screen_left":
      return { line: `This screen stopped showing ${party(p)}.`, act: "Show it again", screen: true };
    case "seat_lost":
      return { line: `You were away too long, so ${party(p)} let your seat go.`, act: "Rejoin" };
    case "screen_lost":
      return { line: `Another screen is showing ${party(p)} now.`, act: "Join as a player" };
    case "room_idle":
      return { line: `${Party(p)} closed: nobody moved for twenty minutes.` };
    case "room_expired":
      return { line: `${Party(p)} is over: a party lasts four hours.` };
    case "allowance_spent":
      return { line: "Party rooms are closed for today. Each game still plays on its own page." };
    default:
      return { line: `${Party(p)} has ended.` };
  }
}

function chip(text, action) {
  const el = document.createElement("div");
  el.className = "note-chip";
  el.setAttribute("role", "status");
  const words = document.createElement("span");
  words.textContent = text;
  el.append(words);
  if (action) el.append(action);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "note-close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => {
    forget();
    el.classList.remove("shown");
    setTimeout(() => el.remove(), 250);
  });
  el.append(close);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("shown"));
  return el;
}

async function show() {
  const note = readNote();
  if (!note) return;
  const said = says(note);
  if (!said.act) {
    forget();
    chip(said.line);
    return;
  }
  if (!/^\d{4}$/.test(note.pin ?? "")) return forget();
  let preview = null;
  try {
    const res = await fetch(`/api/lobby/join/${note.pin}`);
    preview = (await res.json())?.preview ?? null;
  } catch {
    preview = null;
  }
  // Gone, full, or (for a screen) another screen is there: say nothing, quietly.
  if (!preview || (said.screen ? preview.screen : preview.full)) return forget();
  const action = document.createElement("a");
  action.className = "note-act";
  action.textContent = said.act;
  action.href = `/lobby/?join=${note.pin}${said.screen ? "&as=screen" : ""}&rejoin`;
  action.addEventListener("click", forget);
  chip(said.line, action);
}

void show();
