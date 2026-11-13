// The way in: start a party, or join one with its code, as a player or as the room's screen.
// Plain on purpose. It makes or joins the room through the link (the kit's client) and that
// is all: once the room answers, the page shows the room.
//
// What is offered is decided in lobby/shared/entry.js: a phone leads with playing and keeps
// "use this as the room's screen" as a small link; a wide screen is offered both; and a party
// that already has its screen offers only playing.
import { botCheck } from "/party-kit/client/bot-check.js";
import { h } from "./dom.js";
import { ROLE_CARDS, doorPlan } from "./shared/entry.js";
import { nameList } from "./shared/tonight.js";

const NAME_KEY = "party-kit:name";
const CODE = /^(\d{4}|[A-Za-z0-9]{6})$/;

function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function keepName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private browsing: the name is simply not remembered.
  }
}

/**
 * @param {HTMLElement} root
 * @param {import("/party-kit/client/party-client.js").PartyClient} link
 * @param {{mode: "start" | "join", code?: string, message?: string, as?: "player" | "screen", small?: boolean, rejoin?: boolean}} opts
 *   as: what the device leans to (a link may ask for the screen). small: a phone. rejoin: the
 *   front page's "Rejoin": join at once with the code and the name this device remembers. Tried
 *   once; if it fails the form stays, with the reason, and nothing is tried again.
 * @returns {{close: () => void}}
 */
