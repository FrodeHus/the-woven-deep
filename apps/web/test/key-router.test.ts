import { describe, expect, it, vi } from 'vitest';
import type { Direction } from '@woven-deep/engine';
import { createKeyDispatcher, KEYMAP, routeKey } from '../src/ui/KeyRouter.js';

function keyEvent(key: string, options: Readonly<{ shiftKey?: boolean; target?: EventTarget | null }> = {}) {
  return { key, shiftKey: options.shiftKey ?? false, target: options.target ?? null };
}

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
      expect(routeKey({ event: keyEvent(key), overlayOpen: false })).toEqual({ type: 'move', direction });
      expect(KEYMAP[key]).toEqual({ type: 'move', direction });
    }
  });

  it('maps . R g > i and Escape', () => {
    expect(routeKey({ event: keyEvent('.'), overlayOpen: false })).toEqual({ type: 'wait' });
    expect(routeKey({ event: keyEvent('R', { shiftKey: true }), overlayOpen: false })).toEqual({ type: 'rest' });
    expect(routeKey({ event: keyEvent('g'), overlayOpen: false })).toEqual({ type: 'pickup' });
    expect(routeKey({ event: keyEvent('>'), overlayOpen: false })).toEqual({ type: 'descend' });
    expect(routeKey({ event: keyEvent('i'), overlayOpen: false })).toEqual({ type: 'open-backpack' });
    expect(routeKey({ event: keyEvent('Escape'), overlayOpen: true })).toEqual({ type: 'close-overlay' });
    expect(routeKey({ event: keyEvent('Escape'), overlayOpen: false })).toBeNull();
  });

  it('ignores a bare "R" without shiftKey (avoids caps-lock false positives)', () => {
    expect(routeKey({ event: keyEvent('R', { shiftKey: false }), overlayOpen: false })).toBeNull();
  });

  it('returns null for any movement or action key while an overlay is open (except Escape)', () => {
    const keysToBlock = ['ArrowUp', 'h', '.', 'g', '>', 'i'];
    for (const key of keysToBlock) {
      expect(routeKey({ event: keyEvent(key), overlayOpen: true })).toBeNull();
    }
    expect(routeKey({ event: keyEvent('Escape'), overlayOpen: true })).toEqual({ type: 'close-overlay' });
  });

  it('returns null when the event target is an input, textarea, or select', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const target = { tagName } as unknown as EventTarget;
      expect(routeKey({ event: keyEvent('ArrowUp', { target }), overlayOpen: false })).toBeNull();
      expect(routeKey({ event: keyEvent('Escape', { target }), overlayOpen: false })).toBeNull();
    }
    // Sanity: an ordinary target (e.g. the document body) is unaffected.
    const bodyTarget = { tagName: 'BODY' } as unknown as EventTarget;
    expect(routeKey({ event: keyEvent('ArrowUp', { target: bodyTarget }), overlayOpen: false }))
      .toEqual({ type: 'move', direction: 'north' });
  });
});

describe('createKeyDispatcher (input-flood guard)', () => {
  it('drops a burst of synchronous keydowns that arrive while a dispatch is already executing', () => {
    let dispatchCount = 0;
    let handler: (event: ReturnType<typeof keyEvent>) => void;
    const dispatch = vi.fn(() => {
      dispatchCount += 1;
      // Simulate auto-repeat: a burst of further keydowns arrives *during* this dispatch, before
      // it returns. Only the first should ever have made it through; all of these must be dropped.
      for (let i = 0; i < 5; i += 1) handler(keyEvent('.'));
    });
    handler = createKeyDispatcher({ dispatch, openBackpack: vi.fn(), closeOverlay: vi.fn() }, () => false);

    handler(keyEvent('.'));

    expect(dispatchCount).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('resumes dispatching once the in-flight dispatch has completed', () => {
    let handler: (event: ReturnType<typeof keyEvent>) => void;
    const dispatch = vi.fn();
    handler = createKeyDispatcher({ dispatch, openBackpack: vi.fn(), closeOverlay: vi.fn() }, () => false);

    handler(keyEvent('.'));
    handler(keyEvent('.'));

    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('routes open-backpack and close-overlay outcomes to their handlers instead of dispatch', () => {
    const dispatch = vi.fn();
    const openBackpack = vi.fn();
    const closeOverlay = vi.fn();
    let overlayOpen = false;
    const handler = createKeyDispatcher({ dispatch, openBackpack, closeOverlay }, () => overlayOpen);

    handler(keyEvent('i'));
    expect(openBackpack).toHaveBeenCalledOnce();

    overlayOpen = true;
    handler(keyEvent('Escape'));
    expect(closeOverlay).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
