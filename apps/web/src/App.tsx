import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  heroFromChoices, type HeroChoices, type RunConclusionProjection, type RunRecordRepository, type Uint32State,
} from '@woven-deep/engine';
import { loadContentPack, logout } from './api.js';
import { GUEST_ACCOUNT, loadAccount, type AccountState } from './session/account.js';
import { loadSightings } from './session/codex.js';
import type { LogLine } from './session/event-log.js';
import { GuestSession, type SessionNotice } from './session/guest-session.js';
import { createSessionRunRecordRepository, SessionHallCorruptError } from './session/run-records-storage.js';
import { clearGuestSession } from './session/clear-guest-session.js';
import { DEFAULT_SETTINGS, loadSettings, resolveKeymap, saveSettings, type Settings } from './session/settings.js';
import { useGuestSession } from './session/store.js';
import {
  browserLocalStorage, browserSessionStorage, classifyStorageFailure, PORTRAIT_KEY, type SessionStorageLike,
} from './session/storage.js';
import { canOpenOverlay, OVERLAY_REGISTRY, type OverlayId } from './ui/overlays/registry.js';
import { OVERLAY_COMPONENTS } from './ui/overlays/overlay-components.js';
import { OverlayScaffold } from './ui/overlays/OverlayScaffold.js';
import { OverlayErrorBoundary } from './ui/overlays/OverlayErrorBoundary.js';
import { ChargenScreen } from './ui/screens/ChargenScreen.js';
import { ConclusionScreen } from './ui/screens/ConclusionScreen.js';
import { HallScreen } from './ui/screens/HallScreen.js';
import { SignInScreen } from './ui/screens/SignInScreen.js';
import { TitleScreen } from './ui/screens/TitleScreen.js';
import { PlayScreen } from './ui/PlayScreen.js';
import { effectiveReducedMotion, ScreenFade } from './ui/ScreenFade.js';
import './styles.css';

export interface AppProps {
  readonly fetcher?: typeof fetch;
  /** Test-only escape hatch: lets tests swap in an in-memory `SessionStorageLike` instead of the
   * real `window.sessionStorage`, exactly like `PlayScreen`'s `tier` prop. */
  readonly storage?: SessionStorageLike;
  /** Same escape hatch as `storage`, but for the settings module's `localStorage`-backed store
   * (`woven-deep.settings.v1`) -- a distinct browser storage area from the run/session state
   * above, so it gets its own override rather than reusing `storage`. */
  readonly localStorage?: SessionStorageLike;
  /** Test-only escape hatch mirroring `localStorage` above: when provided, skips the network
   * `loadAccount` fetch entirely and seeds `account` state with this value directly -- lets tests
   * assert on a signed-in title/App without wiring a session-shaped fetcher response. */
  readonly accountOverride?: AccountState;
}

/**
 * The client-side screen state machine: title (the landing menu) -> chargen (the wizard) -> play
 * (the live run) -> conclusion (payload wiring lands in a later task) -> hall (the Hall of
 * Records, reachable from either title or conclusion, hence `returnTo`).
 */
export type ScreenState =
  | { readonly screen: 'title' }
  | { readonly screen: 'signin' }
  | { readonly screen: 'chargen' }
  | { readonly screen: 'play' }
  | { readonly screen: 'conclusion' }
  | { readonly screen: 'hall'; readonly returnTo: 'title' | 'conclusion' };

/** Re-exported from `session/storage.js`, which now owns this constant so the framework-free
 * `clear-guest-session.ts` module can list it as a wipe target without importing this (React)
 * entry point -- kept as an `App` export too since it predates that move and one pre-existing test
 * still imports it from here. */
export { PORTRAIT_KEY };

/**
 * Test-only seed override: `?seed=11.22.33.44` (four dot-separated `Uint32` words) pins the
 * fresh run's RNG instead of the ambient `crypto.getRandomValues` seed `GuestSession` otherwise
 * generates. Never a real feature — no UI links to it, and it's parsed straight out of
 * `location.search`, so it only ever matters to a test (or a developer poking at the URL bar).
 * When chargen is reached, the SAME seed also drives the wizard's attribute rolls (see
 * `chargenSeed` below), so this one query parameter pins both.
 */
