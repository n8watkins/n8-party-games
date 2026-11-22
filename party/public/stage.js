// The Table's stage: where a Table game's own view is shown while it is played. Small on purpose,
// and not shared with the Floor's (lobby/public/main.js, startStage), which is bound to its 3D room.
//
// A game's view is a module on this site (its entry's `view`) with the shape every game keeps
// (party-kit/GAME-CONTRACT.md, "In the browser"): mount(container, ctx) returns {snapshot,
// events, unmount}, and may add room(next) to hear the room view as it changes (the names of
// players who join during the game). The module is fetched when the game starts, so the stage stands in for the
// view at once and hands on whatever the room says in the meantime.
import { stageKey } from "/lobby/shared/stage.js";

const modules = new Map();

/** The view module for a Table entry, loaded once. Only ever a module of this site. */
function viewModule(entry) {
  if (!entry?.view) return Promise.resolve(null);
  if (!modules.has(entry.id)) {
    const address = new URL(entry.view, location.href);
    modules.set(entry.id, address.origin === location.origin ? import(address.href) : Promise.resolve(null));
  }
  return modules.get(entry.id);
}

/**
 * Who this device is to the game: a player whose seat is in the game, or someone who watches it
 * as the big screen does (the room's screen, or a member who is not playing). Worked out as the
 * room works it out (LobbyCore.viewerOf): the Table has no audience.
 */
export function viewerAtTable(you, game) {
  if (you?.role === "player" && game?.seats?.includes(you.seat)) return { role: "player", seat: you.seat };
  return { role: "screen", seat: you?.role === "player" ? you.seat : -1 };
}

/**
 * A view brings its own stylesheet (a <link> it puts in `box`): until it has loaded, the view is
 * kept out of sight, so nobody sees (or taps) its buttons unstyled for a moment, as happened after
 * a reload on a slow connection. A sheet that fails to load shows the view anyway.
 */
function hideUntilStyled(box) {
  const pending = [...box.querySelectorAll('link[rel="stylesheet"]')].filter((link) => !link.sheet);
  if (!pending.length) return;
  box.style.visibility = "hidden";
  let left = pending.length;
  const done = () => {
    left -= 1;
    if (left === 0) box.style.visibility = "";
  };
  for (const link of pending) {
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
  }
}

/**
 * Mounts the game the room is playing in `box`. `link` is the PartyClient, `room` the room view.
 * Returns the stage: {key, snapshot, events, unmount}. `onError` hears a view that could not load.
 * `onDecided(true|false)` hears a view that calls the optional `ctx.decided(on)`: its match is
 * decided and its own final screen is up (with its own way back), so the Table's "End the game"
 * steps aside. A view that never calls it changes nothing.
 */
export function mountStage(box, { link, room, snapshot, onError, onDecided }) {
  const entry = room.table?.find((e) => e.id === room.game.id) ?? null;
  const mine = { view: null, waiting: [], gone: false };
  const pass = (method, args) => (mine.view ? mine.view[method]?.(...args) : mine.waiting.push([method, args]));
  const ctx = {
    room,
    you: viewerAtTable(link.you, room.game),
    upright: true,
    snapshot,
    // send(data, {id}) asks the game for an answer (a promise); inputId() makes an id no other input of this page has used.
    send: (data, opts) => link.sendInput(data, opts),
    inputId: () => link.nextInputId(),
    now: () => link.now(),
    inset: { top: 0, right: 0 },
    params: new URLSearchParams(location.search),
    decided: (on) => {
      if (!mine.gone) onDecided?.(on === true);
    },
  };
  viewModule(entry)
    .then((module) => {
      if (mine.gone) return;
      if (!module?.mount) throw new Error(`${room.game.name} has no view for the Table`);
      mine.view = module.mount(box, ctx);
      for (const [method, args] of mine.waiting.splice(0)) mine.view[method]?.(...args);
      hideUntilStyled(box);
    })
    .catch((err) => onError?.(err));
  return {
    key: stageKey(room.game),
    snapshot: (...args) => pass("snapshot", args),
    events: (...args) => pass("events", args),
    // The room view as it changes (someone joined: their name), for a view that asks for it with room(next).
    room: (...args) => pass("room", args),
    unmount() {
      mine.gone = true;
      mine.view?.unmount?.();
      box.textContent = "";
    },
  };
}
