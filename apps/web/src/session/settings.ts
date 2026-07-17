import type { SessionStorageLike } from './storage.js';
import { classifyStorageFailure } from './storage.js';

/**
 * Every player command the rebindable keymap can route to. Movement synonyms (arrows, numpad)
 * stay hardwired in `KeyRouter.ts` and are never represented here -- only the *primary* movement
 * keys (vi keys, by default) are rebindable, alongside the non-movement commands and the five
 * overlay-open actions. `inventory` keeps routing to the legacy `open-backpack` outcome for now
 * (a later task rewires it onto the overlay registry); it is still a rebindable `ActionId` so its
 * key can be changed from the settings screen.
 */
export type ActionId =
  | `move.${'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'}`
  | 'wait' | 'rest' | 'pickup' | 'descend' | 'ascend'
  | 'inventory' | 'house' | 'trade'
  | 'character-sheet' | 'map-journal' | 'codex' | 'settings' | 'help';

/** A single rebindable keystroke: `event.key` plus whether Shift must be held. Serializes to
 * "Shift+T" / "i" (see `chordKey`) for both storage-comparison and on-screen display. */
export type KeyChord = Readonly<{ key: string; shift: boolean }>;

export interface Settings {
  readonly fontScale: 1 | 1.15 | 1.3 | 1.5;
  readonly reducedMotion: 'system' | 'on' | 'off';
  /** Overrides only -- any `ActionId` absent here uses its `DEFAULT_BINDINGS` chord. */
  readonly bindings: Readonly<Partial<Record<ActionId, KeyChord>>>;
}

export const SETTINGS_KEY = 'woven-deep.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  fontScale: 1,
  reducedMotion: 'system',
  bindings: {},
};

const MOVE_SUFFIXES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

/** Every `ActionId`, in a fixed order -- used to iterate the (closed) union at runtime. */
export const ACTION_IDS: readonly ActionId[] = [
  ...MOVE_SUFFIXES.map((suffix) => `move.${suffix}` as ActionId),
  'wait', 'rest', 'pickup', 'descend', 'ascend',
  'inventory', 'house', 'trade',
  'character-sheet', 'map-journal', 'codex', 'settings', 'help',
];

function chord(key: string, shift = false): KeyChord {
  return { key, shift };
}

/**
 * The shipped keymap. Movement defaults are the vi keys (arrows/numpad are separate, hardwired
 * synonyms baked into `KeyRouter.ts` -- they are never represented here and can never be
 * rebound away from movement). Every other default matches the pre-existing `KEYMAP` in
 * `KeyRouter.ts` exactly, plus the five new overlay-open keys (`c`/`m`/`x`/`o`/`Shift+?`).
 */
export const DEFAULT_BINDINGS: Readonly<Record<ActionId, KeyChord>> = {
  'move.n': chord('k'),
  'move.ne': chord('u'),
  'move.e': chord('l'),
  'move.se': chord('n'),
  'move.s': chord('j'),
  'move.sw': chord('b'),
  'move.w': chord('h'),
  'move.nw': chord('y'),
  wait: chord('.'),
  rest: chord('R', true),
  pickup: chord('g'),
  descend: chord('>'),
  ascend: chord('<'),
  inventory: chord('i'),
  house: chord('H', true),
  trade: chord('T', true),
  'character-sheet': chord('c'),
  'map-journal': chord('m'),
  codex: chord('x'),
  settings: chord('o'),
  help: chord('?', true),
};

/** Serializes a `KeyChord` to its display/comparison string: "Shift+T" or "i". */
export function chordKey(value: KeyChord): string {
  return value.shift ? `Shift+${value.key}` : value.key;
}

/**
 * Merges `overrides` over `DEFAULT_BINDINGS` and derives both directions of lookup a router
 * needs: `byChord` (what does this keystroke do) and `byAction` (what keystroke does this command
 * use, for the settings screen and conflict checks).
 */
export function resolveKeymap(
  overrides: Settings['bindings'],
): Readonly<{ byChord: ReadonlyMap<string, ActionId>; byAction: Readonly<Record<ActionId, KeyChord>> }> {
  const byAction = { ...DEFAULT_BINDINGS, ...overrides } as Record<ActionId, KeyChord>;
  const byChord = new Map<string, ActionId>();
  for (const actionId of ACTION_IDS) {
    byChord.set(chordKey(byAction[actionId]), actionId);
  }
  return { byChord, byAction };
}

export type ResolvedKeymap = ReturnType<typeof resolveKeymap>;

/**
 * Would binding `chord` to `action` collide with some *other* action's current effective chord
 * (defaults merged with `overrides`)? Returns the colliding action, or `null` if there is none
 * (including when the only match is `action` itself).
 */
export function bindingConflict(
  overrides: Settings['bindings'],
  action: ActionId,
  chordCandidate: KeyChord,
): ActionId | null {
  const { byAction } = resolveKeymap(overrides);
  const key = chordKey(chordCandidate);
  for (const otherAction of ACTION_IDS) {
    if (otherAction === action) continue;
    if (chordKey(byAction[otherAction]) === key) return otherAction;
  }
  return null;
}

