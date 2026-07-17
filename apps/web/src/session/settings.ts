import type { SessionStorageLike, StorageFailure } from './storage.js';
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

/** Keys `routeKey` (`KeyRouter.ts`) resolves as hardwired arrow/numpad movement synonyms *before*
 * ever consulting the keymap -- binding one of these to an `ActionId` here would produce a chord
 * that saves and displays fine but silently never fires. Duplicated from `KeyRouter.ts`'s
 * `HARDWIRED_DIRECTION_KEYS` (rather than imported) because `settings.ts` is the lower-level,
 * framework-free module `KeyRouter.ts` itself depends on; keep the two key lists in sync. */
const HARDWIRED_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  '1', '2', '3', '4', '6', '7', '8', '9',
]);

/** True if `chordCandidate`'s key is one of the hardwired arrow/numpad synonyms above -- binding
 * it to any action is always refused, at capture time (`SettingsOverlay`) and at both `loadSettings`
 * and `saveSettings`'s write-time guard. Shift is irrelevant: `routeKey` matches these by `event.key`
 * alone, regardless of the shift flag. */
export function chordReserved(chordCandidate: KeyChord): boolean {
  return HARDWIRED_KEYS.has(chordCandidate.key);
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
 * - Conflict-free, hardwired-free storage is enforced in two layers: `saveSettings` rejects a
 *   colliding or hardwired-key write outright (see its doc comment), so anything written through
 *   this module's own API is already clean by construction. This function's per-override
 *   `bindingConflict`/`chordReserved` checks are the second layer, guarding a hand-edited or
 *   foreign-version blob that reached storage some other way. Entries are accepted in `ACTION_IDS`
 *   order, so of two stored overrides that collide with *each other* the earlier one (by that
 *   order) wins and the later one is dropped; a conflict with another action's default chord, or a
 *   chord onto a hardwired arrow/numpad key (`chordReserved`), drops the override outright. Either
 *   way the loser is reported in `droppedOverrides`, and this does not mark the load as corrupted.
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

    if (chordReserved(candidate)) {
      droppedOverrides.push(actionId);
      continue;
    }
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
    if (chordReserved(candidate)) return true;
    if (bindingConflict(bindings, actionId, candidate) !== null) return true;
  }
  return false;
}

/**
 * `saveSettings`'s result: `{ ok: true }` on a clean write. On failure, `reason` distinguishes
 * *why* -- present (a `StorageFailure`) when `storage.set` itself threw (quota/unavailable, per the
 * 5A pattern), absent when the write never happened because `settings.bindings` was conflict-free
 * -- letting a caller word a specific notice for the storage case while treating the conflict case
 * (which the settings UI itself pre-checks with `bindingConflict`, so a caller should never see the
 * `saveSettings` guard actually fire) as the silent backstop it's meant to be.
 *
 * (Widened forward from Task 1's literal `{ ok: boolean }` brief shape -- flagged there as a gap
 * for whichever task first needed to distinguish the failure reason; Task 3's settings-overlay
 * write-failure notice is that caller.)
 */
export type SaveSettingsResult = Readonly<{ ok: true }> | Readonly<{ ok: false; reason?: StorageFailure }>;

/**
 * Persists `settings` to `storage` as JSON -- but only if `settings.bindings` is conflict-free and
 * hardwired-free. This is the first line of defense promised by `loadSettings`'s doc comment: every
 * override is checked with `bindingConflict` against the resolved map of the other overrides plus
 * defaults, and with `chordReserved` against the hardwired arrow/numpad keys, and if either check
 * fails, nothing is written and `{ ok: false }` (no `reason`) is returned.
 *
 * Beyond that, `storage.set` can throw (quota exceeded, storage disabled/unavailable); that
 * failure is classified via `classifyStorageFailure` and returned as `{ ok: false, reason }` rather
 * than letting the error propagate.
 */
export function saveSettings(storage: SessionStorageLike, settings: Settings): SaveSettingsResult {
  if (hasBindingConflict(settings.bindings)) {
    return { ok: false };
  }
  try {
    storage.set(SETTINGS_KEY, JSON.stringify(settings));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: classifyStorageFailure(error) };
  }
}