function parseSeedFromQuery(search: string): Uint32State | undefined {
  const raw = new URLSearchParams(search).get('seed');
  if (!raw) return undefined;
  const words = raw.split('.').map(Number);
  if (words.length !== 4 || words.some((word) => !Number.isFinite(word))) return undefined;
  return [words[0]!, words[1]!, words[2]!, words[3]!];
}

/**
 * Test-only escape hatch (documented, not a real feature): `?quickstart=1` skips the title and
 * chargen screens entirely and boots straight into play with `DEFAULT_GUEST_HERO`, exactly like
 * the pre-5B boot behaviour. It exists so the pre-existing e2e specs (recorded against a fixed
 * keypress walk over the default hero's stats) keep passing unmodified apart from their boot URL.
 */
function isQuickstart(search: string): boolean {
  return new URLSearchParams(search).get('quickstart') === '1';
}

/** Client-only ambient randomness for the chargen wizard's seed when no `?seed=` override is
 * present — mirrors `GuestSession`'s own `randomSeed` (guest-session.ts), duplicated here rather
 * than exported/shared because the chargen screen needs the seed BEFORE any `GuestSession`
 * exists (chargen constructs its session lazily, at confirm — see `App`'s doc comment). */
function randomSeed(): Uint32State {
  const words = new Uint32Array(4);
  crypto.getRandomValues(words);
  if (words.every((word) => word === 0)) words[0] = 1;
  return [words[0]!, words[1]!, words[2]!, words[3]!];
}

type DismissibleNotice = Exclude<SessionNotice, { kind: 'storage' }>;
type StorageNotice = Extract<SessionNotice, { kind: 'storage' }>;

function isStorageNotice(notice: SessionNotice): notice is StorageNotice {
  return notice.kind === 'storage';
}

/** Wording for the dismissible fresh/restored/save-discarded/data-reset banner. Storage notices
 * never reach this — they get their own persistent, non-dismissible warning (see
 * `storageWarningMessage`). */
function noticeMessage(notice: DismissibleNotice): string {
  if (notice.kind === 'fresh') return 'A new run has begun.';
  if (notice.kind === 'restored') return 'Welcome back — your run was restored.';
  if (notice.kind === 'data-reset') {
    return notice.source === 'sightings'
      ? 'Your discovery log was unreadable and has been reset.'
      : 'Your guidance progress was unreadable and has been reset.';
  }
  return `Your previous save could not be loaded (${notice.reason}) — a new run has begun.`;
}

/**
 * Wording for storage-unavailable vs storage-full, per the design spec's requirement that the two
 * failures produce distinct, actionable messages.
 */
function storageWarningMessage(notice: StorageNotice): string {
  return notice.failure === 'full'
    ? 'Your browser storage is full, so this run cannot be saved — play continues unsaved.'
    : 'Saving is unavailable in this browser — play continues, but your progress will not persist.';
}

/** How much of the adventure log the conclusion screen's "last moments" recap keeps. */
const CONCLUSION_LOG_TAIL = 8;

interface GameRootProps {
  readonly session: GuestSession;
  readonly pack: CompiledContentPack;
  readonly repository: RunRecordRepository;
  /** Read fresh (via `loadSightings`) on every render -- `GameRoot` re-renders on every session
   * publish (`useGuestSession` below), and `GuestSession` best-effort persists its own in-memory
   * sighting cache to this SAME storage after every publish, so a plain re-read here always
   * reflects the latest accumulation without any extra plumbing back out of `GuestSession`. */
  readonly storage: SessionStorageLike;
  readonly portraitGlyph: string | undefined;
  readonly onConcluded: (projection: RunConclusionProjection, logTail: readonly LogLine[]) => void;
  /** Called if `finalizeConcludedRun` itself throws (e.g. the Hall write hit a storage quota) --
   * surfaces a persistent, non-dismissible warning while the conclusion screen still shows the
   * in-memory (unfinalized) projection instead of leaving the player on a white screen. */
  readonly onFinalizeError: (message: string) => void;
  /** Forwarded straight through to `PlayScreen` -- `App` owns this state (see the guest-interface
   * overlay infrastructure), `GameRoot` just plumbs it past the `useGuestSession` split. */
  readonly overlay: OverlayId | null;
  readonly onOpenOverlay: (overlay: OverlayId) => void;
  readonly onCloseOverlay: () => void;
  readonly keymap: ReturnType<typeof resolveKeymap>;
  /** Same "just plumbing" note as `overlay`/`keymap` above -- `App` owns the settings state and its
   * persistence/clear-guest-session handlers; `GameRoot` forwards them to `PlayScreen` so the
   * settings overlay body works identically whether opened from play or from the title screen. */
  readonly settings: Settings;
  readonly onChangeSettings: (next: Settings) => void;
  readonly onClearGuestSession: () => void;
  /** Whether the contextual onboarding hint strip may show at all: `settings.onboarding === 'on'`
   * AND not a quickstart boot -- quickstart always forces it off regardless of the stored setting,
   * protecting every pinned e2e walk (see `isQuickstart`'s doc comment). */
  readonly onboardingEnabled: boolean;
}