const FONT_SCALES: readonly Settings['fontScale'][] = [1, 1.15, 1.3, 1.5];
const REDUCED_MOTION_VALUES: readonly Settings['reducedMotion'][] = ['system', 'on', 'off'];

function isValidChord(value: unknown): value is KeyChord {
  return typeof value === 'object' && value !== null
    && typeof (value as { key?: unknown }).key === 'string'
    && typeof (value as { shift?: unknown }).shift === 'boolean';
}

/**
 * Loads `Settings` from `storage`, tolerating a corrupted or stale blob:
 * - No stored value, or a value that isn't valid JSON / isn't an object: `DEFAULT_SETTINGS`,
 *   `corrupted: true` only for the JSON-parse/shape failure (a plain missing key is not corrupt).
 * - Unknown top-level fields, and unknown/malformed `bindings` entries, are dropped silently
 *   (forward tolerance) -- they do not mark the load as corrupted.
 * - Conflict-free storage is enforced in two layers: `saveSettings` rejects a colliding write
 *   outright (see its doc comment), so anything written through this module's own API is already
 *   conflict-free by construction. This function's per-override `bindingConflict` check is the
 *   second layer, guarding a hand-edited or foreign-version blob that reached storage some other
 *   way. Entries are accepted in `ACTION_IDS` order, so of two stored overrides that collide with
 *   *each other* the earlier one (by that order) wins and the later one is dropped; a conflict
 *   with another action's default chord drops the override outright. Either way the loser is
 *   reported in `droppedOverrides`, and this does not mark the load as corrupted.
 */
export function loadSettings(
  storage: SessionStorageLike,
): Readonly<{ settings: Settings; corrupted: boolean; droppedOverrides: readonly ActionId[] }> {
  const raw = storage.get(SETTINGS_KEY);
  if (raw === null) {
    return { settings: DEFAULT_SETTINGS, corrupted: false, droppedOverrides: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { settings: DEFAULT_SETTINGS, corrupted: true, droppedOverrides: [] };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { settings: DEFAULT_SETTINGS, corrupted: true, droppedOverrides: [] };
  }

  const record = parsed as Record<string, unknown>;

  const fontScale = FONT_SCALES.includes(record.fontScale as Settings['fontScale'])
    ? (record.fontScale as Settings['fontScale'])
    : DEFAULT_SETTINGS.fontScale;
  const reducedMotion = REDUCED_MOTION_VALUES.includes(record.reducedMotion as Settings['reducedMotion'])
    ? (record.reducedMotion as Settings['reducedMotion'])
    : DEFAULT_SETTINGS.reducedMotion;

  const rawBindings = typeof record.bindings === 'object' && record.bindings !== null
    ? record.bindings as Record<string, unknown>
    : {};

  const accepted: Partial<Record<ActionId, KeyChord>> = {};
  const droppedOverrides: ActionId[] = [];

  for (const actionId of ACTION_IDS) {
    const candidate = rawBindings[actionId];
    if (candidate === undefined) continue; // no override stored for this action
    if (!isValidChord(candidate)) continue; // malformed entry: dropped silently, not "corrupted"

    const conflictWith = bindingConflict(accepted, actionId, candidate);
    if (conflictWith !== null) {
      droppedOverrides.push(actionId);
      continue;
    }
    accepted[actionId] = candidate;
  }

  const settings: Settings = { fontScale, reducedMotion, bindings: accepted };
  return { settings, corrupted: false, droppedOverrides };
}

/**
 * True if any override in `bindings` collides with another action's effective chord -- either
 * another override, or a default left un-overridden. Checked via the same `bindingConflict` used
 * for the settings screen's live conflict feedback, so write-time rejection and on-screen warnings
 * can never disagree about what counts as a conflict.
 */
function hasBindingConflict(bindings: Settings['bindings']): boolean {
  for (const actionId of Object.keys(bindings) as ActionId[]) {
    const candidate = bindings[actionId];
    if (candidate === undefined) continue;
    if (bindingConflict(bindings, actionId, candidate) !== null) return true;
  }
  return false;
}

/**
 * Persists `settings` to `storage` as JSON -- but only if `settings.bindings` is conflict-free.
 * This is the first line of defense promised by `loadSettings`'s doc comment: every override is
 * checked with `bindingConflict` against the resolved map of the other overrides plus defaults,
 * and if any collision exists, nothing is written and `{ ok: false }` is returned. (The brief for
 * this shape keeps `{ ok: boolean }` rather than a discriminated result carrying the conflicting
 * `ActionId`s -- surfacing *which* action(s) conflict is Task 3's settings-UI concern.)
 *
 * Beyond that, `storage.set` can throw (quota exceeded, storage disabled/unavailable); that
 * failure is classified via `classifyStorageFailure` so a future caller can surface a specific
 * notice, and `{ ok: false }` is returned rather than letting the error propagate.
 */
export function saveSettings(storage: SessionStorageLike, settings: Settings): Readonly<{ ok: boolean }> {
  if (hasBindingConflict(settings.bindings)) {
    return { ok: false };
  }
  try {
    storage.set(SETTINGS_KEY, JSON.stringify(settings));
    return { ok: true };
  } catch (error) {
    classifyStorageFailure(error);
    return { ok: false };
  }
}
