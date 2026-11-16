// Listening for one turn's word with the browser's own speech recognition (Chrome, Edge, Safari;
// not Firefox). One turn may need several recognition sessions: when one ends having heard
// nothing (the browser gives up after some silence), the next starts by itself until the turn
// has its word or is stopped.
//
// The words the recogniser offers (up to ten guesses with how sure it is of each) go to the
// shared matcher as they are: it decides which guesses count.

export const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition || null : null;
export const MAX_ALTERNATIVES = 10;

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
    r.addEventListener("audiostart", () => {
      if (rec !== r || started) return;
      started = true;
      onStart?.();
    });
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
      if (interim.trim()) onInterim?.(interim.trim());
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
    r.addEventListener("end", () => {
      if (rec !== r) return;
      rec = null;
      if (wanted && !final) restartTimer = setTimeout(session, 120);
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
