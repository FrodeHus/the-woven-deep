/**
 * The minimal WebSocket surface `WsClient` depends on -- deliberately structural rather than
 * `typeof WebSocket`, so a test can supply a fully in-memory fake with no DOM/`ws` package
 * involved. The real browser `WebSocket` already satisfies this shape as-is.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
}

/** The standard `WebSocket.OPEN` readyState value, duplicated here so this module never needs to
 * reference the global `WebSocket` constructor just for its numeric constants -- keeping it usable
 * from a plain (non-DOM) test environment too. */
const OPEN_READY_STATE = 1;

export type WebSocketFactory = (url: string) => WebSocketLike;

/** Fixed backoff schedule (ms) between reconnect attempts -- cycles on its last entry once the
 * schedule is exhausted, rather than growing unbounded. */
const DEFAULT_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 5000, 10000];

export interface WsClientOptions {
  readonly url: string;
  /** Defaults to the browser's global `WebSocket`. Tests supply a fake here. */
  readonly createSocket?: WebSocketFactory;
  readonly backoffMs?: readonly number[];
}

/**
 * A thin, reconnecting WebSocket wrapper: opens `url`, exposes `send`/`onMessage`/`onOpen`/
 * `onClose` subscriptions, and automatically reopens the socket (following a simple fixed backoff
 * schedule) after any UNEXPECTED close -- one this client did not itself request via `close()`.
 * Carries no protocol knowledge whatsoever (no framing/parsing beyond a `JSON.stringify` on the
 * way out) -- `ProfileSession` is the only thing that interprets what flows over it, and decides
 * when a close is terminal (a `superseded`/version-mismatch `error`) by calling `close()` itself.
 */
export class WsClient {
  private readonly url: string;
  private readonly createSocket: WebSocketFactory;
  private readonly backoffMs: readonly number[];
  private socket: WebSocketLike | null = null;
  private closedByCaller = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly messageListeners = new Set<(data: unknown) => void>();
  private readonly openListeners = new Set<() => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(options: WsClientOptions) {
    this.url = options.url;
    this.createSocket =
      options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  /** Opens the socket. Safe to call once; reconnects happen automatically afterward. */
  connect(): void {
    this.closedByCaller = false;
    this.open();
  }

  private open(): void {
    const socket = this.createSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectAttempt = 0;
      for (const listener of this.openListeners) listener();
    };
    socket.onmessage = (event) => {
      for (const listener of this.messageListeners) listener(event.data);
    };
    socket.onclose = () => {
      for (const listener of this.closeListeners) listener();
      if (!this.closedByCaller) this.scheduleReconnect();
    };
    socket.onerror = () => {
      // The socket's own `onclose` always follows an error in every environment this wraps (the
      // browser's `WebSocket`, the `ws` package, and this suite's fakes) -- nothing extra to do.
    };
  }

  private scheduleReconnect(): void {
    const delay = this.backoffMs[Math.min(this.reconnectAttempt, this.backoffMs.length - 1)]!;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      if (!this.closedByCaller) this.open();
    }, delay);
  }

  /** Sends `message` as JSON. Silently dropped when the socket is not currently open (e.g. mid
   * reconnect) -- the caller already has its own notion of what happens to an unacknowledged
   * command (nothing: the next reconnect's `state` message is the resync). */
  send(message: unknown): void {
    if (this.socket && this.socket.readyState === OPEN_READY_STATE) {
      this.socket.send(JSON.stringify(message));
    }
  }

  onMessage(handler: (data: unknown) => void): () => void {
    this.messageListeners.add(handler);
    return () => {
      this.messageListeners.delete(handler);
    };
  }

  onOpen(handler: () => void): () => void {
    this.openListeners.add(handler);
    return () => {
      this.openListeners.delete(handler);
    };
  }

  onClose(handler: () => void): () => void {
    this.closeListeners.add(handler);
    return () => {
      this.closeListeners.delete(handler);
    };
  }

  /** Closes the socket and stops all future reconnect attempts -- the terminal, caller-requested
   * shutdown (a `superseded`/version-mismatch `error`, or the owning session going away). */
  close(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}