export function openDoor(root, link, opts) {
  const el = h("div", "door", "", root);
  const card = h("main", "door-card", "", el);
  const brand = h("div", "brand", "", card);
  h("span", "brand-mark", "", brand);
  h("span", "", "n8 Party", brand);
  let mode = opts.mode;
  let as = opts.as === "screen" ? "screen" : "player";
  /** What is known about the party whose code is typed: {code, players, screen} or null. */
  let party = null;
  /** A whole code the room API said matches no open party, or null. */
  let missing = null;
  /** What has been typed, kept when the form is drawn again. */
  const typed = { code: opts.code ?? "", name: savedName() };
  let closed = false;

  function draw(focus = true) {
    for (const child of [...card.children]) if (child !== brand) child.remove();
    const starting = mode === "start";
    const plan = doorPlan({ small: !!opts.small, starting, as, screenTaken: !!party?.screen });
    as = plan.as;
    h("h1", "door-title", plan.title, card);
    h("p", "door-sub", plan.sub, card);
    const form = h("form", "door-form", "", card);
    form.noValidate = true;

    let code = null;
    let who = null;
    if (!starting) {
      const label = h("label", "field", "", form);
      h("span", "field-label", "Room code", label);
      code = h("input", "input input-code", "", label);
      code.name = "code";
      code.inputMode = "numeric";
      code.autocomplete = "off";
      code.maxLength = 6;
      code.placeholder = "0000";
      code.value = typed.code;
      code.addEventListener("input", () => {
        typed.code = code.value.trim();
        void look();
      });
      who = h("p", "door-who", "", form);
      who.hidden = true;
    }

    // Two ways to be here: a player with a piece, or the screen everyone looks at.
    let group = null;
    if (plan.choice === "cards") {
      group = h("div", "roles", "", form);
      group.setAttribute("role", "radiogroup");
      for (const [value, title, text] of ROLE_CARDS) {
        const label = h("label", value === as ? "role picked" : "role", "", group);
        const input = h("input", "", "", label);
        input.type = "radio";
        input.name = "as";
        input.value = value;
        input.checked = value === as;
        const words = h("span", "role-words", "", label);
        h("strong", "", title, words);
        h("span", "", text, words);
        input.addEventListener("change", () => {
          as = value;
          draw(false);
          card.querySelector(`input[name=as][value=${value}]`)?.focus();
        });
      }
    }
    const note = h("p", "door-note", plan.note, form);
    note.hidden = !plan.note;

    let name = null;
    if (plan.askName) {
      const nameLabel = h("label", "field", "", form);
      h("span", "field-label", "Your name", nameLabel);
      name = h("input", "input", "", nameLabel);
      name.name = "nickname";
      name.maxLength = 14;
      name.autocomplete = "nickname";
      name.placeholder = "Name";
      name.value = typed.name;
      name.addEventListener("input", () => (typed.name = name.value));
    }

    const check = h("div", "botcheck", "", form);
    check.hidden = true;
    const error = h("p", "door-error", opts.message ?? "", form);
    error.hidden = !opts.message;
    error.setAttribute("role", "alert");
    const go = h("button", "button", plan.go, form);
    go.type = "submit";
    const other = h("a", "plain", starting ? "Join with a code instead" : "Start a party instead", card);
    other.href = starting ? "/lobby/" : "/lobby/?start";
    other.addEventListener("click", (e) => {
      e.preventDefault();
      mode = starting ? "join" : "start";
      opts.message = "";
      draw();
    });
    // On a phone the other way to be here is a small link, never a choice made for the player.
    let swap = null;
    if (plan.link) {
      swap = h("button", "door-swap", plan.link.text, card);
      swap.type = "button";
      swap.addEventListener("click", () => {
        as = plan.link.to;
        opts.message = "";
        draw();
      });
    }

    /** Who is in the party whose code is typed, and whether it has its screen. */
    function showParty() {
      if (!who) return;
      const known = party && party.code === typed.code;
      // A whole code that matches no open party is said at once, before a name is typed for nothing.
      const unknown = missing === typed.code;
      who.hidden = !known && !unknown;
      if (known) who.textContent = party.players.length ? `In the room: ${nameList(party.players)}.` : "Nobody has joined this party yet.";
      else if (unknown) who.textContent = "No party has that code right now. Check the four digits on the sign.";
    }
    showParty();

    /** Looks the typed code up once it is whole, so a taken screen is not offered. */
    async function look() {
      const asked = typed.code;
      if (starting || !CODE.test(asked) || party?.code === asked) return;
      let gone = false;
      const preview = await link.preview(asked).catch((err) => ((gone = err?.code === "not_found"), null));
      if (closed || typed.code !== asked || mode !== "join") return;
      party = preview ? { code: asked, players: preview.players ?? [], screen: !!preview.screen } : null;
      missing = gone ? asked : null;
      const next = doorPlan({ small: !!opts.small, starting, as, screenTaken: !!party?.screen });
      // The device had chosen to be the screen and cannot be: the form changes, so draw it again.
      if (next.as !== as) return draw();
      // Otherwise only what is offered changes, in place, so a name being typed keeps its cursor.
      if (group) group.hidden = next.choice !== "cards";
      if (swap) swap.hidden = !next.link;
      note.textContent = next.note;
      note.hidden = !next.note;
      showParty();
    }
    void look();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.hidden = true;
      const nickname = name ? name.value.trim() : "";
      if (as === "player" && !nickname) return fail("Type a name first.");
      if (code && !CODE.test(code.value.trim())) return fail("The code is the four digits on the sign in the room.");
      go.disabled = true;
      try {
        if (as === "player") keepName(nickname);
        if (starting) {
          const siteKey = (await link.config().catch(() => null))?.turnstileSiteKey;
          const turnstile = await botCheck(check, siteKey);
          await link.create({ nickname, as, turnstile });
        } else {
          await link.join(code.value.trim(), { nickname, as });
        }
      } catch (err) {
        if (err?.code === "screen_taken") {
          // Another device got there first: the room says so, and this one is offered a seat.
          party = { code: typed.code, players: party?.players ?? [], screen: true };
          opts.message = "A screen is already connected to this party. You can join as a player instead.";
          return draw();
        }
        go.disabled = false;
        fail(err?.message ?? "Something went wrong. Try again.");
      }
    });

    function fail(message) {
      error.textContent = message;
      error.hidden = false;
    }

    if (focus) (code && !code.value ? code : name && !name.value ? name : go).focus();
    if (opts.rejoin && !starting && CODE.test(typed.code) && (as === "screen" || typed.name.trim())) {
      opts.rejoin = false;
      form.requestSubmit();
    }
  }

  draw();
  return {
    close: () => {
      closed = true;
      el.remove();
    },
  };
}
