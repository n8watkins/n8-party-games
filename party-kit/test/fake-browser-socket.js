// The browser's WebSocket, faked for the client's tests: every socket made is kept, and a test
// opens it, makes the room say something on it, or lets it die as a lost signal would.
export class FakeWebSocket {
  static OPEN = 1;
  /** Every socket made since the last reset, oldest first. */
  static made = [];
  static get last() {
    return FakeWebSocket.made.at(-1) ?? null;
  }
  constructor(url) {
    this.url = String(url);
    this.readyState = 0;
    this.sent = [];
    this.closedByPage = false;
    FakeWebSocket.made.push(this);
  }
  send(text) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("not open");
    this.sent.push(text);
  }
  /** The page closed it. */
  close() {
    this.closedByPage = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  hear(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  /** The connection was lost without the page closing it (the signal went, the phone suspended the page). */
  die(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
  /** The token this socket named in its first message, or null when its first message was not a hello. */
  helloToken() {
    try {
      const first = JSON.parse(this.sent[0]);
      return first.t === "hello" ? first.token : null;
    } catch {
      return null;
    }
  }
  /** What was sent: the keep-alive text as "keep-alive", a clock ping as "clock", anything else by its `t`. */
  kinds() {
    return this.sent.map((text) => (text === "ping" ? "keep-alive" : JSON.parse(text).t === "ping" ? "clock" : JSON.parse(text).t));
  }
}
