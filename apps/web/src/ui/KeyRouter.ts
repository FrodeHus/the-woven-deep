import type { Direction } from '@woven-deep/engine';
import type { PlayerIntent } from '../session/intents.js';
import type { ActionId, ResolvedKeymap } from '../session/settings.js';

/** The six overlay-open commands whose outcome is `{ type: 'open-overlay', overlay }`. Typed
 * directly as this string union (rather than importing an `OverlayId` from elsewhere) so this
 * module stays free of a dependency on the overlay registry -- it happens to be the exact same
 * string set as `OverlayId` (registry.ts), `inventory` included: the guest-interface Task 5
 * absorption retired the legacy `open-backpack` outcome, so `i` now routes through this same
 * registry path as every other overlay. */
export type OverlayActionId = 'inventory' | 'character-sheet' | 'map-journal' | 'codex' | 'settings' | 'help';

/** Everything `routeKey` can hand back to the caller besides a `PlayerIntent`: opening a registry
 * overlay, or closing whatever overlay is currently open. */
export type RouterOutcome =
  | PlayerIntent
  | { readonly type: 'open-overlay'; readonly overlay: OverlayActionId }
  | { readonly type: 'close-overlay' }
  | { readonly type: 'dismiss-hint' }
  | null;

/**
 * Hardwired movement synonyms: arrows and numpad (NumLock on, so `event.key` reports the digit).
 * These are never rebindable -- they always mean movement regardless of the resolved keymap. The
 * *primary* movement keys (vi keys, by default) are rebindable via `ActionId`s `move.n`..`move.nw`
 * in `settings.ts`'s `DEFAULT_BINDINGS` / the resolved keymap passed into `routeKey`.
 */
const HARDWIRED_DIRECTION_KEYS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'north', ArrowDown: 'south', ArrowLeft: 'west', ArrowRight: 'east',
  '8': 'north', '2': 'south', '4': 'west', '6': 'east',
  '7': 'northwest', '9': 'northeast', '1': 'southwest', '3': 'southeast',
};

function directionForMoveAction(action: MoveActionId): Direction {
  switch (action) {
    case 'move.n': return 'north';
    case 'move.ne': return 'northeast';
    case 'move.e': return 'east';
    case 'move.se': return 'southeast';
    case 'move.s': return 'south';
    case 'move.sw': return 'southwest';
    case 'move.w': return 'west';
    case 'move.nw': return 'northwest';
  }
}

function isFormFieldTarget(target: EventTarget | null): boolean {
  const tagName = (target as { tagName?: unknown } | null)?.tagName;
  if (typeof tagName !== 'string') return false;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

type MoveActionId = `move.${'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'}`;
type NonMoveActionId = Exclude<ActionId, MoveActionId>;

function isMoveAction(action: ActionId): action is MoveActionId {
  return action.startsWith('move.');
}

/** Translates a resolved `ActionId` (anything but a hardwired direction or Escape, both handled
 * directly in `routeKey`) to the outcome `routeKey` hands the caller. */
function outcomeForAction(action: ActionId): RouterOutcome {
  if (isMoveAction(action)) {
    return { type: 'move', direction: directionForMoveAction(action) };
  }
  const nonMoveAction: NonMoveActionId = action;
  switch (nonMoveAction) {
    case 'wait': return { type: 'wait' };
    case 'rest': return { type: 'rest' };
    case 'pickup': return { type: 'pickup' };
    case 'descend': return { type: 'descend' };
    case 'ascend': return { type: 'ascend' };
    case 'house': return { type: 'house' };
    case 'trade': return { type: 'trade-open' };
    case 'inventory':
    case 'character-sheet':
    case 'map-journal':
    case 'codex':
    case 'settings':
    case 'help':
      return { type: 'open-overlay', overlay: nonMoveAction };
    case 'dismiss-hint':
      return { type: 'dismiss-hint' };
    default: {
      const exhaustive: never = nonMoveAction;
      return exhaustive;
    }
  }
}

/** Looks up which `ActionId` (if any) the resolved keymap binds a keystroke to. A chord requiring
 * Shift only matches when Shift is actually held (`"Shift+R"` vs a bare, capslock-produced `"R"`);
 * a chord that doesn't require Shift matches on `key` alone, ignoring `shiftKey` -- this reproduces
 * the pre-existing behavior for symbol keys whose shifted and unshifted forms are already distinct
 * `event.key` values (e.g. `.` vs `>`), where checking `shiftKey` would be redundant. */
function lookupAction(keymap: ResolvedKeymap, key: string, shiftKey: boolean): ActionId | null {
  if (shiftKey) {
    const shifted = keymap.byChord.get(`Shift+${key}`);
    if (shifted !== undefined) return shifted;
  }
  return keymap.byChord.get(key) ?? null;
}

/**
 * Pure translation from a keydown event to what the player wants. Framework-free: the component
 * layer (`PlayScreen`) owns the actual `window` listener and forwards the result to
 * `session.dispatch`, `session.setBackpackOpen`, an overlay's open/close handler, etc.
 *
 * `keymap` is the resolved keymap (`resolveKeymap` in `settings.ts`) -- defaults merged with the
 * player's rebindings. Escape stays hardwired to `close-overlay` (it is not an `ActionId`, and is
 * never rebindable); arrows/numpad stay hardwired to movement (see `HARDWIRED_DIRECTION_KEYS`)
 * regardless of `keymap`.
 */
export function routeKey(input: Readonly<{
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'target'>;
  overlayOpen: boolean;
  keymap: ResolvedKeymap;
}>): RouterOutcome {
  const { event, overlayOpen, keymap } = input;

  if (isFormFieldTarget(event.target)) return null;
  if (event.key === 'Escape') return overlayOpen ? { type: 'close-overlay' } : null;
  if (overlayOpen) return null;

  const hardwiredDirection = HARDWIRED_DIRECTION_KEYS[event.key];
  if (hardwiredDirection) return { type: 'move', direction: hardwiredDirection };

  const action = lookupAction(keymap, event.key, event.shiftKey);
  return action === null ? null : outcomeForAction(action);
}

export interface KeyDispatchHandlers {
  readonly dispatch: (intent: PlayerIntent) => void;
  readonly openOverlay: (overlay: OverlayActionId) => void;
  readonly closeOverlay: () => void;
  /** Retires whatever onboarding hint (Task 8) is currently showing -- a no-op if none is. */
  readonly dismissHint: () => void;
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
 * `getKeymap` is likewise read fresh on every keydown so a rebinding made mid-run takes effect
 * immediately. `now` is injectable so tests can drive the rate limit with a controllable clock
 * instead of the ambient `performance.now`.
 */
export function createKeyDispatcher(
  handlers: KeyDispatchHandlers,
  isOverlayOpen: () => boolean,
  getKeymap: () => ResolvedKeymap,
  now: () => number = () => performance.now(),
): KeyDispatcher {
  let lastAcceptedAt = -Infinity;
  return (event) => {
    const timestamp = now();
    if (event.repeat && timestamp - lastAcceptedAt < REPEAT_INTERVAL_MS) return;
    const outcome = routeKey({ event, overlayOpen: isOverlayOpen(), keymap: getKeymap() });
    if (outcome === null) return;
    lastAcceptedAt = timestamp;
    if (outcome.type === 'open-overlay') {
      handlers.openOverlay(outcome.overlay);
      return;
    }
    if (outcome.type === 'close-overlay') {
      handlers.closeOverlay();
      return;
    }
    if (outcome.type === 'dismiss-hint') {
      handlers.dismissHint();
      return;
    }
    handlers.dispatch(outcome);
  };
}
