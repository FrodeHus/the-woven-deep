import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { GameplayProjection } from '@woven-deep/engine';
import { createNewRun, DEFAULT_GUEST_HERO, projectGameplayState } from '@woven-deep/engine';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import {
  activeHint, dismissHint, HINTS, loadOnboarding, ONBOARDING_KEY, recordIntent, saveOnboarding,
  type OnboardingState,
} from '../src/session/onboarding.js';
import { DEFAULT_SETTINGS, resolveKeymap } from '../src/session/settings.js';
import type { SessionStorageLike } from '../src/session/storage.js';

let pack: CompiledContentPack;
let townProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;
const EMPTY: OnboardingState = { counts: {}, dismissed: [] };
const KEYMAP = resolveKeymap(DEFAULT_SETTINGS.bindings);

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  townProjection = projectGameplayState({ state: run, content: pack });
});

function fakeStorage(): SessionStorageLike {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
    remove: (key: string) => { values.delete(key); },
  };
}

function heroPosition(projection: GameplayProjection): Readonly<{ x: number; y: number }> {
  const hero = projection.hero as unknown as { x: number; y: number };
  return { x: hero.x, y: hero.y };
}

function withHeroAt(projection: GameplayProjection, x: number, y: number): GameplayProjection {
  return { ...projection, hero: { ...projection.hero, x, y } };
}

function withMerchantAdjacent(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    actors: [
      ...projection.actors,
      { actorId: 'actor.merchant', contentId: null, x: x + 1, y, disposition: 'neutral', factionName: 'Lampwrights', health: 10, maxHealth: 10 },
    ],
  };
}

function withStairDownUnderHero(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    floor: {
      ...projection.floor,
      cells: projection.floor.cells.map((cell) => (cell.x === x && cell.y === y ? { ...cell, tileId: 5 as const } : cell)),
    },
  };
}

const snapshot = {} as SessionSnapshot; // onboarding.ts's own trigger functions never read snapshot.

describe('recordIntent', () => {
  it('starts every intentType at 0 and increments on each fold', () => {
    let state = EMPTY;
    expect(state.counts.move ?? 0).toBe(0);
    state = recordIntent(state, 'move');
    expect(state.counts.move).toBe(1);
    state = recordIntent(state, 'move');
    expect(state.counts.move).toBe(2);
  });

  it('tracks distinct intentTypes independently and never mutates the input', () => {
    const before = recordIntent(EMPTY, 'move');
    const after = recordIntent(before, 'descend');
    expect(before.counts.descend).toBeUndefined();
    expect(after.counts).toEqual({ move: 1, descend: 1 });
  });
});

describe('dismissHint', () => {
  it('adds a hint id to dismissed, idempotently', () => {
    const once = dismissHint(EMPTY, 'movement');
    expect(once.dismissed).toEqual(['movement']);
    const twice = dismissHint(once, 'movement');
    expect(twice.dismissed).toEqual(['movement']);
    expect(twice).toEqual(once);
  });
});

describe('loadOnboarding / saveOnboarding round-trip', () => {
  it('returns the empty state when nothing is stored', () => {
    expect(loadOnboarding(fakeStorage())).toEqual(EMPTY);
  });

  it('round-trips a saved OnboardingState', () => {
    const storage = fakeStorage();
    const state: OnboardingState = { counts: { move: 4 }, dismissed: ['movement'] };
    saveOnboarding(storage, state);
    expect(loadOnboarding(storage)).toEqual(state);
    expect(storage.get(ONBOARDING_KEY)).not.toBeNull();
  });

  it('treats a corrupted (non-JSON) blob as the empty state', () => {
    const storage = fakeStorage();
    storage.set(ONBOARDING_KEY, 'not json{{{');
    expect(loadOnboarding(storage)).toEqual(EMPTY);
  });

  it('treats a shape-invalid blob (wrong field types) as the empty state', () => {
    const storage = fakeStorage();
    storage.set(ONBOARDING_KEY, JSON.stringify({ counts: { move: 'four' }, dismissed: [] }));
    expect(loadOnboarding(storage)).toEqual(EMPTY);
  });
});

