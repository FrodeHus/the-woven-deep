import { useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ACTION_IDS, bindingConflict, chordKey, chordReserved,
  type ActionId, type KeyChord, type ResolvedKeymap, type Settings,
} from '../../session/settings.js';

export interface SettingsOverlayProps {
  readonly settings: Settings;
  readonly onChange: (next: Settings) => void;
  readonly onClearGuestSession: () => void;
  /** The resolved keymap (defaults merged with `settings.bindings`) -- the source of truth for
   * each row's *currently effective* chord, since an unbound action still has a default one. */
  readonly keymap: ResolvedKeymap;
}

const FONT_SCALE_STEPS: readonly Settings['fontScale'][] = [1, 1.15, 1.3, 1.5];

/** Human-readable label per `ActionId`, used for row text and for naming the action that already
 * holds a chord in the conflict-refusal message -- never a raw `ActionId`/key literal in copy. */
const ACTION_LABELS: Readonly<Record<ActionId, string>> = {
  'move.n': 'Move north', 'move.ne': 'Move northeast', 'move.e': 'Move east',
  'move.se': 'Move southeast', 'move.s': 'Move south', 'move.sw': 'Move southwest',
  'move.w': 'Move west', 'move.nw': 'Move northwest',
  wait: 'Wait', rest: 'Rest', pickup: 'Pick up', descend: 'Descend', ascend: 'Ascend',
  inventory: 'Inventory', house: 'House/Town', trade: 'Trade',
  'character-sheet': 'Character sheet', 'map-journal': 'Map & journal', codex: 'Codex',
  settings: 'Settings', help: 'Help',
};

/** The exact word "clear guest session" requires, typed into the confirmation field before the
 * wipe button enables -- compared case-insensitively (still "the exact word", not a substring or
 * fuzzy match) so a guest's incidental capitalization doesn't block the one destructive action on
 * this screen. */
const CLEAR_CONFIRM_WORD = 'clear';

/** The Escape key itself is stripped by `handleCaptureKeyDown` before this ever needs to
 * distinguish it; these are the modifier keys that produce a nonsensical bare chord (e.g.
 * `{key:'Shift', shift:true}`) if committed on their own -- pressing one of these leaves capture
 * armed rather than committing or refusing anything (Finding 2). */
const MODIFIER_ONLY_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta']);

type CaptureRefusal =
  | { readonly reason: 'conflict'; readonly action: ActionId; readonly holder: ActionId }
  | { readonly reason: 'hardwired'; readonly action: ActionId };

/**
 * The settings overlay body: font scale (live preview), reduced motion (the three-way contract:
 * "system" defers to the OS, "on" forces animations off, "off" forces them back on regardless of
 * the OS setting -- see `App.tsx`'s `withRootStyling` doc comment for the CSS side of this), full
 * per-action key rebinding (press-to-rebind, conflict refusal, per-row/global reset), and
 * clear-guest-session. Fully controlled: `settings`/`keymap` are owned by the caller (`App`), and
 * every change is reported via `onChange` rather than held in local state -- the only local state
 * here is transient UI-only (which row is armed for capture, the pending conflict notice, and the
 * clear-confirmation text).
 */
