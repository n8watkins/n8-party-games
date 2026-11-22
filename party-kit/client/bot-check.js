// The bot check before making a room (Cloudflare Turnstile). It does nothing unless the server
// hands out a site key (GET /api/party/config), so local play and tests never see it. Joining a
// friend's room by PIN never asks for it, and nor does coming back to a room already made (a
// reload or the shared screen rejoins with its seat, it never makes a room again).
//
//   const token = await botCheck(container, siteKey);   // null when there is no site key
//
// The widget is "managed" with appearance "interaction-only": a normal phone sees nothing at all,
// and only a visitor Turnstile is unsure of gets a box to tick. Each call renders a fresh widget
// and hands back a fresh, single-use token, so trying again after a refusal just works.
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** The action the Worker expects (party-kit/src/worker/turnstile.js, BOT_CHECK_ACTION). */
export const ACTION = "create-room";
const TIMEOUT_MS = 60_000;
/** How long Turnstile's script has to load before the check gives up and the button works again. */
export const LOAD_TIMEOUT_MS = 15_000;
/** What the page shows when the check does not give a token; the server's refusal reads the same. */
export const FAILED = "Could not check you are a person. Try again.";
/** The script was refused outright: most often a content blocker, and joining by code still works. */
export const BLOCKED = "Could not check you are a person. A content blocker may be stopping the check. Try again, or join a party with a code instead.";
/** The script never answered. */
export const STALLED = "Could not check you are a person: the check did not load. Check the connection and try again.";
let loading = null;

/** How many loads have failed: each try after one asks for the script at an address of its own. */
let failedLoads = 0;

function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    // Any way it ends other than loaded, it is forgotten, so the next try starts a fresh load. A
    // stalled request may still be open: the next try's address differs ("&retry=1"), so the
    // browser makes a new request instead of waiting on that one again.
    const give = (message) => {
      clearTimeout(timer);
      loading = null;
      failedLoads += 1;
      s.onload = s.onerror = null;
      s.remove();
      reject(new Error(message));
    };
    const timer = setTimeout(() => give(STALLED), LOAD_TIMEOUT_MS);
    s.src = failedLoads ? `${SCRIPT}&retry=${failedLoads}` : SCRIPT;
    s.async = true;
    s.onload = () => {
      if (!globalThis.turnstile) return give(FAILED);
      clearTimeout(timer);
      resolve(globalThis.turnstile);
    };
    s.onerror = () => give(BLOCKED);
    document.head.appendChild(s);
  });
  return loading;
}

/** Resolves with a fresh, single-use token, or null when no site key is configured. */
export async function botCheck(container, siteKey) {
  if (!siteKey) return null;
  const turnstile = await loadTurnstile();
  container.hidden = false;
  container.replaceChildren();
  return new Promise((resolve, reject) => {
    let id = null;
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (id !== null) turnstile.remove(id);
      container.hidden = true;
      fn(value);
    };
    const timer = setTimeout(() => done(reject, new Error("Checking you are a person took too long. Try again.")), TIMEOUT_MS);
    id = turnstile.render(container, {
      sitekey: siteKey,
      action: ACTION,
      appearance: "interaction-only",
      callback: (token) => done(resolve, token),
      "error-callback": () => done(reject, new Error(FAILED)),
      "expired-callback": () => done(reject, new Error(FAILED)),
      "timeout-callback": () => done(reject, new Error(FAILED)),
    });
  });
}
