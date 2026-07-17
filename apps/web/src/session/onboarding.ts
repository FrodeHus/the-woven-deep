import type { GameplayProjection } from '@woven-deep/engine';
import type { ResolvedKeymap } from './settings.js';
import { chordKey } from './settings.js';
import type { SessionSnapshot } from './guest-session.js';
import type { SessionStorageLike } from './storage.js';

/** Where the guest's onboarding-hint mastery lives -- `localStorage`, device-persistent per the
 * design spec (unlike the sighting cache and run save, both session-scoped): a guest who has
 * already learned to move should never see that hint again just because a tab/session ended. */
export const ONBOARDING_KEY = 'woven-deep.onboarding.v1';

/** A single contextual hint the play screen can surface. `trigger` decides whether the hint's
 * precondition currently holds (e.g. "adjacent to a merchant"); `mastery` decides whether the
 * guest has already demonstrated the thing the hint teaches, via a count of some `recordIntent`
 * `intentType` reaching `count`. `priority` orders the fixed hint sequence -- lower numbers are
 * offered first; a lower-priority hint is only ever shown once every higher-priority TRIGGERED,
 * UNMASTERED hint has been mastered or dismissed (see `activeHint`). */
export interface HintDefinition {
  readonly id: string;
  readonly copy: (keymap: ResolvedKeymap) => string;
  readonly trigger: (projection: GameplayProjection, snapshot: SessionSnapshot) => boolean;
  readonly mastery: Readonly<{ kind: 'intent-count'; intentType: string; count: number }>;
  readonly priority: number;
}

/** Pure, persisted (via `saveOnboarding`) mastery ledger: how many times each `recordIntent`
 * `intentType` has been folded in, and which hint ids the guest has explicitly dismissed. */
export interface OnboardingState {
  readonly counts: Readonly<Record<string, number>>;
  readonly dismissed: readonly string[];
}

const EMPTY_ONBOARDING: OnboardingState = { counts: {}, dismissed: [] };

interface ProjectedHeroPosition {
  readonly x: number;
  readonly y: number;
}

interface ProjectedActorPosition {
  readonly x: number;
  readonly y: number;
  readonly factionName?: string;
}

function heroPosition(projection: GameplayProjection): ProjectedHeroPosition {
  return projection.hero as unknown as ProjectedHeroPosition;
}

function chebyshevDistance(a: ProjectedHeroPosition, b: ProjectedHeroPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** True when the hero is standing on, or Chebyshev-adjacent to, a merchant actor -- mirrors
 * `command-builder.ts`'s `heroAdjacentMerchant` adjacency rule (that helper isn't exported, so
 * this is a narrow, independent read of the same projected surface). */
function heroNearMerchant(projection: GameplayProjection): boolean {
  const hero = heroPosition(projection);
  const actors = projection.actors as unknown as readonly ProjectedActorPosition[];
  return actors.some((actor) => typeof actor.factionName === 'string' && chebyshevDistance(hero, actor) <= 1);
}

/** True when the hero is standing on, or Chebyshev-adjacent to, a stairs-down cell (`tileId` 5,
 * `TILE_DEFINITIONS` in `packages/engine/src/terrain.ts`) -- "on/near the entrance" for the
 * dungeon-entry hint. */
function heroNearStairsDown(projection: GameplayProjection): boolean {
  const hero = heroPosition(projection);
  return projection.floor.cells.some((cell) => cell.tileId === 5 && chebyshevDistance(hero, cell) <= 1);
}

function moveChord(keymap: ResolvedKeymap, action: 'move.n' | 'move.s' | 'move.e' | 'move.w'): string {
  return chordKey(keymap.byAction[action]);
}

/**
 * The fixed hint sequence, in the spec's own order: movement -> inspection -> inventory -> light
 * -> commerce -> dungeon entry. Every `copy` interpolates real chords from the resolved keymap --
 * never a key literal -- so a rebind is reflected immediately, exactly like the help/settings
 * overlays. `intentType` strings are this module's own synthetic vocabulary (not raw
 * `PlayerIntent['type']`s): `GuestSession` decides, per applied dispatch/UI event, which of these
 * to fold via `recordIntent` (see its doc comment for the exact mapping).
 */
