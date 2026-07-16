import type { Direction } from '@woven-deep/engine';
import type { PlayerIntent } from '../session/intents.js';

/** Everything `routeKey` can hand back to the caller besides a `PlayerIntent`: opening the
 * backpack, or closing whatever overlay (backpack or decision prompt) is currently open. */
export type RouterOutcome =
  | PlayerIntent
  | { readonly type: 'open-backpack' }
  | { readonly type: 'close-overlay' }
  | null;

const DIRECTION_KEYS: Readonly<Record<string, Direction>> = {
  // Arrows: the four cardinal directions.
  ArrowUp: 'north', ArrowDown: 'south', ArrowLeft: 'west', ArrowRight: 'east',
  // Numpad (NumLock on, so `event.key` reports the digit): all eight directions.
  '8': 'north', '2': 'south', '4': 'west', '6': 'east',
  '7': 'northwest', '9': 'northeast', '1': 'southwest', '3': 'southeast',
  // vi keys: all eight directions.
  k: 'north', j: 'south', h: 'west', l: 'east',
  y: 'northwest', u: 'northeast', b: 'southwest', n: 'southeast',
};

/**
 * The full set of keys that map straight to a `PlayerIntent` (as opposed to `routeKey`'s two
 * overlay-control outcomes, `open-backpack` and `close-overlay`, which aren't intents).
 */
export const KEYMAP: Readonly<Record<string, PlayerIntent>> = {
  ...Object.fromEntries(
    Object.entries(DIRECTION_KEYS).map(([key, direction]) => [key, { type: 'move', direction } as const]),
  ),
  '.': { type: 'wait' },
  R: { type: 'rest' },
  g: { type: 'pickup' },
  '>': { type: 'descend' },
  '<': { type: 'ascend' },
  H: { type: 'house' },
};

function isFormFieldTarget(target: EventTarget | null): boolean {
  const tagName = (target as { tagName?: unknown } | null)?.tagName;
  if (typeof tagName !== 'string') return false;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

/**
 * Pure translation from a keydown event to what the player wants. Framework-free: the component
 * layer (`PlayScreen`) owns the actual `window` listener and forwards the result to
 * `session.dispatch`, `session.setBackpackOpen`, or an overlay's close handler.
 */
export function routeKey(input: Readonly<{
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'target'>;
  overlayOpen: boolean;
}>): RouterOutcome {
  const { event, overlayOpen } = input;

  if (isFormFieldTarget(event.target)) return null;
  if (event.key === 'Escape') return overlayOpen ? { type: 'close-overlay' } : null;
  if (overlayOpen) return null;
  if (event.key === 'i') return { type: 'open-backpack' };
  // `R` (rest) requires Shift so a caps-lock "R" (no Shift) doesn't rest by accident.
  if (event.key === 'R' && !event.shiftKey) return null;
  // `H` (house) requires Shift for the same reason, and so it never collides with the bare `h`
  // vi-key already bound to west movement (see `DIRECTION_KEYS`).
  if (event.key === 'H' && !event.shiftKey) return null;

  return KEYMAP[event.key] ?? null;
}

export interface KeyDispatchHandlers {
  readonly dispatch: (intent: PlayerIntent) => void;
  readonly openBackpack: () => void;
  readonly closeOverlay: () => void;
}

export type KeyDispatcher = (event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'target' | 'repeat'>) => void;

/** OS key auto-repeat fires at roughly 30/sec; this is the minimum gap enforced between two
 * accepted `repeat: true` keydowns (see `createKeyDispatcher`). */
export const REPEAT_INTERVAL_MS = 80;

/**
 * Wraps `routeKey` with the input-flood guard: dispatching a command is synchronous and expensive
 * enough (re-project the whole run, serialize it to storage) that OS key auto-repeat must not
 * outpace what the player can perceive. Browser keydown dispatch is synchronous and
 * non-reentrant, so a reentrancy guard (an in-flight boolean) can never actually fire — instead
 * this rate-limits `event.repeat === true` keydowns, dropping any that arrive within
 * `REPEAT_INTERVAL_MS` of the last accepted dispatch. The first (non-repeat) press, and any
 * discrete non-repeat press, always passes regardless of timing. `isOverlayOpen` is read fresh on
 * every keydown (a function, not a snapshot) so the guard always sees the latest overlay state.
 * `now` is injectable so tests can drive the rate limit with a controllable clock instead of the
 * ambient `performance.now`.
 */
export function createKeyDispatcher(
  handlers: KeyDispatchHandlers,
  isOverlayOpen: () => boolean,
  now: () => number = () => performance.now(),
): KeyDispatcher {
  let lastAcceptedAt = -Infinity;
  return (event) => {
    const timestamp = now();
    if (event.repeat && timestamp - lastAcceptedAt < REPEAT_INTERVAL_MS) return;
    const outcome = routeKey({ event, overlayOpen: isOverlayOpen() });
    if (outcome === null) return;
    lastAcceptedAt = timestamp;
    if (outcome.type === 'open-backpack') {
      handlers.openBackpack();
      return;
    }
    if (outcome.type === 'close-overlay') {
      handlers.closeOverlay();
      return;
    }
    handlers.dispatch(outcome);
  };
}
