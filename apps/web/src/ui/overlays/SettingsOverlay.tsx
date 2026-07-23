import { useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { RunMetrics } from '@woven-deep/engine';
import {
  ACTION_IDS,
  ACTION_LABELS,
  bindingConflict,
  chordKey,
  chordReserved,
  type ActionId,
  type KeyChord,
} from '../../session/settings.js';
import type { AccountState } from '../../session/account.js';
import { useSettingsCtx } from '../providers.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Label } from '../components/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select.js';
import { Switch } from '../components/switch.js';

export interface SettingsOverlayProps {
  readonly onClearGuestSession: () => void;
  /** Signs the current profile out -- only ever provided for a signed-in `ProfileSession` run
   * (`App` omits it entirely for a guest), so the "Sign out" section below only renders then. This
   * is the one reachable way to sign out (and tear down the live `/ws/play` connection) once play
   * has started -- the title screen's own "Sign out" menu entry is unreachable from inside a run. */
  readonly onSignOut?: (() => void) | undefined;
  /** The current account, sourced from `GET /api/auth/session` (`App`'s `useAccount`) -- drives the
   * "Lifetime & Achievements" section below, which only renders for a signed-in profile (a guest's
   * lifetime/records stay in their existing session-only Hall UI, untouched by this section).
   * Optional so every pre-existing caller/test keeps compiling unchanged. */
  readonly account?: AccountState | undefined;
}

/** The small, fixed subset of `RunMetrics`' numeric fields this section shows -- excludes
 * `killsByModel` (an object, not a displayable scalar) and every other field, picked for being
 * meaningful at a glance rather than an exhaustive dump of every metric. */
type LifetimeMetricKey = Exclude<keyof RunMetrics, 'killsByModel'>;

const LIFETIME_METRIC_ROWS: readonly {
  readonly key: LifetimeMetricKey;
  readonly label: string;
}[] = [
  { key: 'kills', label: 'Kills' },
  { key: 'bossKills', label: 'Boss kills' },
  { key: 'championKills', label: 'Champion kills' },
  { key: 'deepestDepth', label: 'Deepest depth' },
  { key: 'floorsEntered', label: 'Floors entered' },
  { key: 'itemsCollected', label: 'Items collected' },
  { key: 'currencyEarned', label: 'Currency earned' },
  { key: 'turnsElapsed', label: 'Turns elapsed' },
];

const FONT_SCALE_STEPS: readonly (1 | 1.15 | 1.3 | 1.5)[] = [1, 1.15, 1.3, 1.5];

const THEME_LABELS: Readonly<Record<string, string>> = {
  tapestry: 'Tapestry (dark fantasy)',
  'high-contrast': 'High contrast',
};

const REDUCED_MOTION_LABELS: Readonly<Record<string, string>> = {
  system: "System (follow this device's own reduced-motion preference)",
  on: 'Always (turn off glow/flash animations)',
  off: 'Never (keep animations on, even if the device asks for reduced motion)',
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
 * The settings overlay body: font scale (live preview), theme, onboarding hints, reduced motion
 * (the three-way contract: "system" defers to the OS, "on" forces animations off, "off" forces
 * them back on regardless of the OS setting -- see `App.tsx`'s `withRootStyling` doc comment for
 * the CSS side of this), full per-action key rebinding (press-to-rebind, conflict refusal,
 * per-row/global reset), and clear-guest-session. `settings`/`onChange`/`keymap` arrive via
 * `useSettingsCtx()` (owned by `App`); `onClearGuestSession` is the one prop, threaded in by
 * `OverlayHost`. The only local state here is transient UI-only (which row is armed for capture,
 * the pending conflict notice, and the clear-confirmation text).
 */
export function SettingsOverlay({
  onClearGuestSession,
  onSignOut,
  account,
}: Readonly<SettingsOverlayProps>): JSX.Element {
  const { settings, onChange, keymap } = useSettingsCtx();
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
    <div className="flex flex-col gap-6">
      <section aria-labelledby="settings-font-scale-heading" className="flex flex-col gap-2">
        <h3 id="settings-font-scale-heading" className="text-sm font-semibold text-fg-strong">
          Font scale
        </h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-font-scale">Font scale</Label>
          <Select
            value={settings.fontScale}
            onValueChange={(value) =>
              onChange({ ...settings, fontScale: value as typeof settings.fontScale })
            }
          >
            <SelectTrigger id="settings-font-scale" className="max-w-48">
              <SelectValue>{(value: number) => `${Math.round(value * 100)}%`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FONT_SCALE_STEPS.map((scale) => (
                <SelectItem key={scale} value={scale}>
                  {Math.round(scale * 100)}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p
          className="text-sm text-muted"
          style={{ fontSize: `calc(1rem * ${settings.fontScale})` }}
        >
          The Woven Deep awaits.
        </p>
      </section>

      <section aria-labelledby="settings-display-heading" className="flex flex-col gap-2">
        <h3 id="settings-display-heading" className="text-sm font-semibold text-fg-strong">
          Display
        </h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-theme">Theme</Label>
          <Select
            value={settings.theme}
            onValueChange={(value) =>
              onChange({ ...settings, theme: value as typeof settings.theme })
            }
          >
            <SelectTrigger id="settings-theme" className="max-w-48">
              <SelectValue>{(value: string) => THEME_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tapestry">Tapestry (dark fantasy)</SelectItem>
              <SelectItem value="high-contrast">High contrast</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section aria-labelledby="settings-onboarding-heading" className="flex flex-col gap-2">
        <h3 id="settings-onboarding-heading" className="text-sm font-semibold text-fg-strong">
          Onboarding hints
        </h3>
        <div className="flex items-center gap-2">
          <Label htmlFor="settings-onboarding">
            Show contextual guidance while learning the ropes
          </Label>
          <Switch
            id="settings-onboarding"
            checked={settings.onboarding === 'on'}
            onCheckedChange={(checked) =>
              onChange({ ...settings, onboarding: checked ? 'on' : 'off' })
            }
          />
        </div>
      </section>

      <section aria-labelledby="settings-motion-heading" className="flex flex-col gap-2">
        <h3 id="settings-motion-heading" className="text-sm font-semibold text-fg-strong">
          Reduce motion
        </h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-reduced-motion">Reduce motion</Label>
          <Select
            value={settings.reducedMotion}
            onValueChange={(value) =>
              onChange({ ...settings, reducedMotion: value as typeof settings.reducedMotion })
            }
          >
            <SelectTrigger id="settings-reduced-motion" className="max-w-64">
              <SelectValue>{(value: string) => REDUCED_MOTION_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">
                System (follow this device&apos;s own reduced-motion preference)
              </SelectItem>
              <SelectItem value="on">Always (turn off glow/flash animations)</SelectItem>
              <SelectItem value="off">
                Never (keep animations on, even if the device asks for reduced motion)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section aria-labelledby="settings-bindings-heading" className="flex flex-col gap-2">
        <h3 id="settings-bindings-heading" className="text-sm font-semibold text-fg-strong">
          Key bindings
        </h3>
        {conflict && conflict.reason === 'conflict' && (
          <p role="alert" className="text-sm text-danger">
            {ACTION_LABELS[conflict.action]} could not be rebound to that key --{' '}
            {ACTION_LABELS[conflict.holder]} already uses it.
          </p>
        )}
        {conflict && conflict.reason === 'hardwired' && (
          <p role="alert" className="text-sm text-danger">
            {ACTION_LABELS[conflict.action]} could not be rebound to that key -- arrow and numpad
            keys always move, pick another key.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {ACTION_IDS.map((action) => {
            const chord = keymap.byAction[action];
            const isCapturing = capturing === action;
            return (
              <li key={action} className="flex items-center gap-3">
                <span className="min-w-40 text-sm">{ACTION_LABELS[action]}</span>
                <span className="min-w-16 font-mono text-sm text-muted">{chordKey(chord)}</span>
                {isCapturing ? (
                  <Input
                    aria-label={`Press a key to rebind ${ACTION_LABELS[action]}`}
                    // autoFocus: capture must move focus to this field the instant it appears so
                    // the very next keydown lands here.
                    autoFocus
                    readOnly
                    value="Press a key…"
                    className="max-w-40"
                    onKeyDown={(event) => handleCaptureKeyDown(action, event)}
                    onBlur={cancelCapture}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => armCapture(action)}
                  >
                    Rebind
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => resetRow(action)}>
                  Reset
                </Button>
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="secondary" onClick={resetAll} className="self-start">
          Reset all bindings
        </Button>
      </section>

      {account?.status === 'signed-in' && (
        <section aria-labelledby="settings-lifetime-heading" className="flex flex-col gap-2">
          <h3 id="settings-lifetime-heading" className="text-sm font-semibold text-fg-strong">
            Lifetime & achievements
          </h3>
          <p className="text-sm text-muted">
            Confirmed by the server across every run on this profile.
          </p>
          <dl aria-label="Lifetime totals" className="flex flex-col gap-1 text-sm">
            {LIFETIME_METRIC_ROWS.map(({ key, label }) => (
              <div key={key} className="flex justify-between gap-4">
                <dt className="text-muted">{label}</dt>
                <dd className="font-medium text-fg-strong">{account.lifetime.totals[key]}</dd>
              </div>
            ))}
          </dl>
          {account.achievements.length === 0 ? (
            <p role="status" className="text-sm text-muted">
              No achievements granted yet.
            </p>
          ) : (
            <ul aria-label="Granted achievements" className="flex flex-col gap-1 text-sm">
              {account.achievements.map((achievement) => (
                <li key={achievement.achievementId}>{achievement.name}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {onSignOut && (
        <section aria-labelledby="settings-sign-out-heading" className="flex flex-col gap-2">
          <h3 id="settings-sign-out-heading" className="text-sm font-semibold text-fg-strong">
            Sign out
          </h3>
          <p className="text-sm text-muted">
            Ends your session and returns to the title screen. Your run stays saved on the server.
          </p>
          <Button type="button" variant="destructive" onClick={onSignOut} className="self-start">
            Sign out
          </Button>
        </section>
      )}

      <section aria-labelledby="settings-clear-heading" className="flex flex-col gap-2">
        <h3 id="settings-clear-heading" className="text-sm font-semibold text-fg-strong">
          Clear guest session
        </h3>
        <p className="text-sm text-muted">
          Wipes your active run, Hall of Records, discovery log, guidance progress, and settings on
          this device, then returns to the title screen. This cannot be undone.
        </p>
        <Label htmlFor="settings-clear-confirm">Type &quot;clear&quot; to confirm</Label>
        <Input
          id="settings-clear-confirm"
          value={clearText}
          onChange={(event) => setClearText(event.target.value)}
          className="max-w-48"
        />
        <Button
          type="button"
          variant="destructive"
          disabled={!clearReady}
          onClick={onClearGuestSession}
          className="self-start"
        >
          Clear guest session
        </Button>
      </section>
    </div>
  );
}
