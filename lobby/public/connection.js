// Keeping a phone's place in the room honest when its connection comes and goes.
//
//   - A phone that is locked or put away (the page is hidden) closes its connection at once, so
//     everyone else sees its piece turn grey straight away instead of a minute later; it opens
//     it again the moment the page is shown. Its seat is held meanwhile (lobby-core.js: the piece
//     fades after DROP_FADE_MS, the seat is kept for SEAT_HOLD_MS).
//   - The browser saying it is offline does the same.
//   - A connection that has quietly died (no reply to the keep-alive) is noticed here and opened
//     again: the page says "Reconnecting..." instead of looking alive and doing nothing.
// All of it is this page's own doing: nothing is asked of the room, and the room is not woken.

/** The page's keep-alive, which the runtime answers without waking the room. */
export const KEEP_ALIVE_MS = 10_000;
/** No word at all from the room for this long, with the keep-alive going: the connection is dead. */
const DEAD_AFTER_MS = KEEP_ALIVE_MS + 6000;

/**
 * @param {import("/party-kit/client/party-client.js").PartyClient} link
 * @param {{player: () => boolean}} opts  player: whether this device holds a seat (the room's
 *   screen keeps its connection when hidden: it is a screen, and its place has a grace of its own)
 */
export function watchConnection(link, { player }) {
  let parked = false;
  const touch = matchMedia("(pointer: coarse)").matches;
  const park = () => {
    if (parked || !link.session || link.status === "closed" || link.status === "idle") return;
    parked = true;
    link.dropConnection();
  };
  const unpark = () => {
    if (!parked) return;
    parked = false;
    link.connect();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && touch && player()) park();
    else if (!document.hidden && navigator.onLine !== false) unpark();
  });
  addEventListener("offline", park);
  addEventListener("online", () => !document.hidden && unpark());
  setInterval(() => {
    if (parked || link.status !== "open" || !link.heardAt) return;
    if (Date.now() - link.heardAt > DEAD_AFTER_MS) link.dropConnection({ reconnectAfterMs: 0 });
  }, 2000);
}
