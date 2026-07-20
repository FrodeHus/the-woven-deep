import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  encodeActiveRun,
  type ActiveRun,
} from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import { effectiveReducedMotion, ScreenFade, SCREEN_FADE_MS } from '../src/ui/ScreenFade.js';
import { withUiProviders } from './with-ui-providers.js';

describe('effectiveReducedMotion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forces reduced motion on regardless of the OS setting when the setting is "on"', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    expect(effectiveReducedMotion('on')).toBe(true);
  });

  it('forces reduced motion off regardless of the OS setting when the setting is "off"', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(effectiveReducedMotion('off')).toBe(false);
  });

  it('defers to the OS media query when the setting is "system"', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(effectiveReducedMotion('system')).toBe(true);
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    expect(effectiveReducedMotion('system')).toBe(false);
  });
});

describe('ScreenFade', () => {
  it('renders no fade element on first mount', () => {
    const { container } = render(
      <ScreenFade transitionKey="a" reducedMotion={false}>
        <p>hello</p>
      </ScreenFade>,
    );
    expect(container.querySelector('.screen-fade')).toBeNull();
  });

  it('plays a fade element, aria-hidden and non-interactive, when the transition key changes', () => {
    const { container, rerender } = render(
      <ScreenFade transitionKey="a" reducedMotion={false}>
        <p>hello</p>
      </ScreenFade>,
    );
    rerender(
      <ScreenFade transitionKey="b" reducedMotion={false}>
        <p>hello</p>
      </ScreenFade>,
    );

    const fade = container.querySelector('.screen-fade');
    expect(fade).not.toBeNull();
    expect(fade).toHaveAttribute('aria-hidden', 'true');
  });

  it('removes the fade element on animationend', () => {
    const { container, rerender } = render(
      <ScreenFade transitionKey="a" reducedMotion={false}>
        <p>hello</p>
      </ScreenFade>,
    );
    rerender(
      <ScreenFade transitionKey="b" reducedMotion={false}>
        <p>hello</p>
      </ScreenFade>,
    );
    const fade = container.querySelector('.screen-fade')!;
    fireEvent.animationEnd(fade);
    expect(container.querySelector('.screen-fade')).toBeNull();
  });

  it('removes the fade element via a timeout backup if animationend never fires (reduced-motion animation: none case)', () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <ScreenFade transitionKey="a" reducedMotion={false}>
          <p>hello</p>
        </ScreenFade>,
      );
      rerender(
        <ScreenFade transitionKey="b" reducedMotion={false}>
          <p>hello</p>
        </ScreenFade>,
      );
      expect(container.querySelector('.screen-fade')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(SCREEN_FADE_MS);
      });
      expect(container.querySelector('.screen-fade')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never renders a fade element under reduced motion, even across a transition-key change', () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <ScreenFade transitionKey="a" reducedMotion>
          <p>hello</p>
        </ScreenFade>,
      );
      rerender(
        <ScreenFade transitionKey="b" reducedMotion>
          <p>hello</p>
        </ScreenFade>,
      );
      act(() => {
        vi.advanceTimersByTime(SCREEN_FADE_MS);
      });
      expect(container.querySelector('.screen-fade')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fade on every render, only when the key actually changes', () => {
    const { container, rerender } = render(
      <ScreenFade transitionKey="a" reducedMotion={false}>
        <p>hello</p>
      </ScreenFade>,
    );
    rerender(
      <ScreenFade transitionKey="a" reducedMotion={false}>
        <p>hello again</p>
      </ScreenFade>,
    );
    expect(container.querySelector('.screen-fade')).toBeNull();
  });
});

describe('ScreenFade composed with PlayScreen (input is never blocked)', () => {
  let pack: CompiledContentPack;

  beforeAll(async () => {
    pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
  });

  function fakeStorage(): SessionStorageLike {
    const store = new Map<string, string>();
    return {
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: string) => {
        store.set(key, value);
      },
    };
  }

  /** A fresh session with the hero already standing on the town's stairs down -- mirrors
   * `play-screen-tier.test.tsx`'s `sessionAtTownStairs` fixture -- so descending is a single
   * dispatch away, without walking there first. */
  function sessionAtTownStairs(): GuestSession {
    const fresh = createNewRun({ pack, seed: [11, 22, 33, 44], hero: DEFAULT_GUEST_HERO });
    const heroActor = fresh.actors.find((actor) => actor.playerControlled)!;
    const town = fresh.floors.find((floor) => floor.floorId === heroActor.floorId)!;
    const atStairDown: ActiveRun = {
      ...fresh,
      actors: fresh.actors.map((actor) =>
        actor.actorId === heroActor.actorId
          ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y }
          : actor,
      ),
    };
    const storage = fakeStorage();
    storage.set(SAVE_KEY, encodeActiveRun(atStairDown));
    return new GuestSession({ pack, storage });
  }

  it('keeps dispatching keydowns to the session while the floor-change fade is playing', () => {
    const guestSession = sessionAtTownStairs();
    const dispatchSpy = vi.spyOn(guestSession, 'dispatch');
    const { container } = render(
      withUiProviders(pack, <PlayScreen session={guestSession} pack={pack} />),
    );

    // Descend -- changes `projection.floor.floorId`, which is what PlayScreen keys its own
    // ScreenFade on for the floor-change transition. This should mount a fade overlay...
    // (drive the descend directly via dispatch, staying independent of keymap bindings.)
    act(() => {
      guestSession.dispatch({ type: 'descend' });
    });

    const fade = container.querySelector('.screen-fade');
    expect(fade).not.toBeNull();
    expect(fade).toHaveAttribute('aria-hidden', 'true');
    // jsdom never loads the real stylesheet, so `pointer-events: none` is asserted statically
    // against the real CSS in `styles-contract.test.ts` instead of via computed style here.

    // ...but a keydown fired at the window (the same global listener PlayScreen always attaches)
    // must still reach the session dispatcher: the fade never blocks input.
    dispatchSpy.mockClear();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(dispatchSpy).toHaveBeenCalled();
  });
});
