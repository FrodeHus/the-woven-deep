import type { SessionStorageLike, StorageFailure } from './storage.js';
import { classifyStorageFailure } from './storage.js';

/**
 * Every player command the rebindable keymap can route to. Movement synonyms (arrows, numpad)
 * stay hardwired in `KeyRouter.ts` and are never represented here -- only the *primary* movement
 * keys (vi keys, by default) are rebindable, alongside the non-movement commands and the six
 * overlay-open actions (`inventory` included -- it routes onto the overlay registry exactly like
 * the other five, see `KeyRouter.ts`).
 */
export type ActionId =
  | `move.${'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'}`
  | 'wait' | 'rest' | 'pickup' | 'descend' | 'ascend'
  | 'inventory' | 'house' | 'trade'
  | 'character-sheet' | 'map-journal' | 'codex' | 'settings' | 'help'
  // Retires the play screen's contextual onboarding hint strip (Task 8) -- rebindable and listed
  // in help/settings exactly like every other action, even though it isn't a game command.
  | 'dismiss-hint';

/** A single rebindable keystroke: `event.key` plus whether Shift must be held. Serializes to
 * "Shift+T" / "i" (see `chordKey`) for both storage-comparison and on-screen display. */
export type KeyChord = Readonly<{ key: string; shift: boolean }>;

export interface Settings {
  readonly fontScale: 1 | 1.15 | 1.3 | 1.5;
  readonly reducedMotion: 'system' | 'on' | 'off';
  /** Which named palette (`styles.css`'s `:root` vs. `.theme-high-contrast`) renders the world.
   * `'tapestry'` is the default dark-fantasy palette (the browser-tuned one); `'high-contrast'`
   * re-declares every palette variable for WCAG AA legibility, applied by `App` as the root class
   * `theme-high-contrast` -- see `styles.css`'s `.theme-high-contrast` block. */
  readonly theme: 'tapestry' | 'high-contrast';
  /** How the playfield renders light (Task 6). `'smooth'` mounts `LightCanvas` -- a per-cell
   * visibility-polygon gradient behind the glyph grid -- and flattens `.cell-visible`'s own
   * brightness contribution (the canvas now carries the falloff; see `.lighting-smooth` in
   * `styles.css`). `'classic'` renders no canvas at all and keeps the pre-Task-6 CSS-only
   * lighting exactly as it was. Defaults to `'smooth'`; forward-tolerant like every other field
   * here -- an unrecognized stored value falls back to the default rather than corrupting the
   * whole blob. Also the automatic fallback when a canvas 2D context is unavailable (jsdom, an
   * old browser): `LightCanvas` detects that itself and renders nothing, independent of this
   * setting's stored value. */
  readonly lighting: 'smooth' | 'classic';
  /** Whether the play screen's contextual onboarding hint strip (Task 8) may show at all --
   * `'on'` by default. `'off'` (settings toggle, the wizard's step-1 "Show guidance on your first
   * delve" checkbox unchecked, or a quickstart boot) suppresses every hint regardless of mastery
   * state; the mastery ledger itself (`onboarding.ts`'s `OnboardingState`) keeps accumulating
   * either way, since it lives in a separate localStorage key, not here. Forward-tolerant like
   * every other field on this type -- an unrecognized stored value falls back to `'on'`. */
  readonly onboarding: 'on' | 'off';
  /** Overrides only -- any `ActionId` absent here uses its `DEFAULT_BINDINGS` chord. */
  readonly bindings: Readonly<Partial<Record<ActionId, KeyChord>>>;
}

export const SETTINGS_KEY = 'woven-deep.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  fontScale: 1,
  reducedMotion: 'system',
  theme: 'tapestry',
  lighting: 'smooth',
  onboarding: 'on',
  bindings: {},
};

const MOVE_SUFFIXES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

/** Every `ActionId`, in a fixed order -- used to iterate the (closed) union at runtime. */
export const ACTION_IDS: readonly ActionId[] = [
  ...MOVE_SUFFIXES.map((suffix) => `move.${suffix}` as ActionId),
  'wait', 'rest', 'pickup', 'descend', 'ascend',
  'inventory', 'house', 'trade',
  'character-sheet', 'map-journal', 'codex', 'settings', 'help',
  'dismiss-hint',
];

function chord(key: string, shift = false): KeyChord {
  return { key, shift };
}

