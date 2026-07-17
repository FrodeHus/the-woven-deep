import { describe, expect, it } from 'vitest';
import type { SessionStorageLike } from '../src/session/storage.js';
import {
  ACTION_IDS, bindingConflict, chordKey, chordReserved, DEFAULT_BINDINGS, DEFAULT_SETTINGS,
  loadSettings, resolveKeymap, saveSettings, SETTINGS_KEY, type ActionId, type KeyChord, type Settings,
} from '../src/session/settings.js';

/** An in-memory `SessionStorageLike` fake, mirroring the pattern used for `GuestSession`'s
 * storage-seam tests: no DOM, and `throwOnSet` lets a test force `saveSettings`'s write path to
 * fail so the failure-classification branch is exercised. */
function fakeStorage(initial: Readonly<Record<string, string>> = {}, throwOnSet: Error | null = null): SessionStorageLike {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    set(key, value) {
      if (throwOnSet) throw throwOnSet;
      store.set(key, value);
    },
  };
}

describe('DEFAULT_BINDINGS', () => {
  it('is conflict-free: no two actions share a serialized chord', () => {
    const chords = ACTION_IDS.map((action) => chordKey(DEFAULT_BINDINGS[action]));
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('binds every ActionId', () => {
    for (const action of ACTION_IDS) {
      expect(DEFAULT_BINDINGS[action]).toBeDefined();
    }
  });

  it('does not collide with the hardwired arrow/numpad/Escape keys or the new overlay keys', () => {
    const reserved = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '1', '2', '3', '4', '6', '7', '8', '9', 'Escape'];
    const boundChords = new Set(ACTION_IDS.map((action) => chordKey(DEFAULT_BINDINGS[action])));
    for (const key of reserved) {
      expect(boundChords.has(key)).toBe(false);
    }
  });
});

describe('resolveKeymap', () => {
  it('maps every ActionId to a chord in byAction', () => {
    const { byAction } = resolveKeymap({});
    for (const action of ACTION_IDS) {
      expect(byAction[action]).toEqual(DEFAULT_BINDINGS[action]);
    }
  });

  it('builds byChord as the inverse of byAction', () => {
    const { byChord, byAction } = resolveKeymap({});
    for (const action of ACTION_IDS) {
      expect(byChord.get(chordKey(byAction[action]))).toBe(action);
    }
  });

  it('lets an override shadow a default for one action without disturbing the rest', () => {
    const override: KeyChord = { key: 'z', shift: false };
    const { byAction, byChord } = resolveKeymap({ wait: override });
    expect(byAction.wait).toEqual(override);
    expect(byChord.get('z')).toBe('wait');
    expect(byChord.get(chordKey(DEFAULT_BINDINGS.wait))).toBeUndefined();
    expect(byAction.rest).toEqual(DEFAULT_BINDINGS.rest);
  });
});

describe('bindingConflict', () => {
  it('reports the action already holding a chord', () => {
    expect(bindingConflict({}, 'wait', DEFAULT_BINDINGS.rest)).toBe('rest');
  });

  it('returns null when the chord is free', () => {
    expect(bindingConflict({}, 'wait', { key: 'z', shift: false })).toBeNull();
  });

  it('returns null when the only match is the action itself (self-conflict is not a conflict)', () => {
    expect(bindingConflict({}, 'wait', DEFAULT_BINDINGS.wait)).toBeNull();
  });

  it('considers already-applied overrides, not just the defaults', () => {
    // Free up '.' by moving `wait` off it, then binding `pickup` to '.' should be conflict-free.
    const overrides: Settings['bindings'] = { wait: { key: 'z', shift: false } };
    expect(bindingConflict(overrides, 'pickup', { key: '.', shift: false })).toBeNull();
  });
});

describe('chordReserved', () => {
  it('reports true for every hardwired arrow/numpad key routeKey resolves before the keymap', () => {
    const reserved = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '1', '2', '3', '4', '6', '7', '8', '9'];
    for (const key of reserved) {
      expect(chordReserved({ key, shift: false })).toBe(true);
    }
  });

  it('ignores shift: a hardwired key is reserved regardless of the shift flag', () => {
    expect(chordReserved({ key: 'ArrowUp', shift: true })).toBe(true);
  });

  it('returns false for an ordinary rebindable key', () => {
    expect(chordReserved({ key: 'z', shift: false })).toBe(false);
  });
});

