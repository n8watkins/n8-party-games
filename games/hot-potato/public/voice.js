// Listening for one turn's word with the browser's own speech recognition (Chrome, Edge, Safari;
// not Firefox). One turn may need several recognition sessions: when one ends having heard
// nothing (the browser gives up after some silence), the next starts by itself until the turn
// has its word or is stopped.
//
// The words the recogniser offers (up to ten guesses with how sure it is of each) go to the
// shared matcher as they are: it decides which guesses count.

export const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition || null : null;
export const MAX_ALTERNATIVES = 10;
/** The first restart waits this long; each quick end in a row doubles it, up to RESTART_MAX_MS. */
const RESTART_MS = 150;
const RESTART_MAX_MS = 2000;
/** A session shorter than this heard nothing and was not really listening. */
const QUICK_MS = 1000;
/** This many quick ends in a row, or this many restarts in one turn, and listening gives up. */
const MAX_QUICK = 4;
const MAX_RESTARTS = 12;
/** How long the page waits for the microphone to come on before the turn is typed instead. */
export const MIC_WAIT_MS = 4000;

/** The recogniser's language: the browser's own English, or US English. */
export function listenLang(nav = navigator) {
  const l = String(nav.language || "");
  return /^en-[A-Z]{2}$/i.test(l) ? l : "en-US";
}

/**
 * Listens until it has a final result or is stopped. Callbacks:
 *  - onStart():          the microphone is on (the fuse may burn from now)
 *  - onSpeech():         someone started speaking
 *  - onInterim(text):    what it has heard so far
 *  - onFinal(alts):      the word: [{transcript, confidence}], best first
 *  - onBlocked(code):    the microphone or the speech service was refused
 *  - onFail(code):       it cannot listen here (no network, no microphone ...)
 */
export function createListener({ lang = "en-US", onStart, onSpeech, onInterim, onFinal, onBlocked, onFail }) {
  let rec = null;
  let wanted = false;
  let started = false;
  let restartTimer = 0;
  let restarts = 0; // sessions started again within this turn
  let quick = 0; // sessions in a row that ended almost at once

  function session() {
    if (!wanted) return;
    let r;
    try {
      r = new Recognition();
    } catch {
      wanted = false;
      onFail?.("cannot-create");
      return;
    }
    rec = r;
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = MAX_ALTERNATIVES;
    let final = false;
    let partial = ""; // what this session has heard so far, while no final result has come
    // The microphone is on: whichever of the two events this browser sends first.
    const on = () => {
      if (rec !== r || started) return;
      started = true;
      onStart?.();
    };
    r.addEventListener("start", on);
    r.addEventListener("audiostart", on);
    r.addEventListener("speechstart", () => rec === r && onSpeech?.());
    r.addEventListener("result", (e) => {
      if (rec !== r) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          final = true;
          const alts = Array.from(result, (a) => ({ transcript: String(a.transcript || "").trim(), confidence: Number(a.confidence) || 0 })).filter((a) => a.transcript);
          if (alts.length) {
            wanted = false;
            onFinal?.(alts);
            return;
          }
        } else interim += result[0]?.transcript ?? "";
      }
      if (interim.trim()) {
        partial = interim.trim();
        onInterim?.(partial);
      }
    });
    r.addEventListener("error", (e) => {
      if (rec !== r) return;
      const code = e.error || "error";
      if (code === "not-allowed" || code === "service-not-allowed") {
        wanted = false;
        onBlocked?.(code);
      } else if (code === "audio-capture" || code === "network" || code === "language-not-supported" || code === "bad-grammar") {
        wanted = false;
        onFail?.(code);
      }
      // "no-speech" and "aborted": the session ends; "end" starts the next if still wanted.
    });
    const born = Date.now();
    r.addEventListener("end", () => {
      if (rec !== r) return;
      rec = null;
      if (!wanted || final) return;
      // It heard words but never said they were final (Safari can end a session that way, and
      // asking for the result as the fuse runs out can too): those words are the turn's answer.
      // Starting again would throw them away and leave the turn to run out of time.
      if (partial) {
        wanted = false;
        onFinal?.([{ transcript: partial, confidence: 0 }]);
        return;
      }
      // A session that ended at once (aborted by the browser, refused quietly) is not listening:
      // wait longer before each new one, and give up after a few in a row.
      quick = Date.now() - born < QUICK_MS ? quick + 1 : 0;
      restarts++;
      if (quick >= MAX_QUICK || restarts > MAX_RESTARTS) {
        wanted = false;
        onFail?.("restarts");
        return;
      }
      restartTimer = setTimeout(session, Math.min(RESTART_MAX_MS, RESTART_MS * 2 ** quick));
    });
    try {
      r.start();
    } catch {
      rec = null;
      wanted = false;
      onFail?.("start-failed");
    }
  }

  return {
    /** Starts listening for one word. Call inside the tap that starts the turn (Safari wants that). */
    start() {
      clearTimeout(restartTimer);
      wanted = true;
      started = false;
      restarts = 0;
      quick = 0;
      session();
    },
    /** Asks for the final result of what was said so far (the fuse ran out mid-word). */
    finish() {
      try {
        rec?.stop();
      } catch {
        // Not running.
      }
    },
    /** Stops at once; whatever was half heard is dropped. */
    abort() {
      wanted = false;
      clearTimeout(restartTimer);
      const r = rec;
      rec = null;
      try {
        r?.abort();
      } catch {
        // Not running.
      }
    },
    get listening() {
      return wanted;
    },
  };
}