describe('HINTS', () => {
  it('is ordered movement -> inspection -> inventory -> light -> commerce -> dungeon-entry by priority', () => {
    const ids = [...HINTS].sort((left, right) => left.priority - right.priority).map((hint) => hint.id);
    expect(ids).toEqual(['movement', 'inspection', 'inventory', 'light', 'commerce', 'dungeon-entry']);
  });

  it('every copy interpolates a live chord from the resolved keymap (rebind test)', () => {
    const rebound = resolveKeymap({ 'character-sheet': { key: 'p', shift: false } });
    const inspection = HINTS.find((hint) => hint.id === 'inspection')!;
    expect(inspection.copy(KEYMAP)).toContain('c');
    expect(inspection.copy(rebound)).toContain('p');
    expect(inspection.copy(rebound)).not.toBe(inspection.copy(KEYMAP));
  });
});

describe('activeHint', () => {
  it('returns null when disabled, regardless of trigger/mastery', () => {
    expect(activeHint(EMPTY, HINTS, townProjection, snapshot, false)).toBeNull();
  });

  it('offers "movement" first, in town, unmastered', () => {
    const hint = activeHint(EMPTY, HINTS, townProjection, snapshot, true);
    expect(hint?.id).toBe('movement');
  });

  it('mastery: "movement" retires once its intentType count reaches 10, uncovering "inspection" next', () => {
    let state = EMPTY;
    for (let i = 0; i < 9; i += 1) state = recordIntent(state, 'move');
    expect(activeHint(state, HINTS, townProjection, snapshot, true)?.id).toBe('movement');
    state = recordIntent(state, 'move');
    expect(activeHint(state, HINTS, townProjection, snapshot, true)?.id).toBe('inspection');
  });

  it('dismiss retires a hint even if its mastery count is still unmet', () => {
    const dismissed = dismissHint(EMPTY, 'movement');
    expect(activeHint(dismissed, HINTS, townProjection, snapshot, true)?.id).toBe('inspection');
  });

  it('"commerce" only triggers when the hero is adjacent to a merchant', () => {
    const mastered = { counts: { move: 10, 'open-character-sheet': 1, 'open-inventory': 1, 'toggle-light': 1 }, dismissed: [] };
    expect(activeHint(mastered, HINTS, townProjection, snapshot, true)?.id).not.toBe('commerce');
    const withMerchant = withMerchantAdjacent(townProjection);
    expect(activeHint(mastered, HINTS, withMerchant, snapshot, true)?.id).toBe('commerce');
  });

  it('"dungeon-entry" only triggers when the hero is on/near a stairs-down cell', () => {
    const mastered = {
      counts: { move: 10, 'open-character-sheet': 1, 'open-inventory': 1, 'toggle-light': 1, 'trade-complete': 1 },
      dismissed: [],
    };
    // The town floor's own authored stairs down might already be near the hero's default spawn --
    // move the hero to a corner far from any real stairs-down cell first, so the "far away, no
    // hint" half of this test is actually exercised, then place one at the hero's own position.
    const stairDownCells = townProjection.floor.cells.filter((cell) => cell.tileId === 5);
    const farCorner = { x: 0, y: 0 };
    const farEnoughFromStairs = stairDownCells.every(
      (cell) => Math.max(Math.abs(cell.x - farCorner.x), Math.abs(cell.y - farCorner.y)) > 1,
    );
    expect(farEnoughFromStairs).toBe(true);
    const heroFar = withHeroAt(townProjection, farCorner.x, farCorner.y);
    expect(activeHint(mastered, HINTS, heroFar, snapshot, true)).toBeNull();

    const withStairs = withStairDownUnderHero(heroFar);
    expect(activeHint(mastered, HINTS, withStairs, snapshot, true)?.id).toBe('dungeon-entry');
  });

  it('returns null once every hint is mastered or dismissed', () => {
    const allMastered: OnboardingState = {
      counts: {
        move: 10, 'open-character-sheet': 1, 'open-inventory': 1, 'toggle-light': 1,
        'trade-complete': 1, descend: 1,
      },
      dismissed: [],
    };
    expect(activeHint(allMastered, HINTS, townProjection, snapshot, true)).toBeNull();
  });
});
