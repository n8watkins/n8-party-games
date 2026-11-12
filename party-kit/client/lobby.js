// The waiting room: a plain, tidy panel a game mounts over its own picture.
// It is the only join flow. A game supplies its look through CSS variables (see lobby.css)
// and may plug two things in:
//
//   toy(container, ctx)            THE LOBBY TOY SLOT. Called once when the waiting room opens.
//                                  Draw anything players can fiddle with while they wait
//                                  (the game's own mini scene, a practice target...). ctx gives
//                                  {client, room()} and the function may return a cleanup function.
//   character(el, seat, room)      THE CHARACTER SLOT. Called for every seat whenever the room
//                                  changes. `el` is an empty 56 px box next to the name; draw the
//                                  player's character in it (the cartoon slimes will plug in here).
//                                  seat.character holds whatever the client sent with
//                                  client.setCharacter(...). With no hook, a plain colour disc shows.
//
//   const lobby = mountLobby(document.body, client, { title: "Cork & Bell", toy, character });
//   lobby.open({ pin: "4821" })    // prefill a PIN (from ?join=4821)
//   lobby.close()
import { botCheck } from "./bot-check.js";

export function mountLobby(parent, client, options = {}) {
  const title = options.title ?? "Party room";
  const root = el("div", "pk-lobby", parent);
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", `${title} room`);
  const card = el("div", "pk-card", root);
  let toyCleanup = null;
  let screenMode = false;
  let lastError = "";
  let joinLink = "";

  const savedName = (() => {
    try {
      return localStorage.getItem("party-kit:name") ?? "";
    } catch {
      return "";
    }
  })();

  function showError(message) {
    lastError = message;
    const box = card.querySelector(".pk-error");
    if (box) {
      box.textContent = message;
      box.hidden = !message;
    }
  }

  async function run(action) {
    showError("");
    try {
      await action();
    } catch (err) {
      showError(err?.message ?? "Something went wrong.");
    }
  }

  // ------------------------------------------------------------ the door (make or join)

  function renderDoor(prefill = {}) {
    card.replaceChildren();
    card.className = "pk-card pk-door";
    el("h2", "pk-title", card).textContent = title;
    el("p", "pk-sub", card).textContent = "Two to four players, one room.";
    const form = el("form", "pk-form", card);
    const nameLabel = el("label", "pk-label", form);
    nameLabel.textContent = "Your nickname";
    const name = el("input", "pk-input", nameLabel);
    name.maxLength = 14;
    name.autocomplete = "nickname";
    name.placeholder = "Nickname";
    name.value = savedName;
    const pinLabel = el("label", "pk-label", form);
    pinLabel.textContent = "Room PIN (to join a friend)";
    const pin = el("input", "pk-input pk-pin-input", pinLabel);
    pin.inputMode = "numeric";
    pin.maxLength = 4;
    pin.placeholder = "0000";
    pin.value = prefill.pin ?? "";
    const check = el("div", "pk-botcheck", form);
    check.hidden = true;
    const error = el("p", "pk-error", form);
    error.hidden = !lastError;
    error.textContent = lastError;
    error.setAttribute("role", "alert");
    const row = el("div", "pk-row", form);
    const joinBtn = button(row, "Join with PIN", "pk-btn pk-primary");
    const makeBtn = button(row, "Make a room", "pk-btn");
    const screenBtn = button(form, "Use this screen as the shared screen", "pk-btn pk-quiet");
    const back = button(form, "Back to the game", "pk-btn pk-quiet");
    const remember = () => {
      try {
        localStorage.setItem("party-kit:name", name.value.trim());
      } catch {
        // Private mode: the name is just not remembered.
      }
    };
    const sync = () => {
      const hasPin = /^\d{4}$/.test(pin.value.trim());
      joinBtn.classList.toggle("pk-primary", hasPin);
      makeBtn.classList.toggle("pk-primary", !hasPin);
    };
    pin.addEventListener("input", sync);
    sync();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      (/^\d{4}$/.test(pin.value.trim()) ? joinBtn : makeBtn).click();
    });
    joinBtn.addEventListener("click", () =>
      run(async () => {
        if (!name.value.trim()) throw new Error("Pick a nickname first.");
        if (!/^\d{4}$/.test(pin.value.trim())) throw new Error("The PIN is the four digits on the host's screen.");
        remember();
        await client.join(pin.value.trim(), { nickname: name.value });
      }),
    );
    // Making a room may need the bot check; joining a friend's room never does.
    const turnstileToken = async () => botCheck(check, (await client.config().catch(() => null))?.turnstileSiteKey);
    makeBtn.addEventListener("click", () =>
      run(async () => {
        if (!name.value.trim()) throw new Error("Pick a nickname first.");
        remember();
        await client.create({ nickname: name.value, turnstile: await turnstileToken() });
      }),
    );
    screenBtn.addEventListener("click", () =>
      run(async () => {
        screenMode = true;
        if (/^\d{4}$/.test(pin.value.trim())) await client.join(pin.value.trim(), { as: "screen" });
        else await client.create({ as: "screen", turnstile: await turnstileToken() });
      }),
    );
    back.addEventListener("click", () => api.close());
    (prefill.pin ? name : name.value ? pin : name).focus();
  }

  // ------------------------------------------------------------ the waiting room

  function renderRoom(room) {
    const you = client.you ?? { role: "player", seat: -1 };
    const isScreen = you.role === "screen";
    const ended = room.phase === "ended";
    card.className = `pk-card pk-room${isScreen || screenMode ? " pk-screen" : ""}`;
    card.replaceChildren();

    const head = el("div", "pk-head", card);
    const invite = el("div", "pk-invite", head);
    el("div", "pk-pin-label", invite).textContent = "Join with PIN";
    el("div", "pk-pin", invite).textContent = room.pin ?? room.code;
    const hint = el("div", "pk-pin-hint", invite);
    hint.textContent = joinLink ? joinLink.replace(/^https?:\/\//, "") : "";
    if (joinLink) {
      const qr = el("img", "pk-qr", head);
      qr.alt = "QR code to join this room";
      qr.src = client.qrUrl(joinLink);
      qr.width = 148;
      qr.height = 148;
    }

    const list = el("ol", "pk-seats", card);
    for (let i = 0; i < room.maxSeats; i++) {
      const seat = room.seats[i];
      const li = el("li", `pk-seat${seat ? "" : " pk-empty"}${seat && i === you.seat ? " pk-you" : ""}`, list);
      li.style.setProperty("--pk-seat", seat?.colour ?? "transparent");
      const figure = el("div", "pk-character", li);
      if (seat) {
        if (options.character) options.character(figure, seat, room);
        else el("div", "pk-disc", figure);
      }
      const text = el("div", "pk-seat-text", li);
      el("div", "pk-seat-name", text).textContent = seat ? seat.name + (i === you.seat ? " (you)" : "") : "Open seat";
      const state = el("div", "pk-seat-state", text);
      if (!seat) state.textContent = "Waiting for a player";
      else if (seat.kind === "bot") state.textContent = seat.away ? "Dropped out, a stand-in is playing" : "Stand-in";
      else if (!seat.connected) state.textContent = "Reconnecting";
      else state.textContent = seat.ready ? "Ready" : "Not ready";
      if (seat?.ready && seat.kind !== "bot") li.classList.add("pk-ready");
      if (seat && seat.kind === "bot" && !seat.away && room.hostSeat === you.seat && room.phase !== "playing") {
        const remove = button(li, "Remove", "pk-btn pk-small");
        remove.setAttribute("aria-label", `Remove ${seat.name}`);
        remove.addEventListener("click", () => client.removeBot(i));
      }
    }

    const error = el("p", "pk-error", card);
    error.hidden = !lastError;
    error.textContent = lastError;
    error.setAttribute("role", "alert");

    const actions = el("div", "pk-row pk-actions", card);
    const mine = you.seat >= 0 ? room.seats[you.seat] : null;
    const isHost = isScreen ? room.hostSeat === -1 : room.hostSeat === you.seat;
    if (mine) {
      const ready = button(actions, mine.ready ? "Not ready" : ended ? "Rematch" : "Ready", `pk-btn${mine.ready ? "" : " pk-primary"}`);
      ready.addEventListener("click", () => client.setReady(!mine.ready));
    }
    if (!ended || isScreen) {
      if (isHost || isScreen) {
        const start = button(actions, ended ? "Start the rematch" : "Start", `pk-btn${room.canStart ? " pk-primary" : ""}`);
        start.disabled = !room.canStart;
        start.addEventListener("click", () => client.start());
        if (room.seats.some((s) => s === null)) {
          const bot = button(actions, "Add a stand-in", "pk-btn");
          bot.addEventListener("click", () => client.addBot());
        }
      }
    }
    const note = el("p", "pk-note", card);
    const humans = room.seats.filter((s) => s && s.kind === "human").length;
    if (ended) note.textContent = "The rematch starts the moment everyone taps Rematch.";
    else if (!humans) note.textContent = "Open the address on a phone, or scan the code, and type the PIN.";
    else if (!room.canStart) note.textContent = "Waiting for everyone to be ready.";
    else if (isHost || isScreen) note.textContent = room.seats.filter(Boolean).length < room.minSeats ? "Start now and a stand-in takes the empty stall." : "Everyone is ready.";
    else note.textContent = "Waiting for the host to start.";
    const leave = button(card, "Leave the room", "pk-btn pk-quiet");
    leave.addEventListener("click", () => {
      client.leave();
      screenMode = false;
      renderDoor();
      api.close();
    });

    const toyBox = el("div", "pk-toy", card);
    toyBox.dataset.slot = "lobby-toy";
    if (options.toy) {
      toyCleanup?.();
      toyCleanup = options.toy(toyBox, { client, room: () => client.room }) ?? null;
    } else {
      toyBox.hidden = true;
    }
  }

  const offRoom = client.on("room", (room) => {
    if (root.hidden) return;
    if (room.phase === "playing") return;
    if (client.session && !joinLink) {
      client.joinUrl(options.joinPath).then((url) => {
        joinLink = url;
        if (client.room) renderRoom(client.room);
      });
    }
    renderRoom(room);
  });
  const offError = client.on("error", (err) => showError(err.message));
  const offClosed = client.on("closed", (why) => {
    joinLink = "";
    lastError = why === "seat_lost" ? "Your seat was given away while you were gone." : "The room closed.";
    if (!root.hidden) renderDoor();
  });

  const api = {
    root,
    get isOpen() {
      return !root.hidden;
    },
    /** Shows the lobby: the waiting room when in a room, the door otherwise. */
    open(prefill = {}) {
      root.hidden = false;
      if (client.room && client.session) {
        if (!joinLink) client.joinUrl(options.joinPath).then((url) => ((joinLink = url), client.room && renderRoom(client.room)));
        renderRoom(client.room);
      } else renderDoor(prefill);
      options.onOpen?.();
    },
    close() {
      root.hidden = true;
      toyCleanup?.();
      toyCleanup = null;
      options.onClose?.();
    },
    destroy() {
      offRoom();
      offError();
      offClosed();
      api.close();
      root.remove();
    },
  };
  return api;
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}

function button(parent, label, className) {
  const b = el("button", className, parent);
  b.type = "button";
  b.textContent = label;
  return b;
}
