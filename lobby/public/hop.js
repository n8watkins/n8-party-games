// Moving a tab between the party's two waiting rooms (lobby/shared/mode.js): the Floor (the
// character room) at /lobby/ and the Table (the plain one) at /party/. Both pages use this.
//
// The rule is state, not an event: whenever the room's view says the party is in the other room
// (the hello after a reconnect, a room view after a switch, a page loaded mid-switch), the page
// covers itself with "Moving to ...", and a moment later replaces itself with the other page,
// which resumes the same seat from the same saved session. A phone that was asleep, offline or
// loading during a switch lands in the right room the next time it hears the room.
//
// The loop guard (mode.js, hopNow): a tab hops at most once in a few seconds, so two pages can
// never bounce a tab. A hop it may not make yet leaves the cover up with a link to tap, and is
// tried again by itself the moment the guard lets it (hopWait), to wherever the party is then.
import { h } from "./dom.js";
import { MODE_NAME, MODE_PAGE, arrived, hopNow, hopTarget, hopWait, modeOf, readHop } from "./shared/mode.js";

/** How long "Moving to ..." shows before the page goes. */
const COVER_MS = 250;
/** A note of the switch heard this recently is carried to the page the tab moves to. */
const NOTE_MS = 5000;

function storage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Watches the room for this page. `mine` is the mode this page shows. Call it before the page's
 * own room handler is added, so that handler can look at `leaving` first and draw nothing for a
 * room it is about to leave. Returns {leaving, came, said}: `came` that the tab has just moved
 * here, `said` why (the switch's note, once), or "".
 */
export function watchMode(link, mine, { parent = document.body } = {}) {
  // `came`: this tab has just moved here. While every page is moving, the host's phone may be
  // between pages for a moment and someone else holds the controls: no first-time hints then.
  const last = readHop(storage());
  const came = !!last && last.to === MODE_PAGE[mine] && Date.now() - last.at < 15_000;
  const state = { leaving: false, came, said: arrived(storage(), MODE_PAGE[mine]) };
  let note = null;
  let cover = null;
  let timer = null;
  link.on("message", (msg) => {
    // Said on the page the tab moves to, short enough for the room's one-line notes.
    if (msg?.t === "note" && msg.k === "mode") note = { text: typeof msg.name === "string" ? `${msg.name} moved the party here` : "The party moved here", at: Date.now() };
  });
  const noteText = () => (note && Date.now() - note.at < NOTE_MS ? note.text : "");
  /** Stays after all: the party is back in this page's room. The page then draws the room as it is now. */
  const stay = () => {
    clearTimeout(timer);
    cover?.remove();
    cover = null;
    state.leaving = false;
  };
  /**
   * Goes where the room's mode says now (it may have moved again while this page waited), or
   * stays if that is here. Held by the loop guard, it tries again the moment the guard lets it
   * (hopWait), and offers a link to tap meanwhile.
   */
  const go = () => {
    const room = link.room;
    const to = hopTarget(room, mine);
    if (!to) {
      stay();
      // The page's own handler skipped every room view while it was leaving: hand it this one.
      if (room) link.emit("room", room);
      return;
    }
    const name = MODE_NAME[modeOf(room)];
    cover.querySelector(".hop-words").textContent = `Moving to ${name}`;
    if (hopNow(to, { storage: storage(), text: noteText() })) return;
    // Hopped a moment ago already: this tab waits out the guard, then tries again by itself.
    cover.querySelector(".hop-words").textContent = `The party moved to ${name}`;
    let tap = cover.querySelector(".hop-link");
    if (!tap) {
      tap = h("a", "hop-link", "Tap to go to the party", cover);
      // A tap goes at once, the way a page moves by itself: replaced, so it adds no history step.
      tap.addEventListener("click", (e) => {
        e.preventDefault();
        hopNow(tap.getAttribute("href"), { storage: storage(), text: noteText(), force: true });
      });
    }
    tap.href = to;
    timer = setTimeout(go, hopWait(readHop(storage()), Date.now()) + 50);
  };
  link.on("room", (room) => {
    const to = hopTarget(room, mine);
    if (!to) {
      // Back in this page's room while a hop waited (or was held by the guard): stay after all.
      if (state.leaving) stay();
      return;
    }
    if (state.leaving) return;
    state.leaving = true;
    cover = h("div", "hop-cover", "", parent);
    cover.setAttribute("role", "status");
    h("p", "hop-words", `Moving to ${MODE_NAME[modeOf(room)]}`, cover);
    timer = setTimeout(go, COVER_MS);
  });
  return state;
}
