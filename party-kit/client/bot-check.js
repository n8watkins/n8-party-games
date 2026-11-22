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
/** What the page shows when the check does not give a token; the server's refusal reads the same. */
export const FAILED = "Could not check you are a person. Try again.";
let loading = null;

function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (globalThis.turnstile ? resolve(globalThis.turnstile) : reject(new Error(FAILED)));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("Could not check you are a person. Check the connection and try again."));
    };
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