describe('loadSettings / saveSettings round-trip', () => {
  it('returns DEFAULT_SETTINGS with corrupted: false when nothing is stored', () => {
    const result = loadSettings(fakeStorage());
    expect(result).toEqual({ settings: DEFAULT_SETTINGS, corrupted: false, droppedOverrides: [] });
  });

  it('round-trips a saved Settings value', () => {
    const storage = fakeStorage();
    const settings: Settings = {
      fontScale: 1.3,
      reducedMotion: 'on',
      bindings: { wait: { key: 'z', shift: false } },
    };
    expect(saveSettings(storage, settings)).toEqual({ ok: true });
    expect(loadSettings(storage)).toEqual({ settings, corrupted: false, droppedOverrides: [] });
  });

  it('saveSettings reports ok:false with the classified reason (without throwing) when the storage write fails', () => {
    const storage = fakeStorage({}, new Error('disabled'));
    expect(saveSettings(storage, DEFAULT_SETTINGS)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('saveSettings rejects bindings colliding with another action\'s default, writing nothing', () => {
    const storage = fakeStorage();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      // `pickup`'s default is bound to "g"; overriding `wait` onto "g" collides with it.
      bindings: { wait: { key: 'g', shift: false } },
    };
    expect(saveSettings(storage, settings)).toEqual({ ok: false });
    expect(storage.get(SETTINGS_KEY)).toBeNull();
  });

  it('saveSettings rejects a binding onto a hardwired arrow/numpad key, writing nothing', () => {
    const storage = fakeStorage();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      bindings: { wait: { key: 'ArrowUp', shift: false } },
    };
    expect(saveSettings(storage, settings)).toEqual({ ok: false });
    expect(storage.get(SETTINGS_KEY)).toBeNull();
  });

  it('saveSettings rejects two overrides colliding with EACH OTHER, writing nothing', () => {
    const storage = fakeStorage();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      bindings: {
        trade: { key: 'z', shift: false },
        settings: { key: 'z', shift: false },
      },
    };
    expect(saveSettings(storage, settings)).toEqual({ ok: false });
    expect(storage.get(SETTINGS_KEY)).toBeNull();
  });

  it('treats a corrupted (non-JSON) blob as DEFAULT_SETTINGS with corrupted: true', () => {
    const storage = fakeStorage({ [SETTINGS_KEY]: 'not json{{{' });
    expect(loadSettings(storage)).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true, droppedOverrides: [] });
  });

  it('treats a JSON value that is not an object (e.g. an array or a string) as corrupted', () => {
    const storage = fakeStorage({ [SETTINGS_KEY]: JSON.stringify([1, 2, 3]) });
    expect(loadSettings(storage)).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true, droppedOverrides: [] });
  });

  it('drops unknown top-level and bindings fields (forward tolerance), without marking corrupted', () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        fontScale: 1.15,
        reducedMotion: 'off',
        bindings: { wait: { key: 'z', shift: false }, 'not-a-real-action': { key: 'q', shift: false } },
        futureField: 'ignored',
      }),
    });
    const result = loadSettings(storage);
    expect(result.corrupted).toBe(false);
    expect(result.droppedOverrides).toEqual([]);
    expect(result.settings).toEqual({
      fontScale: 1.15,
      reducedMotion: 'off',
      bindings: { wait: { key: 'z', shift: false } },
    });
  });

  it('falls back per-field to defaults for an invalid fontScale/reducedMotion, without marking corrupted', () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({ fontScale: 99, reducedMotion: 'nonsense', bindings: {} }),
    });
    const result = loadSettings(storage);
    expect(result.corrupted).toBe(false);
    expect(result.settings.fontScale).toBe(DEFAULT_SETTINGS.fontScale);
    expect(result.settings.reducedMotion).toBe(DEFAULT_SETTINGS.reducedMotion);
  });

  it('drops a malformed (shape-invalid) bindings entry silently', () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        fontScale: 1,
        reducedMotion: 'system',
        bindings: { wait: { key: 'z' /* missing shift */ } },
      }),
    });
    const result = loadSettings(storage);
    expect(result.corrupted).toBe(false);
    expect(result.droppedOverrides).toEqual([]);
    expect(result.settings.bindings).toEqual({});
  });

  it('drops a stored override that collides with another action\'s default, reporting it in droppedOverrides', () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        fontScale: 1,
        reducedMotion: 'system',
        // `pickup`'s default is bound to "g"; overriding `wait` onto "g" collides with it.
        bindings: { wait: { key: 'g', shift: false } },
      }),
    });
    const result = loadSettings(storage);
    expect(result.corrupted).toBe(false);
    expect(result.droppedOverrides).toEqual(['wait']);
    expect(result.settings.bindings).toEqual({});
  });

  it('drops a stored override onto a hardwired arrow/numpad key, reporting it in droppedOverrides', () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        fontScale: 1,
        reducedMotion: 'system',
        // `ArrowUp` is a hardwired movement synonym (see KeyRouter.ts); it can never be bound to
        // another action because routeKey resolves it before ever consulting the keymap.
        bindings: { wait: { key: 'ArrowUp', shift: false } },
      }),
    });
    const result = loadSettings(storage);
    expect(result.corrupted).toBe(false);
    expect(result.droppedOverrides).toEqual(['wait']);
    expect(result.settings.bindings).toEqual({});
  });

  it('resolves two stored overrides colliding with EACH OTHER (not a default) deterministically by ACTION_IDS order, dropping the later one', () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        fontScale: 1,
        reducedMotion: 'system',
        // Neither `trade` nor `settings` collides with any default chord; they collide with each
        // other. `trade` precedes `settings` in ACTION_IDS, so it is accepted first and wins;
        // `settings` is the one dropped.
        bindings: {
          trade: { key: 'z', shift: false },
          settings: { key: 'z', shift: false },
        },
      }),
    });
    const result = loadSettings(storage);
    expect(result.corrupted).toBe(false);
    expect(result.droppedOverrides).toEqual(['settings']);
    expect(result.settings.bindings).toEqual({ trade: { key: 'z', shift: false } });
  });

  it('keeps a valid override alongside a dropped colliding one', () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        fontScale: 1,
        reducedMotion: 'system',
        bindings: {
          wait: { key: 'g', shift: false }, // collides with pickup's default -> dropped
          pickup: { key: 'z', shift: false }, // free -> kept
        },
      }),
    });
    const result = loadSettings(storage);
    expect(result.droppedOverrides).toEqual(['wait']);
    expect(result.settings.bindings).toEqual({ pickup: { key: 'z', shift: false } });
  });
});