/** Human-readable label per `ActionId` -- the single source of truth for naming an action in copy
 * (settings rows, conflict-refusal messages, the help overlay's controls section) so no caller
 * needs a raw `ActionId`/key literal to describe what a row means. Originally defined inline in
 * `SettingsOverlay.tsx`; extracted here (Task 4) once the help overlay needed the same labels. */
export const ACTION_LABELS: Readonly<Record<ActionId, string>> = {
  'move.n': 'Move north', 'move.ne': 'Move northeast', 'move.e': 'Move east',
  'move.se': 'Move southeast', 'move.s': 'Move south', 'move.sw': 'Move southwest',
  'move.w': 'Move west', 'move.nw': 'Move northwest',
  wait: 'Wait', rest: 'Rest', pickup: 'Pick up', descend: 'Descend', ascend: 'Ascend',
  inventory: 'Inventory', house: 'House/Town', trade: 'Trade',
  'character-sheet': 'Character sheet', 'map-journal': 'Map & journal', codex: 'Codex',
  settings: 'Settings', help: 'Help', 'dismiss-hint': 'Dismiss hint',
};

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
  // Free (never hardwired, never used by any other default) -- see `chordReserved`.
  'dismiss-hint': chord("'"),
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
const THEME_VALUES: readonly Settings['theme'][] = ['tapestry', 'high-contrast'];
const LIGHTING_VALUES: readonly Settings['lighting'][] = ['smooth', 'classic'];
const ONBOARDING_VALUES: readonly Settings['onboarding'][] = ['on', 'off'];

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
/**
 * The shared body of `loadSettings`/`settingsFromJson`: parses a raw JSON string through the same
 * forward-tolerant validation (unknown fields dropped, invalid `bindings` entries dropped or
 * conflict-resolved, anything unparsable/non-object falls back to `DEFAULT_SETTINGS` with
 * `corrupted: true`). Extracted so a roamed server blob (Task 12) is validated through the exact
 * same rules a local storage read is -- a server value can never bypass the client's own shape
 * authority.
 */
function parseSettingsJson(
  raw: string,
): Readonly<{ settings: Settings; corrupted: boolean; droppedOverrides: readonly ActionId[] }> {
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
  const theme = THEME_VALUES.includes(record.theme as Settings['theme'])
    ? (record.theme as Settings['theme'])
    : DEFAULT_SETTINGS.theme;
  const lighting = LIGHTING_VALUES.includes(record.lighting as Settings['lighting'])
    ? (record.lighting as Settings['lighting'])
    : DEFAULT_SETTINGS.lighting;
  const onboarding = ONBOARDING_VALUES.includes(record.onboarding as Settings['onboarding'])
    ? (record.onboarding as Settings['onboarding'])
    : DEFAULT_SETTINGS.onboarding;

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

  const settings: Settings = { fontScale, reducedMotion, theme, lighting, onboarding, bindings: accepted };
  return { settings, corrupted: false, droppedOverrides };
}

/**
 * Loads `Settings` from `storage`, tolerating a corrupted or stale blob:
 * - No stored value: `DEFAULT_SETTINGS`, not corrupted (a plain missing key is not corrupt).
 * - Otherwise delegates to `parseSettingsJson` -- see its doc comment for the full validation
 *   contract (unparsable/non-object -> `corrupted: true` + defaults; unknown fields and invalid
 *   `bindings` entries dropped silently).
 */
export function loadSettings(
  storage: SessionStorageLike,
): Readonly<{ settings: Settings; corrupted: boolean; droppedOverrides: readonly ActionId[] }> {
  const raw = storage.get(SETTINGS_KEY);
  if (raw === null) {
    return { settings: DEFAULT_SETTINGS, corrupted: false, droppedOverrides: [] };
  }
  return parseSettingsJson(raw);
}

/**
 * Validates a raw JSON string (e.g. a roamed server settings blob, Task 12) through the exact same
 * forward-tolerant rules `loadSettings` applies to a storage read -- the server stores/validates
 * settings opaquely, so the client owns the shape end to end. A blob that fails to parse or isn't a
 * plain object falls back to `DEFAULT_SETTINGS` with `corrupted: true`, never a thrown error.
 */
export function settingsFromJson(
  json: string,
): Readonly<{ settings: Settings; corrupted: boolean; droppedOverrides: readonly ActionId[] }> {
  return parseSettingsJson(json);
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
