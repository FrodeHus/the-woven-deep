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

  return KEYMAP[event.key] ?? null;
}

export interface KeyDispatchHandlers {
  readonly dispatch: (intent: PlayerIntent) => void;
  readonly openBackpack: () => void;
  readonly closeOverlay: () => void;
}

export type KeyDispatcher = (event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'target'>) => void;

/**
 * Wraps `routeKey` with the input-flood guard: dispatching a command is synchronous and expensive
 * enough (re-project the whole run, serialize it to storage) that a burst of keydowns arriving
 * while one is already in flight — key auto-repeat fires at roughly 30/sec — must not queue up a
 * second dispatch on top of the first. `isOverlayOpen` is read fresh on every keydown (a function,
 * not a snapshot) so the guard always sees the latest overlay state.
 */
export function createKeyDispatcher(handlers: KeyDispatchHandlers, isOverlayOpen: () => boolean): KeyDispatcher {
  let dispatching = false;
  return (event) => {
    if (dispatching) return;
    const outcome = routeKey({ event, overlayOpen: isOverlayOpen() });
    if (outcome === null) return;
    if (outcome.type === 'open-backpack') {
      handlers.openBackpack();
      return;
    }
    if (outcome.type === 'close-overlay') {
      handlers.closeOverlay();
      return;
    }
    dispatching = true;
    try {
      handlers.dispatch(outcome);
    } finally {
      dispatching = false;
    }
  };
}
