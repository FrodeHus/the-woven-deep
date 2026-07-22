/** A minimal shape of what `@fastify/websocket` hands the route handler — just enough of `ws`'s
 * `WebSocket` for this module to send/receive/close without depending on `@types/ws` here.
 *
 * Lives in its own module (rather than `routes/ws-play.ts`, which originally declared it) so
 * `connection-registry.ts` can depend on the type without creating a `routes → play → routes`
 * import cycle: `ws-play.ts` re-exports it for backwards compatibility. */
export interface PlaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
}
