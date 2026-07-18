import { describe, expect, it, vi } from 'vitest';
import type { Direction } from '@woven-deep/engine';
import { createKeyDispatcher, routeKey } from '../src/ui/KeyRouter.js';
import { resolveKeymap } from '../src/session/settings.js';

function keyEvent(
  key: string,
  options: Readonly<{
    shiftKey?: boolean;
    target?: EventTarget | null;
    repeat?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }> = {},
) {
  return {
    key,
    shiftKey: options.shiftKey ?? false,
    target: options.target ?? null,
    repeat: options.repeat ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
  };
}

// The default resolved keymap (no player rebindings): this is the "default map" every existing
// test below routes against -- the compatibility proof that the new keymap-driven `routeKey`
// reproduces the pre-existing hardwired `KEYMAP`'s behavior exactly.
const defaultKeymap = resolveKeymap({});

describe('routeKey', () => {
  it('maps arrows, numpad, and vi keys to the eight directions', () => {
    const table: readonly (readonly [string, Direction])[] = [
      ['ArrowUp', 'north'], ['ArrowDown', 'south'], ['ArrowLeft', 'west'], ['ArrowRight', 'east'],
      ['8', 'north'], ['2', 'south'], ['4', 'west'], ['6', 'east'],
      ['7', 'northwest'], ['9', 'northeast'], ['1', 'southwest'], ['3', 'southeast'],
      ['k', 'north'], ['j', 'south'], ['h', 'west'], ['l', 'east'],
      ['y', 'northwest'], ['u', 'northeast'], ['b', 'southwest'], ['n', 'southeast'],
    ];
    for (const [key, direction] of table) {
      expect(routeKey({ event: keyEvent(key), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'move', direction });
    }
  });

  it('maps . R g > i and Escape', () => {
    expect(routeKey({ event: keyEvent('.'), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'wait' });
    expect(routeKey({ event: keyEvent('R', { shiftKey: true }), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'rest' });
    expect(routeKey({ event: keyEvent('g'), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'pickup' });
    expect(routeKey({ event: keyEvent('>'), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'descend' });
    expect(routeKey({ event: keyEvent('i'), overlayOpen: false, keymap: defaultKeymap }))
      .toEqual({ type: 'open-overlay', overlay: 'inventory' });
    expect(routeKey({ event: keyEvent('Escape'), overlayOpen: true, keymap: defaultKeymap })).toEqual({ type: 'close-overlay' });
    expect(routeKey({ event: keyEvent('Escape'), overlayOpen: false, keymap: defaultKeymap })).toBeNull();
  });

  it('ignores a bare "R" without shiftKey (avoids caps-lock false positives)', () => {
    expect(routeKey({ event: keyEvent('R', { shiftKey: false }), overlayOpen: false, keymap: defaultKeymap })).toBeNull();
  });

  it("maps ' to dismiss-hint (Task 8's onboarding hint strip)", () => {
    expect(routeKey({ event: keyEvent("'"), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'dismiss-hint' });
  });

  it('maps < to ascend and (Shift+)H to house -- bare "h" stays bound to west movement', () => {
    expect(routeKey({ event: keyEvent('<'), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'ascend' });
    expect(routeKey({ event: keyEvent('H', { shiftKey: true }), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'house' });
    expect(routeKey({ event: keyEvent('H', { shiftKey: false }), overlayOpen: false, keymap: defaultKeymap })).toBeNull();
    expect(routeKey({ event: keyEvent('h'), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'move', direction: 'west' });
  });

  it('maps Shift+T to trade-open -- bare "t" is unbound so it never collides with vi movement', () => {
    expect(routeKey({ event: keyEvent('T', { shiftKey: true }), overlayOpen: false, keymap: defaultKeymap })).toEqual({ type: 'trade-open' });
    expect(routeKey({ event: keyEvent('T', { shiftKey: false }), overlayOpen: false, keymap: defaultKeymap })).toBeNull();
    expect(routeKey({ event: keyEvent('t'), overlayOpen: false, keymap: defaultKeymap })).toBeNull();
  });

  it('returns null for any movement or action key while an overlay is open (except Escape)', () => {
    const keysToBlock = ['ArrowUp', 'h', '.', 'g', '>', 'i'];
    for (const key of keysToBlock) {
      expect(routeKey({ event: keyEvent(key), overlayOpen: true, keymap: defaultKeymap })).toBeNull();
    }
    expect(routeKey({ event: keyEvent('Escape'), overlayOpen: true, keymap: defaultKeymap })).toEqual({ type: 'close-overlay' });
  });

  it('returns null when the event target is an input, textarea, or select', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const target = { tagName } as unknown as EventTarget;
      expect(routeKey({ event: keyEvent('ArrowUp', { target }), overlayOpen: false, keymap: defaultKeymap })).toBeNull();
      expect(routeKey({ event: keyEvent('Escape', { target }), overlayOpen: false, keymap: defaultKeymap })).toBeNull();
    }
    // Sanity: an ordinary target (e.g. the document body) is unaffected.
    const bodyTarget = { tagName: 'BODY' } as unknown as EventTarget;
    expect(routeKey({ event: keyEvent('ArrowUp', { target: bodyTarget }), overlayOpen: false, keymap: defaultKeymap }))
      .toEqual({ type: 'move', direction: 'north' });
  });

  describe('overlay-open keys (new)', () => {
    it('maps i/c/m/x/o/Shift+? to their open-overlay outcomes', () => {
      expect(routeKey({ event: keyEvent('i'), overlayOpen: false, keymap: defaultKeymap }))
        .toEqual({ type: 'open-overlay', overlay: 'inventory' });
      expect(routeKey({ event: keyEvent('c'), overlayOpen: false, keymap: defaultKeymap }))
        .toEqual({ type: 'open-overlay', overlay: 'character-sheet' });
      expect(routeKey({ event: keyEvent('m'), overlayOpen: false, keymap: defaultKeymap }))
        .toEqual({ type: 'open-overlay', overlay: 'map-journal' });
      expect(routeKey({ event: keyEvent('x'), overlayOpen: false, keymap: defaultKeymap }))
        .toEqual({ type: 'open-overlay', overlay: 'codex' });
      expect(routeKey({ event: keyEvent('o'), overlayOpen: false, keymap: defaultKeymap }))
        .toEqual({ type: 'open-overlay', overlay: 'settings' });
      expect(routeKey({ event: keyEvent('?', { shiftKey: true }), overlayOpen: false, keymap: defaultKeymap }))
        .toEqual({ type: 'open-overlay', overlay: 'help' });
    });

    it('blocks overlay-open keys while an overlay is already open', () => {
      for (const key of ['c', 'm', 'x', 'o']) {
        expect(routeKey({ event: keyEvent(key), overlayOpen: true, keymap: defaultKeymap })).toBeNull();
      }
    });
  });

  it('ignores any Ctrl/Meta chord, even one that shares a key with a default binding', () => {
    // "k" is the default "Move north" binding -- Meta+K/Control+K must not also move the hero
    // (this is the browser/OS palette-open chord; see the ⌘K command palette listener).
    expect(routeKey({ event: keyEvent('k', { metaKey: true }), overlayOpen: false, keymap: defaultKeymap })).toBeNull();
    expect(routeKey({ event: keyEvent('k', { ctrlKey: true }), overlayOpen: false, keymap: defaultKeymap })).toBeNull();
  });

  describe('rebinding', () => {
    it('routes a rebound chord to its action and stops routing the old default chord', () => {
      const keymap = resolveKeymap({ wait: { key: 'z', shift: false } });
      expect(routeKey({ event: keyEvent('z'), overlayOpen: false, keymap })).toEqual({ type: 'wait' });
      expect(routeKey({ event: keyEvent('.'), overlayOpen: false, keymap })).toBeNull();
    });

    it('never lets a rebinding steal an arrow/numpad hardwired movement key', () => {
      // Even if some hypothetical override bound another action to "ArrowUp", the hardwired
      // direction table is checked first and always wins.
      const keymap = resolveKeymap({ wait: { key: 'ArrowUp', shift: false } });
      expect(routeKey({ event: keyEvent('ArrowUp'), overlayOpen: false, keymap })).toEqual({ type: 'move', direction: 'north' });
    });
  });
});

describe('createKeyDispatcher (repeat rate-limit guard)', () => {
  it('drops a rapid repeat:true burst, dispatching at most one intent per 80ms window', () => {
    let time = 0;
    const now = () => time;
    const dispatch = vi.fn();
    const handler = createKeyDispatcher(
      { dispatch, openOverlay: vi.fn(), closeOverlay: vi.fn(), dismissHint: vi.fn() },
      () => false,
      () => defaultKeymap,
      now,
    );

    // First (non-repeat) press always passes.
    handler(keyEvent('.', { repeat: false }));
    expect(dispatch).toHaveBeenCalledTimes(1);

    // OS auto-repeat: a burst of `repeat: true` keydowns arriving well within the 80ms window —
    // all but the first accepted dispatch must be dropped.
    for (let i = 0; i < 5; i += 1) {
      time += 10;
      handler(keyEvent('.', { repeat: true }));
    }
    expect(dispatch).toHaveBeenCalledTimes(1);

    // Once 80ms have elapsed since the last accepted dispatch, a repeat keydown passes again.
    time += 80;
    handler(keyEvent('.', { repeat: true }));
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('always accepts discrete (non-repeat) presses, even in rapid succession', () => {
    let time = 0;
    const now = () => time;
    const dispatch = vi.fn();
    const handler = createKeyDispatcher(
      { dispatch, openOverlay: vi.fn(), closeOverlay: vi.fn(), dismissHint: vi.fn() },
      () => false,
      () => defaultKeymap,
      now,
    );

    for (let i = 0; i < 5; i += 1) {
      time += 1;
      handler(keyEvent('.', { repeat: false }));
    }
    expect(dispatch).toHaveBeenCalledTimes(5);
  });

  it('routes open-overlay(inventory) and close-overlay outcomes to their handlers instead of dispatch', () => {
    const dispatch = vi.fn();
    const openOverlay = vi.fn();
    const closeOverlay = vi.fn();
    let overlayOpen = false;
    const handler = createKeyDispatcher(
      { dispatch, openOverlay, closeOverlay, dismissHint: vi.fn() },
      () => overlayOpen,
      () => defaultKeymap,
    );

    handler(keyEvent('i'));
    expect(openOverlay).toHaveBeenCalledOnce();
    expect(openOverlay).toHaveBeenCalledWith('inventory');

    overlayOpen = true;
    handler(keyEvent('Escape'));
    expect(closeOverlay).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('routes open-overlay outcomes to the openOverlay handler instead of dispatch', () => {
    const dispatch = vi.fn();
    const openOverlay = vi.fn();
    const handler = createKeyDispatcher(
      { dispatch, openOverlay, closeOverlay: vi.fn(), dismissHint: vi.fn() },
      () => false,
      () => defaultKeymap,
    );

    handler(keyEvent('c'));
    expect(openOverlay).toHaveBeenCalledOnce();
    expect(openOverlay).toHaveBeenCalledWith('character-sheet');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('routes dismiss-hint outcomes to the dismissHint handler instead of dispatch', () => {
    const dispatch = vi.fn();
    const dismissHint = vi.fn();
    const handler = createKeyDispatcher(
      { dispatch, openOverlay: vi.fn(), closeOverlay: vi.fn(), dismissHint },
      () => false,
      () => defaultKeymap,
    );

    handler(keyEvent("'"));
    expect(dismissHint).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