/** Everything that needs a live `GuestSession` snapshot: the notice banners and the play screen
 * itself. Split out from `App` so `useGuestSession` (a hook) is only ever called once a session
 * actually exists — `App` renders this conditionally, not the hook.
 *
 * Storage notices (unavailable/full) get their own persistent, non-dismissible `role="alert"`
 * warning per the design spec — play continues unsaved, but the player must keep seeing that.
 * Every other notice (fresh/restored/save-discarded) stays a dismissible `role="status"` banner.
 *
 * Once the snapshot's `conclusion` first becomes non-null (the hero died, or a save restored an
 * already-concluded run), this finalizes the run into the Hall exactly once — `finalizeRun`'s own
 * `finalized` flag makes a repeat call safe, but `finalizedRef` also stops this component from
 * calling it again on every subsequent render before `onConcluded` swaps the screen away. */
function GameRoot({
  session, pack, repository, storage, portraitGlyph, onConcluded, onFinalizeError,
  overlay, onOpenOverlay, onCloseOverlay, keymap,
  settings, onChangeSettings, onClearGuestSession, onboardingEnabled,
}: GameRootProps): JSX.Element {
  const snapshot = useGuestSession(session);
  // Re-read on every render (every session publish, since this component only re-renders via the
  // `useGuestSession` subscription above) -- see the doc comment on `storage` in `GameRootProps`.
  const sightings = loadSightings(storage).sightings;
  const [dismissed, setDismissed] = useState(false);
  const { notice, conclusion } = snapshot;
  const finalizedRef = useRef(false);

  useEffect(() => {
    setDismissed(false);
  }, [notice]);

  useEffect(() => {
    if (conclusion === null || finalizedRef.current) return;
    finalizedRef.current = true;
    try {
      const projection = session.finalizeConcludedRun(repository, {
        achievedAt: `Run #${repository.records().length + 1}`,
        portraitGlyph: portraitGlyph ?? '@',
      });
      onConcluded(projection, session.getSnapshot().log.slice(-CONCLUSION_LOG_TAIL));
    } catch (thrown) {
      // The Hall write itself failed (quota/unavailable) -- this is not a bug in the run, so
      // don't let it crash out of the effect into a white screen. Surface the same persistent
      // storage-warning wording the rest of the app uses, and still move to the conclusion
      // screen with whatever the session can already project in-memory (score/heirloom null,
      // since the record never made it into the Hall).
      const failure = classifyStorageFailure(thrown);
      onFinalizeError(
        failure === 'full'
          ? 'Your browser storage is full, so this run could not be saved to the Hall of Records.'
          : 'The Hall of Records is unavailable, so this run could not be saved.',
      );
      const fallback = session.getSnapshot().conclusion;
      if (fallback) onConcluded(fallback, session.getSnapshot().log.slice(-CONCLUSION_LOG_TAIL));
    }
  }, [conclusion, onConcluded, onFinalizeError, portraitGlyph, repository, session]);

  const dismissibleNotice = notice && !isStorageNotice(notice) ? notice : null;
  const storageNotice = notice && isStorageNotice(notice) ? notice : null;

  return (
    <div className="app-root">
      {storageNotice && (
        <div role="alert" aria-label="Storage warning" className="storage-warning-banner" data-kind="storage">
          <p>{storageWarningMessage(storageNotice)}</p>
        </div>
      )}
      {dismissibleNotice && !dismissed && (
        <div role="status" aria-label="Session notice" className="session-banner" data-kind={dismissibleNotice.kind}>
          <p>{noticeMessage(dismissibleNotice)}</p>
          <button type="button" onClick={() => setDismissed(true)}>Dismiss</button>
        </div>
      )}
      <PlayScreen
        session={session}
        pack={pack}
        overlay={overlay}
        onOpenOverlay={onOpenOverlay}
        onCloseOverlay={onCloseOverlay}
        keymap={keymap}
        settings={settings}
        onChangeSettings={onChangeSettings}
        onClearGuestSession={onClearGuestSession}
        records={repository.records()}
        sightings={sightings}
        onboardingEnabled={onboardingEnabled}
      />
    </div>
  );
}

