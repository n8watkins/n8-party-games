// Count to ten at the Table: the test game's view (its rules are party/games/count-to-ten). The
// shape every Table game's view keeps (party-kit/GAME-CONTRACT.md, "In the browser"):
// mount(container, ctx) returns {snapshot, events, unmount}, and leaves nothing behind.
//
// A player sees the count, whose turn it is with the time left, their own secret word, and on
// their turn two buttons: add one, add two. Anyone else (the big screen) sees the count and whose
// turn it is, and no word.

const CSS = "/party/games/count-to-ten.css";

function el(tag, className, text, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}

export function mount(container, { room, you, snapshot, send, inputId, now }) {
  const sheet = el("link");
  sheet.rel = "stylesheet";
  sheet.href = CSS;
  container.append(sheet);
  const root = el("section", "ctt", "", container);
  root.setAttribute("aria-label", "Count to ten");
  const player = you?.role === "player";
  const nameOf = (seat) => room.members[seat]?.name ?? `Seat ${seat + 1}`;
  const colourOf = (seat) => room.members[seat]?.colour ?? "#8f8170";

  const head = el("p", "ctt-turn", "", root);
  head.setAttribute("aria-live", "polite");
  const clock = el("div", "ctt-clock", "", root);
  const fill = el("span", "ctt-clock-fill", "", clock);
  const big = el("p", "ctt-count", "", root);
  const of = el("p", "ctt-of", "", root);
  const buttons = el("div", "ctt-buttons", "", root);
  const adds = [1, 2].map((add) => {
    const b = el("button", "ctt-add", `+${add}`, buttons);
    b.type = "button";
    b.dataset.add = String(add);
    b.setAttribute("aria-label", `Add ${add}`);
    b.addEventListener("click", () => press(add));
    return b;
  });
  buttons.hidden = !player;
  const said = el("p", "ctt-said", "", root);
  said.setAttribute("role", "status");
  const secret = el("p", "ctt-secret", "", root);
  secret.hidden = !player;
  const log = el("ol", "ctt-log", "", root);
  log.setAttribute("aria-label", "The last presses");

  let state = null;
  let busy = false;
  let timer = null;

  async function press(add) {
    if (busy || !state || state.turn !== you.seat || state.winner !== null) return;
    busy = true;
    draw();
    try {
      await send({ add }, { id: inputId() });
      said.textContent = "";
    } catch (err) {
      said.textContent = err?.message ?? "That did not go through. Try again.";
    } finally {
      busy = false;
      draw();
    }
  }

  function tickClock() {
    if (!state || state.deadline === null || state.winner !== null) {
      fill.style.transform = "scaleX(0)";
      return;
    }
    const left = Math.max(0, state.deadline - now());
    fill.style.transform = `scaleX(${Math.min(1, left / state.turnMs)})`;
  }

  function draw() {
    if (!state) return;
    const mine = player && state.turn === you.seat;
    const over = state.winner !== null;
    head.textContent = over ? `${nameOf(state.winner)} said ten` : mine ? "Your turn" : `${nameOf(state.turn)}'s turn`;
    head.classList.toggle("mine", mine && !over);
    head.style.setProperty("--who", colourOf(over ? state.winner : state.turn));
    big.textContent = String(state.count);
    of.textContent = `of ${state.target}. Add one or two; whoever says ${state.target} wins.`;
    for (const b of adds) b.disabled = !mine || over || busy;
    if (player) {
      secret.textContent = "";
      el("span", "", "Your secret word ", secret);
      el("strong", "", state.secret ?? "?", secret);
      el("span", "", " (only you can see it)", secret);
    }
    log.textContent = "";
    for (const p of [...state.log].reverse()) {
      const li = el("li", "", "", log);
      const dot = el("span", "ctt-dot", "", li);
      dot.style.background = colourOf(p.seat);
      el("span", "", `${nameOf(p.seat)} added ${p.add}: ${p.count}`, li);
    }
    if (state.missing.length) {
      const li = el("li", "ctt-missing", `Skipping ${state.missing.map(nameOf).join(" and ")} until they are back`, log);
      log.prepend(li);
    }
    tickClock();
  }

  function take(s) {
    if (!s) return;
    state = s;
    draw();
  }

  take(snapshot);
  timer = setInterval(tickClock, 200);
  return {
    snapshot: (s) => take(s),
    events(ev) {
      const out = ev.find((e) => e.k === "timed_out");
      if (out) said.textContent = `${nameOf(out.seat)} ran out of time`;
    },
    unmount() {
      clearInterval(timer);
      root.remove();
      sheet.remove();
    },
  };
}
