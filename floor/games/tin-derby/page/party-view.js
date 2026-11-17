// Tin Derby as a view the party room mounts over itself and takes away again (party-kit/GAME-CONTRACT.md,
// "In the browser"). The room started the race for its own seats; this shows it.
//
//   const view = mount(container, { room, you, snapshot, send, now, inset, params });
//   view.events(list);            // what the room's game.tick returned
//   view.snapshot(s, now, full);  // game.snapshot: once a second, or a full one after a reconnect
//   view.unmount();               // the race is over: everything is freed
//
// As Cork & Bell does, the race is drawn by its own page (index.html) in a frame of the same origin, so that
// unmount() is complete: the page's listeners, timers, sound and WebGL context belong to the frame's document
// and go with it. The page finds what it needs on its frame element (`frame.partyHost`): plain data and calls.

/** Where the game's page is, from wherever a host serves this module. */
const PAGE = new URL("./index.html", import.meta.url);

/**
 * The test switches a run asks for on the room's address, as derby-<name> (derby-auto: the house's driver holds
 * this phone's hands; derby-lag=<ms>: inputs held back that long; derby-touch: thumbs on a computer), handed to the
 * page as a query string (`partyHost.switches`). Only where the room has its test games on: the server hangs a
 * test box on the wall (`test: true`, lobby/wall.js) only where PARTY_TEST_GAMES is "on", never in production, so
 * there anyone adding ?derby-auto=1 to the address gets nothing.
 * @param {object} room  the room's view, as the server sent it (its `boxes`)
 * @param {URLSearchParams} asked  the room page's address
 * @returns {string}
 */
export function switchesFor(room, asked) {
  const tests = Array.isArray(room?.boxes) && room.boxes.some((box) => box?.test === true);
  const out = new URLSearchParams();
  if (tests) for (const [key, value] of asked) if (key.startsWith("derby-") && key.length > 6) out.set(key.slice(6), value);
  return out.toString();
}

/**
 * @param {HTMLElement} container  an empty box laid over the room's page; the race fills it
 * @param {object} ctx  room, you, snapshot, send, now, inset, params (GAME-CONTRACT.md, "In the browser")
 */
export function mount(container, { room, you, snapshot, send, now, inset = {}, params = null }) {
  const doc = container.ownerDocument;
  const handlers = { events: new Set(), snapshot: new Set() };
  /** What the room said before the page had loaded: handed over, in order, when it is ready. */
  let backlog = [];
  let ready = false;
  let gone = false;

  const emit = (type, ...args) => {
    if (gone) return;
    if (!ready) return void backlog.push([type, args]);
    for (const handler of handlers[type]) handler(...args);
  };

  const frame = doc.createElement("iframe");
  frame.partyHost = {
    room,
    you,
    snapshot,
    inset: { top: inset.top ?? 0, right: inset.right ?? 0 },
    now,
    send: (data) => gone || send(data),
    on(type, handler) {
      handlers[type]?.add(handler);
      return () => handlers[type]?.delete(handler);
    },
    /** The page calls this once it is set up from `snapshot`: everything missed follows. */
    ready() {
      ready = true;
      for (const [type, args] of backlog.splice(0)) for (const handler of handlers[type]) handler(...args);
    },
    /** Set by the page: frees the WebGL context and the sound at once, instead of when the frame is collected. */
    dispose: null,
    /** The test switches, where the room allows them (switchesFor), as a query string; "" otherwise. */
    switches: "",
  };
  frame.title = "Tin Derby";
  frame.setAttribute("allow", "autoplay; fullscreen; screen-wake-lock");
  // Set through the style object, never a style attribute: the site's Content-Security-Policy forbids those.
  Object.assign(frame.style, { position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", display: "block", background: "#fbdfaa" });
  frame.partyHost.switches = switchesFor(room, params ?? new URLSearchParams(doc.defaultView?.location.search ?? ""));
  const address = new URL(PAGE);
  address.searchParams.set("party", "1");
  frame.src = address.href;
  container.append(frame);
  // Keys steer too, and they go to whichever document has the focus.
  frame.addEventListener("load", () => gone || frame.contentWindow?.focus());

  return {
    /** The view covers the whole container: the room hides its own bars while it is up. */
    full: true,
    frame,
    events: (list) => emit("events", list),
    snapshot: (s, at, full = false) => emit("snapshot", s, at, full),
    unmount() {
      if (gone) return;
      gone = true;
      backlog = [];
      try {
        frame.partyHost.dispose?.();
      } catch {
        // The page never finished loading, or is already gone: removing the frame is enough.
      }
      handlers.events.clear();
      handlers.snapshot.clear();
      frame.partyHost = null;
      frame.remove();
    },
  };
}

/** Fetches the page and its largest files while the vote is still counting, so the frame opens from the cache. */
export function preload(doc = document) {
  if (doc.head.querySelector("link[data-tin-derby]")) return;
  const files = [
    ["index.html", "prefetch"],
    ["vendor/three.min.js", "prefetch"],
    ["main.js", "modulepreload"],
    ["view.js", "modulepreload"],
    ["table.js", "modulepreload"],
    ["art.js", "modulepreload"],
    ["../shared/rules.js", "modulepreload"],
    ["cloth.jpg", "prefetch"],
  ];
  for (const [path, rel] of files) {
    const link = doc.createElement("link");
    link.rel = rel;
    link.href = new URL(path, PAGE).href;
    link.dataset.tinDerby = "";
    doc.head.append(link);
  }
}
