// The way in: start a party, or join one with its code, as a player or as the room's screen.
// Plain on purpose. It makes or joins the room through the link (the kit's client) and that
// is all: once the room answers, the page shows the room.
import { botCheck } from "/party-kit/client/bot-check.js";
import { h } from "./dom.js";

const NAME_KEY = "party-kit:name";

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
 * @param {{mode: "start" | "join", code?: string, message?: string}} opts
 * @returns {{close: () => void}}
 */
export function openDoor(root, link, opts) {
  const el = h("div", "door", "", root);
  const card = h("main", "door-card", "", el);
  const brand = h("div", "brand", "", card);
  h("span", "brand-mark", "", brand);
  h("span", "", "n8 Party", brand);
  let mode = opts.mode;

  function draw() {
    for (const child of [...card.children]) if (child !== brand) child.remove();
    const starting = mode === "start";
    h("h1", "door-title", starting ? "Start a party" : "Type the room code", card);
    h("p", "door-sub", starting ? "You get a room and a code. Friends join with the code or the QR code on the wall." : "It is on the sign by the door in the room.", card);
    const form = h("form", "door-form", "", card);
    form.noValidate = true;

    let code = null;
    if (!starting) {
      const label = h("label", "field", "", form);
      h("span", "field-label", "Room code", label);
      code = h("input", "input input-code", "", label);
      code.name = "code";
      code.inputMode = "numeric";
      code.autocomplete = "off";
      code.maxLength = 6;
      code.placeholder = "0000";
      code.value = opts.code ?? "";
    }

    // Two ways to be here: a player with a piece, or the screen everyone looks at.
    const group = h("div", "roles", "", form);
    group.setAttribute("role", "radiogroup");
    const roles = [
      ["player", "Play on this device", "Join as a player, with your own piece."],
      ["screen", "Use this as the room's screen", "Shows the room and the games for everyone. Nobody plays from it."],
    ];
    let as = "player";
    const radios = roles.map(([value, title, text]) => {
      const label = h("label", "role", "", group);
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
        sync();
      });
      return input;
    });

    const nameLabel = h("label", "field", "", form);
    h("span", "field-label", "Your name", nameLabel);
    const name = h("input", "input", "", nameLabel);
    name.name = "nickname";
    name.maxLength = 14;
    name.autocomplete = "nickname";
    name.placeholder = "Name";
    name.value = savedName();

    const check = h("div", "botcheck", "", form);
    check.hidden = true;
    const error = h("p", "door-error", opts.message ?? "", form);
    error.hidden = !opts.message;
    error.setAttribute("role", "alert");
    const go = h("button", "button", "", form);
    go.type = "submit";
    const other = h("a", "plain", starting ? "Join with a code instead" : "Start a party instead", card);
    other.href = starting ? "/lobby/" : "/lobby/?start";
    other.addEventListener("click", (e) => {
      e.preventDefault();
      mode = starting ? "join" : "start";
      opts.message = "";
      draw();
    });

    function sync() {
      nameLabel.hidden = as === "screen";
      go.textContent = as === "screen" ? "Show the room here" : starting ? "Start the party" : "Join the party";
      for (const r of radios) r.closest(".role").classList.toggle("picked", r.checked);
    }
    sync();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.hidden = true;
      const nickname = name.value.trim();
      if (as === "player" && !nickname) return fail("Type a name first.");
      if (code && !/^(\d{4}|[A-Za-z0-9]{6})$/.test(code.value.trim())) return fail("The code is the four digits on the sign in the room.");
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
        go.disabled = false;
        fail(err?.message ?? "Something went wrong. Try again.");
      }
    });

    function fail(message) {
      error.textContent = message;
      error.hidden = false;
    }

    (code && !code.value ? code : as === "player" && !name.value ? name : go).focus();
  }

  draw();
  return { close: () => el.remove() };
}