/**
 * Boots the guest client: fetches the compiled content pack, then walks the screen state machine
 * (title -> chargen -> play, plus a stub hall placeholder and a `?quickstart=1` shortcut that
 * skips straight to play). Unlike the pre-5B boot, the `GuestSession` is now created LAZILY —
 * quickstart and Continue construct it as soon as they're selected/available, while entering
 * chargen defers construction until the wizard is confirmed (its hero choices need to reach
 * `createNewRun`). Distinct screens for the two ways boot can go wrong: the pack fetch failing
 * (retry button) vs. anything the session itself surfaces once it's running (a dismissible
 * banner in `GameRoot`, covering storage being unavailable/full and save-discard notices alike).
 */
export function App({
  fetcher = fetch, storage: storageOverride, localStorage: localStorageOverride, accountOverride,
}: AppProps): JSX.Element {
  const [pack, setPack] = useState<CompiledContentPack>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  const localStorageInstance = useMemo(
    () => localStorageOverride ?? browserLocalStorage(),
    [localStorageOverride],
  );
  // Settings are read once at boot; from here on `setSettings` is the single source of truth --
  // every mutation (font scale, motion, a rebind, a reset) flows through `handleSettingsChange`
  // below, which persists via `saveSettings` before applying the change in-memory.
  const [settingsLoad] = useState(() => loadSettings(localStorageInstance));
  const [settings, setSettings] = useState(() => settingsLoad.settings);
  const keymap = useMemo(() => resolveKeymap(settings.bindings), [settings.bindings]);
  const [settingsWriteWarning, setSettingsWriteWarning] = useState<string>();
  // Task 8 review Finding 3 (milestone-wide error-handling debt): `loadSettings` already detects a
  // corrupt blob and resets to `DEFAULT_SETTINGS`, but that reset used to happen silently -- the
  // plan's error-handling section promises the standard dismissible notice for exactly this case.
  // Read once, at the same boot moment as `settingsLoad` above; dismissing it never re-shows it
  // (a corrupt blob is a one-time boot fact, not an ongoing condition).
  const [settingsCorruptedDismissed, setSettingsCorruptedDismissed] = useState(false);

  /**
   * The settings overlay's `onChange`. Persists first (`saveSettings` re-validates
   * `next.bindings` for conflicts as the write-time backstop the settings overlay's own
   * `bindingConflict` pre-check already guards against in practice), then applies the change
   * in-memory regardless of whether the write itself succeeded -- mirroring the "a failed
   * settings write warns and continues" rule: a storage failure (quota/unavailable) still lets
   * the guest keep playing with the new setting for this visit, surfaced as a persistent warning
   * rather than silently discarded or crashing. The one write `saveSettings` refuses outright (a
   * binding conflict with no `reason`) should be unreachable here -- the overlay's own
   * `bindingConflict` check refuses to even call `onChange` with a colliding chord -- so that
   * branch is treated as a no-op rather than a user-facing failure.
   */
  function handleSettingsChange(next: Settings): void {
    const result = saveSettings(localStorageInstance, next);
    if (!result.ok && result.reason === undefined) return;
    setSettings(next);
    setSettingsWriteWarning(result.ok ? undefined : (
      result.reason === 'full'
        ? 'Your browser storage is full, so settings changes will not be saved.'
        : 'Saving settings is unavailable in this browser -- changes apply for this visit only.'
    ));
  }

  // Bumped by `handleClearGuestSession` so the Hall-of-Records `repository` memo below (keyed on
  // this alongside `storage`) is forced to reconstruct AFTER the wipe -- otherwise it would keep
  // serving the in-memory records it already loaded at its last construction, even though the
  // underlying storage key is now gone.
  const [storageEpoch, setStorageEpoch] = useState(0);

  const [overlay, setOverlay] = useState<OverlayId | null>(null);

  /** Bumped exactly at the three screen-level transitions the design calls out for a fade-through-
   * dark (title->play via Continue, chargen->play via Confirm, play->conclusion on death) --
   * `ScreenFade` (below, inside `withRootStyling`) fades whenever this changes, since every branch
   * of the screen switch (title/chargen/hall/conclusion/play) shares that one wrapper and never
   * touches this token on its own. Every OTHER screen switch (title->chargen, hall in and out of
   * either direction, conclusion->title/chargen for a new hero) stays the instant conditional
   * return it always was, exactly per the brief. */
  const [fadeToken, setFadeToken] = useState(0);
  const bumpFadeToken = (): void => setFadeToken((token) => token + 1);

  /** `fontScale` as an inline `calc(1rem * scale)` on the app root, and `reducedMotion` as at most
   * one root class -- the three-way contract (see `styles.css`'s comment beside `.motion-full`):
   * "system" applies neither class (the `@media (prefers-reduced-motion: reduce)` query alone
   * decides), "on" applies `.motion-reduced` (forces animations off regardless of the OS setting),
   * "off" applies `.motion-full` (forces animations back on regardless of the OS setting -- the
   * one case a media query alone cannot serve, since it never sees the in-app setting). The SAME
   * three-way value, resolved to a plain boolean via `effectiveReducedMotion`, gates `ScreenFade`
   * below -- reduced motion must render NO fade element at all, which only a JS-side decision can
   * express (a CSS class alone cannot suppress an element's existence). */
  function withRootStyling(children: JSX.Element): JSX.Element {
    const motionClass = settings.reducedMotion === 'on' ? ' motion-reduced'
      : settings.reducedMotion === 'off' ? ' motion-full' : '';
    const themeClass = settings.theme === 'high-contrast' ? ' theme-high-contrast' : '';
    return (
      <div className={`guest-app-root${motionClass}${themeClass}`} style={{ fontSize: `calc(1rem * ${settings.fontScale})` }}>
        <ScreenFade transitionKey={fadeToken} reducedMotion={effectiveReducedMotion(settings.reducedMotion)}>
          {children}
        </ScreenFade>
      </div>
    );
  }

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    setPack(undefined);
    void loadContentPack(fetcher).then(
      (loaded) => {
        if (!cancelled) setPack(loaded);
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'The content service is unavailable.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher, attempt]);

  // The signed-in identity, if any -- `GUEST_ACCOUNT` until (and unless) a session cookie proves
  // otherwise. `accountOverride` is a test-only seam (mirroring `localStorageOverride`): when
  // given, it seeds state directly and the network fetch below never fires, exactly like
  // `localStorage`'s override skips `browserLocalStorage()`. Otherwise every boot re-fetches the
  // session fresh (declared -- and thus effect-ordered -- AFTER the pack-load effect above, so a
  // shared/naive test fetcher double serves the pack request first): this is also what picks up a
  // freshly-established session after a magic-link redirect lands back on `/` with `?auth=ok` in
  // the URL, since that redirect is itself a fresh page load and thus a fresh boot.
  const [account, setAccount] = useState<AccountState>(accountOverride ?? GUEST_ACCOUNT);
  useEffect(() => {
    if (accountOverride) return;
    let cancelled = false;
    void loadAccount(fetcher).then(
      (loaded) => {
        if (!cancelled) setAccount(loaded);
      },
      () => {
        if (!cancelled) setAccount(GUEST_ACCOUNT);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher, accountOverride]);

  const storage = useMemo(() => storageOverride ?? browserSessionStorage(), [storageOverride]);

  // The session-scoped Hall of Records repository. A corrupt blob throws `SessionHallCorruptError`
  // at construction; the module itself clears the storage key back to a fresh, empty Hall before
  // throwing, so retrying the SAME construction immediately below always succeeds. The active run
  // (an entirely separate storage key) is untouched either way — only a notice is surfaced.
  // `storageEpoch` forces this to reconstruct after `handleClearGuestSession` wipes `RECORDS_KEY`
  // out from under it -- `storage` itself never changes identity, so without this second
  // dependency the memo would keep serving the records it already loaded.
  const [repository, hallNotice] = useMemo((): readonly [RunRecordRepository, string | null] => {
    try {
      return [createSessionRunRecordRepository(storage), null] as const;
    } catch (thrown) {
      if (thrown instanceof SessionHallCorruptError) {
        return [createSessionRunRecordRepository(storage), thrown.message] as const;
      }
      throw thrown;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `storageEpoch` is a deliberate
    // reconstruction trigger, not a value read inside the memo.
  }, [storage, storageEpoch]);

  // Read once at boot -- `window.location.search` never changes for the life of this component
  // (the app never navigates), so this is the one place `isQuickstart` needs calling repeatedly.
  const [quickstart] = useState(() => isQuickstart(window.location.search));
  const [screen, setScreen] = useState<ScreenState>(
    () => (quickstart ? { screen: 'play' } : { screen: 'title' }),
  );
  const [session, setSession] = useState<GuestSession>();
  const [chargenSeed, setChargenSeed] = useState<Uint32State>();
  const [portraitGlyph, setPortraitGlyph] = useState<string>();
  const [conclusion, setConclusion] = useState<{
    projection: RunConclusionProjection; logTail: readonly LogLine[];
  }>();
  const [finalizeWarning, setFinalizeWarning] = useState<string>();
  const [chargenError, setChargenError] = useState<string>();

  const closeOverlay = (): void => setOverlay(null);
  /** Play-scope overlays (inventory / character sheet / map-journal) require an actual live run —
   * `screen.screen === 'play'` with a constructed `session` -- global overlays (codex / settings /
   * help) are always allowed, from title or play alike (see `canOpenOverlay`). */
  function openOverlay(id: OverlayId): void {
    const isPlayActive = screen.screen === 'play' && session !== undefined;
    if (!canOpenOverlay(OVERLAY_REGISTRY[id], isPlayActive)) return;
    setOverlay(id);
  }

  /**
   * The settings overlay's "clear guest session": wipes every guest-session storage key
   * (`clearGuestSession` -- run save, command counter, Hall of Records, portrait glyph, settings),
   * resets every piece of in-memory state those keys backed (so a stale run/portrait/settings
   * value can't survive the wipe only to be re-persisted on the next natural save), closes
   * whatever overlay is open, bumps `storageEpoch` so the Hall repository reloads as empty, and
   * lands on the title screen.
   */
  function handleClearGuestSession(): void {
    clearGuestSession(storage, localStorageInstance);
    setSettings(DEFAULT_SETTINGS);
    setSettingsWriteWarning(undefined);
    setSession(undefined);
    setConclusion(undefined);
    setPortraitGlyph(undefined);
    setChargenError(undefined);
    setFinalizeWarning(undefined);
    closeOverlay();
    setStorageEpoch((epoch) => epoch + 1);
    setScreen({ screen: 'title' });
  }

  function renderOverlayHost(): JSX.Element | null {
    if (!overlay) return null;
    const definition = OVERLAY_REGISTRY[overlay];
    const OverlayBody = OVERLAY_COMPONENTS[overlay];
    return (
      <OverlayScaffold title={definition.title} onClose={closeOverlay} testId={`overlay-${overlay}`}>
        <OverlayErrorBoundary>
          <OverlayBody
            settings={settings}
            onChangeSettings={handleSettingsChange}
            onClearGuestSession={handleClearGuestSession}
            keymap={keymap}
            pack={pack}
            records={repository.records()}
            sightings={loadSightings(storage).sightings}
          />
        </OverlayErrorBoundary>
      </OverlayScaffold>
    );
  }

  /** Wraps every post-boot screen with any persistent, non-dismissible warnings pending —
   * Hall-corruption-on-boot, finalize-write, and settings-write failures alike. The active run
   * survives regardless of any of these: only the affected write (or, on boot, the Hall itself)
   * was affected. */
  function withHallNotice(children: JSX.Element): JSX.Element {
    const showSettingsCorrupted = settingsLoad.corrupted && !settingsCorruptedDismissed;
    if (!hallNotice && !finalizeWarning && !settingsWriteWarning && !showSettingsCorrupted) return children;
    return (
      <>
        {showSettingsCorrupted && (
          <div role="status" aria-label="Settings notice" className="session-banner" data-kind="settings-corrupted">
            <p>Stored settings were unreadable and have been reset.</p>
            <button type="button" onClick={() => setSettingsCorruptedDismissed(true)}>Dismiss</button>
          </div>
        )}
        {hallNotice && (
          <div role="alert" aria-label="Hall notice" className="storage-warning-banner" data-kind="hall-corrupt">
            <p>Your Hall of Records could not be read and has been reset. ({hallNotice})</p>
          </div>
        )}
        {finalizeWarning && (
          <div role="alert" aria-label="Storage warning" className="storage-warning-banner" data-kind="finalize-failed">
            <p>{finalizeWarning}</p>
          </div>
        )}
        {settingsWriteWarning && (
          <div role="alert" aria-label="Storage warning" className="storage-warning-banner" data-kind="settings-write-failed">
            <p>{settingsWriteWarning}</p>
          </div>
        )}
        {children}
      </>
    );
  }

  // Quickstart's session is constructed once the pack is ready (it can't be constructed at the
  // `useState` initializer above — the pack isn't loaded yet at first render). Gated on
  // `screen.screen === 'play'` (quickstart's initial screen, set at the `useState` initializer
  // above): without it, a surviving `?quickstart=1` query in the URL re-fires this effect after
  // `handleClearGuestSession` sets `session` back to undefined and the screen to 'title',
  // silently constructing a hidden `GuestSession` that re-persists storage (its constructor syncs
  // sightings on its own) and breaks the wipe contract on quickstart boots.
  useEffect(() => {
    if (!pack || session) return;
    if (screen.screen !== 'play') return;
    if (!isQuickstart(window.location.search)) return;
    const seed = parseSeedFromQuery(window.location.search);
    setSession(
      seed
        ? new GuestSession({ pack, storage, seed, localStorage: localStorageInstance })
        : new GuestSession({ pack, storage, localStorage: localStorageInstance }),
    );
  }, [pack, storage, session, screen, localStorageInstance]);

  if (error) {
    return withRootStyling(
      <main className="shell boot-error">
        <p className="eyebrow">The Woven Deep</p>
        <h1>The archive would not answer.</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => setAttempt((count) => count + 1)}>Retry</button>
      </main>,
    );
  }

  if (!pack) {
    return withRootStyling(
      <main className="shell boot-loading">
        <p className="eyebrow">The Woven Deep</p>
        <p role="status">Binding the current content pack…</p>
      </main>,
    );
  }

  if (screen.screen === 'title') {
    return withRootStyling(withHallNotice(
      <main className="shell">
        <TitleScreen
          storage={storage}
          account={account}
          onEnterTheDeep={() => {
            closeOverlay();
            setChargenSeed(parseSeedFromQuery(window.location.search) ?? randomSeed());
            setScreen({ screen: 'chargen' });
          }}
          onContinue={() => {
            closeOverlay();
            setPortraitGlyph(storage.get(PORTRAIT_KEY) ?? undefined);
            setSession(new GuestSession({ pack, storage, localStorage: localStorageInstance }));
            setScreen({ screen: 'play' });
            bumpFadeToken();
          }}
          onHall={() => setScreen({ screen: 'hall', returnTo: 'title' })}
          onOpenOverlay={openOverlay}
          onSignIn={() => setScreen({ screen: 'signin' })}
          onSignOut={() => {
            void logout(account.csrfToken ?? '', fetcher).then(() => setAccount(GUEST_ACCOUNT));
          }}
        />
        {renderOverlayHost()}
      </main>,
    ));
  }

  if (screen.screen === 'signin') {
    return withRootStyling(withHallNotice(
      <main className="shell">
        <SignInScreen fetcher={fetcher} onBack={() => setScreen({ screen: 'title' })} />
      </main>,
    ));
  }

  if (screen.screen === 'chargen') {
    if (chargenError) {
      return withRootStyling(withHallNotice(
        <main className="shell boot-error">
          <p className="eyebrow">The Woven Deep</p>
          <h1>Something went wrong building your hero.</h1>
          <p role="alert">{chargenError}</p>
          <button type="button" onClick={() => setChargenError(undefined)}>Back</button>
        </main>,
      ));
    }
    // `chargenSeed` is always set before this screen is reached (see `onEnterTheDeep` above).
    const seed = chargenSeed!;
    return withRootStyling(withHallNotice(
      <ChargenScreen
        pack={pack}
        seed={seed}
        settings={settings}
        onChangeSettings={handleSettingsChange}
        onConfirm={(choices: HeroChoices, glyph: string) => {
          let hero: ReturnType<typeof heroFromChoices>;
          try {
            hero = heroFromChoices({ pack, choices });
          } catch (thrown) {
            // A client bug (a malformed choice heroFromChoices' own validation somehow missed
            // upstream) must never fail silently -- surface it visibly rather than only logging.
            setChargenError(thrown instanceof Error ? thrown.message : 'Hero creation failed unexpectedly.');
            return;
          }
          try {
            storage.set(PORTRAIT_KEY, glyph);
          } catch {
            // Best-effort, same as every other portrait/cosmetic persistence attempt in this app —
            // the run itself is unaffected if this particular write fails.
          }
          setPortraitGlyph(glyph);
          setSession(new GuestSession({ pack, storage, seed, hero, startFresh: true, localStorage: localStorageInstance }));
          setScreen({ screen: 'play' });
          bumpFadeToken();
        }}
      />,
    ));
  }

  if (screen.screen === 'hall') {
    const { returnTo } = screen;
    return withRootStyling(withHallNotice(
      <main className="shell">
        <HallScreen repository={repository} onBack={() => setScreen({ screen: returnTo })} />
      </main>,
    ));
  }

  if (screen.screen === 'conclusion') {
    // `conclusion` is always set before this screen is reached — `GameRoot`'s `onConcluded`
    // (below) sets both together, in the same event.
    if (!conclusion) {
      return withRootStyling(withHallNotice(
        <main className="shell boot-loading">
          <p className="eyebrow">The Woven Deep</p>
          <p role="status">The run has ended.</p>
        </main>,
      ));
    }
    return withRootStyling(withHallNotice(
      <ConclusionScreen
        projection={conclusion.projection}
        pack={pack}
        logTail={conclusion.logTail}
        onHall={() => setScreen({ screen: 'hall', returnTo: 'conclusion' })}
        onNewHero={() => {
          setSession(undefined);
          setConclusion(undefined);
          setChargenSeed(parseSeedFromQuery(window.location.search) ?? randomSeed());
          setScreen({ screen: 'chargen' });
        }}
        onTitle={() => {
          setSession(undefined);
          setConclusion(undefined);
          setScreen({ screen: 'title' });
        }}
      />,
    ));
  }

  if (!session) {
    return withRootStyling(withHallNotice(
      <main className="shell boot-loading">
        <p className="eyebrow">The Woven Deep</p>
        <p role="status">Binding the current content pack…</p>
      </main>,
    ));
  }

  return withRootStyling(withHallNotice(
    <GameRoot
      session={session}
      pack={pack}
      repository={repository}
      storage={storage}
      portraitGlyph={portraitGlyph}
      overlay={overlay}
      onOpenOverlay={openOverlay}
      onCloseOverlay={closeOverlay}
      keymap={keymap}
      settings={settings}
      onChangeSettings={handleSettingsChange}
      onClearGuestSession={handleClearGuestSession}
      onboardingEnabled={settings.onboarding === 'on' && !quickstart}
      onConcluded={(projection, logTail) => {
        setConclusion({ projection, logTail });
        setScreen({ screen: 'conclusion' });
        bumpFadeToken();
      }}
      onFinalizeError={setFinalizeWarning}
    />,
  ));
}
