// Which rooms have a rendered drawing, and whether this device asked for it.
//
// A rendered drawing (look3d/rendered/room-rendered.js) is a room made of rendered layers: the Star
// Lounge (rendered in Blender) and the bar (from the owner's paintings). It is switched on for one device from the address, ?look=real, and kept
// on the device, as the other looks are (room-view.js): the room's own address carries no query,
// and a phone that scans the code on the wall arrives without one. Any other ?look= switches it off.
//
// This file is plain logic with no drawing in it, so the page can ask it before anything of the
// 3D look is fetched, and a device that has not asked fetches none of the layers.

const REAL_KEY = "party-room:real";
/**
 * How far down its ladder (rendered/ladder.js) the rendered drawing came on this device: the
 * steps it took, comma by comma, or "3d" when it gave up and the 3D look draws the room. Kept so
 * a device does not climb back up and slow down again each time; forgotten with ?look=real.
 */
const RUNG_KEY = "party-room:real-rung";

function store() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
const get = (storage, key) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const put = (storage, key, value) => {
  try {
    if (value) storage?.setItem(key, value);
    else storage?.removeItem(key);
  } catch {
    // Private browsing: the choice lasts as long as the page.
  }
};

/**
 * The rooms (skin ids, look3d/skins.js) with a rendered drawing: its name for the frame meter,
 * how many boxes hang on the wall it was rendered for, its steps down (cheapest last) and its module.
 */
export const RENDERED = {
  ship: {
    name: "star-lounge",
    boxes: 5,
    steps: ["weather", "planet", "outside"],
    /** Every file of its layers (star-lounge/layers/) a device fetches when it draws the room this way, and none otherwise. */
    files: ["plate.json", "star-lounge.json", ...["base", "lights", "cards", "env", "sky", "planet", "moon", "rocket", "liner", "saucer", "rock0", "rock1", "rock2"].map((n) => `${n}.webp`)],
    load: () => import("./star-lounge/room.js").then((m) => m.RoomStarLounge),
  },
  bar: {
    name: "bar",
    boxes: 5,
    steps: ["drops", "rain", "outside"],
    /** Every file of its layers (bar/layers/), made from the owner's paintings by lobby/tools/bar/layers.mjs. */
    files: ["plate.json", ...["base", "lights", "frames", "front", "street-left", "street-right", "env"].map((n) => `${n}.webp`)],
    load: () => import("./bar/room.js").then((m) => m.RoomBar),
  },
};

/** Reads the address: ?look=real switches the rendered drawing on for this device (afresh, from the top of its ladder); any other ?look= switches it off. */
export function rememberReal(params, storage = store()) {
  if (!params.has("look")) return;
  put(storage, REAL_KEY, params.get("look") === "real" ? "on" : null);
  put(storage, RUNG_KEY, null);
}

/** Whether this device has the rendered drawing switched on. */
export const realWanted = (storage = store()) => get(storage, REAL_KEY) === "on";

/**
 * The rendered drawing to open for this look and room, or null for none: only the 3D look, only
 * a room that has one, only when this device asked for it, and not where it has already given
 * up on this device (unless the address forces a rung: ?rung=, for tests). `boxes`: how many
 * boxes hang on the room's wall; the drawing's picture is of one wall, so on a wall of another
 * number the 3D look draws the room, and none of the layers is fetched.
 */
export function renderedFor({ look, skin, boxes }, params = new URLSearchParams(globalThis.location?.search ?? ""), storage = store()) {
  const def = RENDERED[skin];
  if (look !== "3d" || !def || !realWanted(storage)) return null;
  if (Number.isInteger(boxes) && boxes !== def.boxes) return null;
  return rungOf(def, params, storage).fallback ? null : def;
}

/**
 * Where on its ladder the drawing starts: {taken: [steps], fallback, capped, forced}. ?rung=
 * forces it for a test and is never remembered: ?rung=0 the top, ?rung=1, 2 ... that many steps
 * down, ?rung=weather,outside those steps, ?rung=3d given up. Otherwise it is what the device
 * remembers; "capped" (a phone held to 30 frames a second) means the top rung, with nothing to try.
 */
export function rungOf(def, params = new URLSearchParams(), storage = store()) {
  const forced = params.get("rung");
  const value = forced ?? get(storage, RUNG_KEY) ?? "";
  if (value === "3d") return { taken: [...def.steps], fallback: true, capped: false, forced: forced !== null };
  if (value === "capped") return { taken: [], fallback: false, capped: true, forced: forced !== null };
  const n = /^\d+$/.test(value) ? Number(value) : null;
  const taken = n !== null ? def.steps.slice(0, n) : value.split(",").filter((s) => def.steps.includes(s));
  return { taken, fallback: false, capped: false, forced: forced !== null };
}

/** Remembers on this device where the drawing came to: its steps taken, "capped" or "3d". */
export function rememberRung(value, storage = store()) {
  put(storage, RUNG_KEY, Array.isArray(value) ? value.join(",") : value);
}

/**
 * What a player is told when a rendered room gives up on their device and the 3D look draws it.
 * Not "simpler room": that is the name of the flat room's offer (slow-room.js), a different thing.
 * It says how to get the detailed room back.
 */
export const FELL_BACK_NOTE = "This device was slow with the detailed room, so it shows the usual one. To try the detailed room again, open the room's address with ?look=real.";

/** What the frame meter calls the room on a rung, after the look ("real"): "star-lounge", "star-lounge lite 2" (two steps down). */
export const rungName = (def, taken) => `${def.name}${taken.length ? ` lite ${taken.length}` : ""}`;