export function SettingsOverlay({ settings, onChange, onClearGuestSession, keymap }: SettingsOverlayProps): JSX.Element {
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [conflict, setConflict] = useState<CaptureRefusal | null>(null);
  const [clearText, setClearText] = useState('');

  function armCapture(action: ActionId): void {
    setConflict(null);
    setCapturing(action);
  }

  function cancelCapture(): void {
    setCapturing(null);
  }

  /** The next keydown after a row's capture is armed becomes its chord -- reported via `onChange`
   * if it's conflict-free, refused (naming the holding action) otherwise. `stopPropagation` keeps
   * this keystroke from ever reaching the window-level key dispatcher (`PlayScreen`'s
   * `createKeyDispatcher`) while a run is live behind the overlay -- it would otherwise also try to
   * route this same keydown as a game command once the overlay's own Escape-close handling saw it
   * wasn't Escape. Escape itself cancels the capture rather than committing "Escape" as a chord (it
   * stays hardwired/non-rebindable per `KeyRouter.ts`, so binding it here would be a dead chord).
   *
   * A bare modifier keydown (Shift/Control/Alt/Meta, with no other key held) is ignored outright --
   * capture stays armed, nothing is committed or refused (Finding 2) -- since `event.key` for those
   * is just the modifier's own name and would otherwise commit a nonsensical chord.
   *
   * A candidate matching a hardwired arrow/numpad key (`chordReserved`, `settings.ts`) is refused
   * the same way a conflict is: `routeKey` (`KeyRouter.ts`) resolves those keys as movement
   * *before* ever consulting the keymap, so binding one here would save and display fine while
   * silently never firing (Finding 1). */
  function handleCaptureKeyDown(action: ActionId, event: ReactKeyboardEvent<HTMLElement>): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      cancelCapture();
      return;
    }
    if (MODIFIER_ONLY_KEYS.has(event.key)) {
      return;
    }
    const candidate: KeyChord = { key: event.key, shift: event.shiftKey };
    if (chordReserved(candidate)) {
      setConflict({ reason: 'hardwired', action });
      setCapturing(null);
      return;
    }
    const holder = bindingConflict(settings.bindings, action, candidate);
    if (holder !== null) {
      setConflict({ reason: 'conflict', action, holder });
      setCapturing(null);
      return;
    }
    setConflict(null);
    setCapturing(null);
    onChange({ ...settings, bindings: { ...settings.bindings, [action]: candidate } });
  }

  function resetRow(action: ActionId): void {
    const nextBindings = { ...settings.bindings };
    delete nextBindings[action];
    onChange({ ...settings, bindings: nextBindings });
  }

  function resetAll(): void {
    onChange({ ...settings, bindings: {} });
  }

  const clearReady = clearText.trim().toLowerCase() === CLEAR_CONFIRM_WORD;

  return (
    <div className="settings-overlay">
      <section aria-labelledby="settings-font-scale-heading">
        <h3 id="settings-font-scale-heading">Font scale</h3>
        <div role="radiogroup" aria-label="Font scale">
          {FONT_SCALE_STEPS.map((scale) => (
            <label key={scale}>
              <input
                type="radio"
                name="settings-font-scale"
                checked={settings.fontScale === scale}
                onChange={() => onChange({ ...settings, fontScale: scale })}
              />
              {Math.round(scale * 100)}%
            </label>
          ))}
        </div>
        <p className="settings-font-preview" style={{ fontSize: `calc(1rem * ${settings.fontScale})` }}>
          The Woven Deep awaits.
        </p>
      </section>

      <section aria-labelledby="settings-motion-heading">
        <h3 id="settings-motion-heading">Reduce motion</h3>
        <div role="radiogroup" aria-label="Reduce motion">
          <label>
            <input
              type="radio"
              name="settings-reduced-motion"
              checked={settings.reducedMotion === 'system'}
              onChange={() => onChange({ ...settings, reducedMotion: 'system' })}
            />
            System (follow this device&apos;s own reduced-motion preference)
          </label>
          <label>
            <input
              type="radio"
              name="settings-reduced-motion"
              checked={settings.reducedMotion === 'on'}
              onChange={() => onChange({ ...settings, reducedMotion: 'on' })}
            />
            Always (turn off glow/flash animations)
          </label>
          <label>
            <input
              type="radio"
              name="settings-reduced-motion"
              checked={settings.reducedMotion === 'off'}
              onChange={() => onChange({ ...settings, reducedMotion: 'off' })}
            />
            Never (keep animations on, even if the device asks for reduced motion)
          </label>
        </div>
      </section>

      <section aria-labelledby="settings-bindings-heading">
        <h3 id="settings-bindings-heading">Key bindings</h3>
        {conflict && conflict.reason === 'conflict' && (
          <p role="alert">
            {ACTION_LABELS[conflict.action]} could not be rebound to that key --{' '}
            {ACTION_LABELS[conflict.holder]} already uses it.
          </p>
        )}
        {conflict && conflict.reason === 'hardwired' && (
          <p role="alert">
            {ACTION_LABELS[conflict.action]} could not be rebound to that key -- arrow and numpad
            keys always move, pick another key.
          </p>
        )}
        <ul className="settings-bindings-list">
          {ACTION_IDS.map((action) => {
            const chord = keymap.byAction[action];
            const isCapturing = capturing === action;
            return (
              <li key={action}>
                <span className="settings-binding-label">{ACTION_LABELS[action]}</span>
                <span className="settings-binding-chord">{chordKey(chord)}</span>
                {isCapturing ? (
                  <input
                    aria-label={`Press a key to rebind ${ACTION_LABELS[action]}`}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- capture must move focus to
                    // this field the instant it appears so the very next keydown lands here.
                    autoFocus
                    readOnly
                    value="Press a key…"
                    onKeyDown={(event) => handleCaptureKeyDown(action, event)}
                    onBlur={cancelCapture}
                  />
                ) : (
                  <button type="button" onClick={() => armCapture(action)}>
                    Rebind
                  </button>
                )}
                <button type="button" onClick={() => resetRow(action)}>
                  Reset
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={resetAll}>
          Reset all bindings
        </button>
      </section>

      <section aria-labelledby="settings-clear-heading">
        <h3 id="settings-clear-heading">Clear guest session</h3>
        <p>
          Wipes your active run, Hall of Records, and settings on this device, then returns to the
          title screen. This cannot be undone.
        </p>
        <label htmlFor="settings-clear-confirm">Type &quot;clear&quot; to confirm</label>
        <input
          id="settings-clear-confirm"
          value={clearText}
          onChange={(event) => setClearText(event.target.value)}
        />
        <button type="button" disabled={!clearReady} onClick={onClearGuestSession}>
          Clear guest session
        </button>
      </section>
    </div>
  );
}