export const HINTS: readonly HintDefinition[] = [
  {
    id: 'movement',
    priority: 0,
    mastery: { kind: 'intent-count', intentType: 'move', count: 10 },
    trigger: (projection) => projection.floor.town,
    copy: (keymap) => (
      `The dark waits on your step. Move with ${moveChord(keymap, 'move.n')} ${moveChord(keymap, 'move.s')} `
      + `${moveChord(keymap, 'move.e')} ${moveChord(keymap, 'move.w')} -- arrows and numpad answer too.`
    ),
  },
  {
    id: 'inspection',
    priority: 1,
    mastery: { kind: 'intent-count', intentType: 'open-character-sheet', count: 1 },
    trigger: () => true,
    copy: (keymap) => `Press ${chordKey(keymap.byAction['character-sheet'])} to read your own measure.`,
  },
  {
    id: 'inventory',
    priority: 2,
    mastery: { kind: 'intent-count', intentType: 'open-inventory', count: 1 },
    trigger: () => true,
    copy: (keymap) => `Press ${chordKey(keymap.byAction.inventory)} to see what you carry.`,
  },
  {
    id: 'light',
    priority: 3,
    mastery: { kind: 'intent-count', intentType: 'toggle-light', count: 1 },
    trigger: () => true,
    copy: (keymap) => `Open your pack with ${chordKey(keymap.byAction.inventory)} and tend your light before the dark closes in.`,
  },
  {
    id: 'commerce',
    priority: 4,
    mastery: { kind: 'intent-count', intentType: 'trade-complete', count: 1 },
    trigger: (projection) => heroNearMerchant(projection),
    copy: (keymap) => `Press ${chordKey(keymap.byAction.trade)} to trade with the one beside you.`,
  },
  {
    id: 'dungeon-entry',
    priority: 5,
    mastery: { kind: 'intent-count', intentType: 'descend', count: 1 },
    trigger: (projection) => heroNearStairsDown(projection),
    copy: (keymap) => `Press ${chordKey(keymap.byAction.descend)} to go down.`,
  },
];

function isCountRecord(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'number');
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isOnboardingState(value: unknown): value is OnboardingState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return isCountRecord(candidate.counts) && isStringArray(candidate.dismissed);
}

/**
 * Loads the mastery ledger from `storage`, tolerating a missing or corrupted blob: a fresh
 * (empty) state either way, mirroring `loadSettings`/`loadSightings`'s own forgiving contract for
 * every other piece of cross-reload state.
 */
export function loadOnboarding(storage: SessionStorageLike): OnboardingState {
  const raw = storage.get(ONBOARDING_KEY);
  if (raw === null) return EMPTY_ONBOARDING;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_ONBOARDING;
  }
  if (!isOnboardingState(parsed)) return EMPTY_ONBOARDING;
  return parsed;
}

/** Persists the mastery ledger. Throws exactly like `SessionStorageLike.set` itself -- callers
 * (here, `GuestSession`) classify/surface that failure the same best-effort way every other
 * cosmetic/secondary write in this session layer does. */
export function saveOnboarding(storage: SessionStorageLike, state: OnboardingState): void {
  storage.set(ONBOARDING_KEY, JSON.stringify(state));
}

/** Pure fold: one more occurrence of `intentType`. Never removes/resets a count -- mastery is
 * monotone, exactly like the unlock codex's sighting cache. */
export function recordIntent(state: OnboardingState, intentType: string): OnboardingState {
  const current = state.counts[intentType] ?? 0;
  return { ...state, counts: { ...state.counts, [intentType]: current + 1 } };
}

/** Pure fold: retires `hintId` for good (the guest dismissed it via the strip's dedicated key) --
 * idempotent, so dismissing an already-dismissed hint is a no-op or, at least, changes nothing. */
export function dismissHint(state: OnboardingState, hintId: string): OnboardingState {
  if (state.dismissed.includes(hintId)) return state;
  return { ...state, dismissed: [...state.dismissed, hintId] };
}

/**
 * The single hint the play screen should show right now, or `null` -- either because onboarding
 * is disabled (`enabled === false`, e.g. quickstart or the settings/wizard toggle turned off), or
 * because no hint in `hints` is both triggered and neither mastered nor dismissed. Hints are
 * considered in ascending `priority` order and the first qualifying one wins: this is what makes
 * "inspection/inventory/light only after movement is mastered" fall out of the fixed priority
 * list alone, with no separate cross-hint gating logic -- as long as `movement` is triggered and
 * unmastered it always outranks every later hint, regardless of whether they are ALSO triggered.
 */
export function activeHint(
  state: OnboardingState,
  hints: readonly HintDefinition[],
  projection: GameplayProjection,
  snapshot: SessionSnapshot,
  enabled: boolean,
): HintDefinition | null {
  if (!enabled) return null;
  const ordered = [...hints].sort((left, right) => left.priority - right.priority);
  for (const hint of ordered) {
    if (state.dismissed.includes(hint.id)) continue;
    const masteredCount = state.counts[hint.mastery.intentType] ?? 0;
    if (masteredCount >= hint.mastery.count) continue;
    if (!hint.trigger(projection, snapshot)) continue;
    return hint;
  }
  return null;
}