describe('keymap-compat table', () => {
  // Every entry of the pre-existing `KEYMAP` (arrows/numpad/vi movement, `.`/R/g/>/</H/T, `i`)
  // must route identically through `routeKey`'s new keymap-driven path against the default
  // keymap. The hardwired arrow/numpad synonyms are asserted directly in key-router.test.ts
  // (they bypass the keymap entirely); this table covers the rebindable half.
  const table: readonly (readonly [ActionId, KeyChord])[] = [
    ['move.n', { key: 'k', shift: false }],
    ['move.s', { key: 'j', shift: false }],
    ['move.w', { key: 'h', shift: false }],
    ['move.e', { key: 'l', shift: false }],
    ['move.nw', { key: 'y', shift: false }],
    ['move.ne', { key: 'u', shift: false }],
    ['move.sw', { key: 'b', shift: false }],
    ['move.se', { key: 'n', shift: false }],
    ['wait', { key: '.', shift: false }],
    ['rest', { key: 'R', shift: true }],
    ['pickup', { key: 'g', shift: false }],
    ['descend', { key: '>', shift: false }],
    ['ascend', { key: '<', shift: false }],
    ['inventory', { key: 'i', shift: false }],
    ['house', { key: 'H', shift: true }],
    ['trade', { key: 'T', shift: true }],
  ];

  it('every pre-existing key routes to the same action it always did', () => {
    const { byChord } = resolveKeymap({});
    for (const [action, chord] of table) {
      expect(byChord.get(chordKey(chord))).toBe(action);
    }
  });
});
