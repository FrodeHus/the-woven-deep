import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  heroFromChoices,
  type HeroChoices,
  type RunConclusionProjection,
  type RunRecordRepository,
  type Uint32State,
} from '@woven-deep/engine';
import { logout, playWsUrl } from './api.js';
import { GUEST_ACCOUNT, type AccountState } from './session/account.js';
import { loadSightings } from './session/codex.js';
import type { LogLine } from './session/event-log.js';
import { GuestSession } from './session/guest-session.js';
import { ProfileSession } from './session/profile-session.js';
import type { RunSession } from './session/run-session.js';
import { clearGuestSession } from './session/clear-guest-session.js';
import { randomSeed } from './session/seed.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './session/settings.js';
import { useRunSession } from './session/store.js';
import type { WebSocketFactory } from './session/ws-client.js';
import {
  browserLocalStorage,
  browserSessionStorage,
  classifyStorageFailure,
  PORTRAIT_KEY,
  type SessionStorageLike,
} from './session/storage.js';
import {
  AppBanners,
  isStorageNotice,
  noticeMessage,
  storageWarningMessage,
} from './ui/AppBanners.js';
import { RootStyling } from './ui/RootStyling.js';
import { useAccount } from './ui/hooks/useAccount.js';
import { useContentPack } from './ui/hooks/useContentPack.js';
import { useHallRepository } from './ui/hooks/useHallRepository.js';
import { useScreenRouter } from './ui/hooks/useScreenRouter.js';
import { useSettingsRoaming } from './ui/hooks/useSettingsRoaming.js';
import { canOpenOverlay, OVERLAY_REGISTRY, type OverlayId } from './ui/overlays/registry.js';
import { OverlayHost } from './ui/overlays/OverlayHost.js';
import { ChargenScreen } from './ui/screens/ChargenScreen.js';
import { ConclusionScreen } from './ui/screens/ConclusionScreen.js';
import { HallScreen } from './ui/screens/HallScreen.js';
import { SignInScreen } from './ui/screens/SignInScreen.js';
import { TitleScreen } from './ui/screens/TitleScreen.js';
import { PlayScreen } from './ui/PlayScreen.js';
import { UiProviders } from './ui/providers.js';
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
  /** Test-only escape hatch: injects the transport a signed-in profile's `ProfileSession` opens
   * `/ws/play` over, exactly like `ProfileSessionInput.createSocket` -- lets tests supply a fully
   * in-memory fake `WebSocketLike` instead of the real browser `WebSocket`. Never set in
   * production (the default `WsClient` behaviour -- the real global `WebSocket` -- applies). */
  readonly createSocket?: WebSocketFactory;
}

export type { ScreenState } from './ui/hooks/useScreenRouter.js';

/** Re-exported from `session/storage.js`, which owns this constant so the framework-free
 * `clear-guest-session.ts` module can list it as a wipe target without importing this (React)
 * entry point -- also exported from `App` since one test imports it from here. */
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
 * chargen screens entirely and boots straight into play with `DEFAULT_GUEST_HERO`. It exists so
 * the e2e specs (recorded against a fixed keypress walk over the default hero's stats) keep
 * passing unmodified apart from their boot URL.
 */
function isQuickstart(search: string): boolean {
  return new URLSearchParams(search).get('quickstart') === '1';
}

/** How much of the adventure log the conclusion screen's "last moments" recap keeps. */
const CONCLUSION_LOG_TAIL = 8;

interface GameRootProps {
  readonly session: RunSession;
  readonly pack: CompiledContentPack;
  readonly repository: RunRecordRepository;
  readonly portraitGlyph: string | undefined;
  readonly onConcluded: (projection: RunConclusionProjection, logTail: readonly LogLine[]) => void;
  /** Called if `finalizeConcludedRun` itself throws (e.g. the Hall write hit a storage quota) --
   * surfaces a persistent, non-dismissible warning while the conclusion screen still shows the
   * in-memory (unfinalized) projection instead of leaving the player on a white screen. */
  readonly onFinalizeError: (message: string) => void;
  /** Forwarded straight through to `PlayScreen` -- `App` owns this state (see the guest-interface
   * overlay infrastructure), `GameRoot` just plumbs it past the `useRunSession` split. */
  readonly overlay: OverlayId | null;
  readonly onOpenOverlay: (overlay: OverlayId) => void;
  readonly onCloseOverlay: () => void;
  /** `App` owns the settings-clear handler; `GameRoot` forwards it to `PlayScreen` so the settings
   * overlay body's "clear guest session" action works identically whether opened from play or from
   * the title screen. Settings/keymap themselves reach `PlayScreen` (and every overlay) via
   * `useSettingsCtx()`, sourced from the single `UiProviders` `App` renders around the whole
   * authenticated tree. */
  readonly onClearGuestSession: () => void;
  /** Signs the current profile out -- forwarded straight through to `PlayScreen`. `undefined` for
   * a guest's `GuestSession` (there is no account to sign out of); only ever set for a signed-in
   * `ProfileSession` run. See `PlayScreenProps.onSignOut`'s doc comment. */
  readonly onSignOut?: (() => void) | undefined;
  /** Forwarded straight through to `PlayScreen`'s settings overlay body -- the current account
   * (always populated; `GUEST_ACCOUNT` for a guest run), driving the signed-in-only "Lifetime &
   * achievements" section. */
  readonly account: AccountState;
  /** Whether the contextual onboarding hint strip may show at all: `settings.onboarding === 'on'`
   * AND not a quickstart boot -- quickstart always forces it off regardless of the stored setting,
   * protecting every pinned e2e walk (see `isQuickstart`'s doc comment). */
  readonly onboardingEnabled: boolean;
}

/** Everything that needs a live `RunSession` snapshot: the notice banners and the play screen
 * itself. Split out from `App` so `useRunSession` (a hook) is only ever called once a session
 * actually exists — `App` renders this conditionally, not the hook. Works identically whether
 * `session` is a local `GuestSession` or a WebSocket-backed `ProfileSession`.
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
  session,
  pack,
  repository,
  portraitGlyph,
  onConcluded,
  onFinalizeError,
  overlay,
  onOpenOverlay,
  onCloseOverlay,
  onClearGuestSession,
  onSignOut,
  account,
  onboardingEnabled,
}: GameRootProps): JSX.Element {
  const snapshot = useRunSession(session);
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
        <div
          role="alert"
          aria-label="Storage warning"
          className="storage-warning-banner"
          data-kind="storage"
        >
          <p>{storageWarningMessage(storageNotice)}</p>
        </div>
      )}
      {dismissibleNotice && !dismissed && (
        <div
          role="status"
          aria-label="Session notice"
          className="session-banner"
          data-kind={dismissibleNotice.kind}
        >
          <p>{noticeMessage(dismissibleNotice)}</p>
          <button type="button" onClick={() => setDismissed(true)}>
            Dismiss
          </button>
        </div>
      )}
      <PlayScreen
        session={session}
        pack={pack}
        overlay={overlay}
        onOpenOverlay={onOpenOverlay}
        onCloseOverlay={onCloseOverlay}
        onClearGuestSession={onClearGuestSession}
        onSignOut={onSignOut}
        account={account}
        records={repository.records()}
        currentHeart={repository.currentHeart()}
        onboardingEnabled={onboardingEnabled}
      />
    </div>
  );
}

/**
 * Boots the guest client: fetches the compiled content pack, then walks the screen state machine
 * (title -> chargen -> play, plus a stub hall placeholder and a `?quickstart=1` shortcut that
 * skips straight to play). The `GuestSession` is created LAZILY —
 * quickstart and Continue construct it as soon as they're selected/available, while entering
 * chargen defers construction until the wizard is confirmed (its hero choices need to reach
 * `createNewRun`). Distinct screens for the two ways boot can go wrong: the pack fetch failing
 * (retry button) vs. anything the session itself surfaces once it's running (a dismissible
 * banner in `GameRoot`, covering storage being unavailable/full and save-discard notices alike).
 */
export function App({
  fetcher = fetch,
  storage: storageOverride,
  localStorage: localStorageOverride,
  accountOverride,
  createSocket,
}: AppProps): JSX.Element {
  const { pack, error, retry } = useContentPack(fetcher);

  const localStorageInstance = useMemo(
    () => localStorageOverride ?? browserLocalStorage(),
    [localStorageOverride],
  );
  // Settings are read once at boot; from here on `setSettings` is the single source of truth --
  // every mutation (font scale, motion, a rebind, a reset) flows through `handleSettingsChange`
  // below, which persists via `saveSettings` before applying the change in-memory.
  const [settingsLoad] = useState(() => loadSettings(localStorageInstance));
  const [settings, setSettings] = useState(() => settingsLoad.settings);
  const [settingsWriteWarning, setSettingsWriteWarning] = useState<string>();
  // When `loadSettings` detects a corrupt blob at boot it resets to `DEFAULT_SETTINGS` and flags
  // it; this state surfaces the standard dismissible notice for that reset. Read once, at the same
  // boot moment as `settingsLoad` above; dismissing it never re-shows it (a corrupt blob is a
  // one-time boot fact, not an ongoing condition).
  const [settingsCorruptedDismissed, setSettingsCorruptedDismissed] = useState(false);

  // The signed-in identity, if any -- `GUEST_ACCOUNT` until (and unless) a session cookie proves
  // otherwise. `accountOverride` is a test-only seam (mirroring `localStorageOverride`): when
  // given, it seeds state directly and the network fetch never fires, exactly like
  // `localStorage`'s override skips `browserLocalStorage()`. Otherwise every boot re-fetches the
  // session fresh (effect-ordered after the pack-load effect, so a shared/naive test fetcher
  // double serves the pack request first): this is also what picks up a freshly-established
  // session after a magic-link redirect lands back on `/` with `?auth=ok` in the URL, since that
  // redirect is itself a fresh page load and thus a fresh boot.
  const { account, setAccount } = useAccount(fetcher, accountOverride);

  // Settings roaming: server-adopt/seed on sign-in, plus the debounced push
  // (`pushSettings`) `handleSettingsChange` below calls on every change while signed in.
  const { pushSettings } = useSettingsRoaming(
    account,
    fetcher,
    settings,
    localStorageInstance,
    setSettings,
  );

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
    setSettingsWriteWarning(
      result.ok
        ? undefined
        : result.reason === 'full'
          ? 'Your browser storage is full, so settings changes will not be saved.'
          : 'Saving settings is unavailable in this browser -- changes apply for this visit only.',
    );

    // Signed-in players roam settings across devices. The localStorage write above is
    // unconditional (guest and signed-in alike); `pushSettings` is the signed-in-only extra --
    // it no-ops for a guest, or a player who has since signed out.
    pushSettings(next);
  }

  // Bumped by `handleClearGuestSession` so the Hall-of-Records `repository` (keyed on this
  // alongside `storage`) is forced to reconstruct AFTER the wipe -- otherwise it would keep serving
  // the in-memory records it already loaded at its last construction, even though the underlying
  // storage key is now gone.
  const [storageEpoch, setStorageEpoch] = useState(0);

  const [overlay, setOverlay] = useState<OverlayId | null>(null);

  const storage = useMemo(() => storageOverride ?? browserSessionStorage(), [storageOverride]);

  const [repository, hallNotice] = useHallRepository(storage, storageEpoch);

  // Read once at boot -- `window.location.search` never changes for the life of this component
  // (the app never navigates), so this is the one place `isQuickstart` needs calling repeatedly.
  const [quickstart] = useState(() => isQuickstart(window.location.search));
  const router = useScreenRouter(quickstart);
  const { screen } = router;
  const [session, setSession] = useState<RunSession>();
  const [chargenSeed, setChargenSeed] = useState<Uint32State>();
  const [portraitGlyph, setPortraitGlyph] = useState<string>();
  const [conclusion, setConclusion] = useState<{
    projection: RunConclusionProjection;
    logTail: readonly LogLine[];
  }>();
  const [finalizeWarning, setFinalizeWarning] = useState<string>();
  const [chargenError, setChargenError] = useState<string>();
  // A signed-in profile's `/ws/play` connect failure (content/version mismatch, network error
  // before the handshake ever completes) -- distinct from the terminal `superseded`/`protocol-error`
  // notices `ProfileSession` itself surfaces once connected (those flow through `snapshot.notice` ->
  // `AppBanners` like any other session notice); there is no session object yet to carry a notice
  // when `ProfileSession.connect` itself rejects, so this is `App`'s own boot-error state for that.
  const [profileError, setProfileError] = useState<string>();

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
    router.toTitle();
  }

  // Quickstart's session is constructed once the pack is ready (it can't be constructed at the
  // `useState` initializer above — the pack isn't loaded yet at first render). Gated on
  // `screen.screen === 'play'` (quickstart's initial screen): without it, a surviving
  // `?quickstart=1` query in the URL re-fires this effect after `handleClearGuestSession` sets
  // `session` back to undefined and the screen to 'title', silently constructing a hidden
  // `GuestSession` that re-persists storage (its constructor syncs sightings on its own) and breaks
  // the wipe contract on quickstart boots.
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

  /** Signs the current profile out: logs out server-side, then flips `account` back to
   * `GUEST_ACCOUNT` -- the effect below reacts to that transition by tearing down any live
   * `ProfileSession` and returning to the title screen. Reused by both the title screen's
   * "Sign out" menu entry and the in-play settings overlay's "Sign out" action (the only two
   * places `App` ever offers signing out). */
  function handleSignOut(): void {
    void logout(account.csrfToken ?? '', fetcher).then(() => setAccount(GUEST_ACCOUNT));
  }

  /**
   * Signed-in profile connect: opens a `ProfileSession` over `/ws/play` once the account is known
   * signed-in and the content pack is ready. Guarded on `session`/`profileError` both being unset
   * so this only ever attempts once per sign-in — a successful connect flips `session` (and this
   * effect never re-fires while it's live); a rejected connect (content/version mismatch, or the
   * handshake never completing) sets `profileError` instead, surfaced by the title screen's own
   * boot-error branch below, with a Retry that clears it. Mirrors the quickstart effect just above:
   * gated so a torn-down session (sign-out, handled by the next effect) is never resurrected --
   * signing out flips `account.status` back to `'guest'`, which alone (not `session`/`profileError`
   * clearing) blocks this effect from ever refiring for the same, now-signed-out account.
   */
  useEffect(() => {
    if (!pack) return;
    if (account.status !== 'signed-in') return;
    if (session !== undefined) return;
    if (profileError !== undefined) return;
    let cancelled = false;
    void ProfileSession.connect({
      pack,
      url: playWsUrl(),
      ...(createSocket ? { createSocket } : {}),
    }).then(
      (profileSession) => {
        if (cancelled) {
          profileSession.close();
          return;
        }
        setSession(profileSession);
        router.toPlay();
      },
      (thrown: unknown) => {
        if (cancelled) return;
        setProfileError(
          thrown instanceof Error ? thrown.message : 'Could not reach your saved run.',
        );
      },
    );
    return () => {
      cancelled = true;
    };
    // `router.toPlay` (read above) is a fresh closure every render (see `useScreenRouter`) --
    // depending on it would re-run (and reconnect) this effect on every unrelated re-render. The
    // `session`/`profileError` guards above already make this a run-once-per-sign-in effect
    // regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, account.status, session, profileError, createSocket]);

  /** Tears down a signed-in profile's live `ProfileSession` on sign-out: reacts to `account.status`
   * leaving `'signed-in'` (the only way `handleSignOut` above changes it) by clearing `session`
   * (the effect below closes the underlying WS as its cleanup) and returning to the title screen --
   * a no-op for a guest (whose `session`, if any, is a `GuestSession`, never a `ProfileSession`), so
   * this never touches the guest boot/play path. */
  useEffect(() => {
    if (account.status === 'signed-in') return;
    if (!(session instanceof ProfileSession)) return;
    setSession(undefined);
    setProfileError(undefined);
    closeOverlay();
    router.toTitle();
    // Only re-run on an account-status transition; `session`/`router` (read above) are read fresh
    // at that moment (mirrors `useSettingsRoaming`'s roam-on-sign-in effect, which does the same
    // for its own one-shot).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.status]);

  /** Closes the underlying `/ws/play` connection whenever `session` stops being the live
   * `ProfileSession` -- covers both the sign-out teardown above and the component unmounting
   * outright. A no-op for a `GuestSession` (or no session at all), so guest behavior is
   * unaffected. */
  useEffect(() => {
    return () => {
      if (session instanceof ProfileSession) session.close();
    };
  }, [session]);

  if (error) {
    return (
      <RootStyling settings={settings} fadeToken={router.fadeToken}>
        <main className="shell boot-error">
          <p className="eyebrow">The Woven Deep</p>
          <h1>The archive would not answer.</h1>
          <p role="alert">{error}</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </main>
      </RootStyling>
    );
  }

  if (!pack) {
    return (
      <RootStyling settings={settings} fadeToken={router.fadeToken}>
        <main className="shell boot-loading">
          <p className="eyebrow">The Woven Deep</p>
          <p role="status">Binding the current content pack…</p>
        </main>
      </RootStyling>
    );
  }

  /** The current screen's content, before the persistent-warning and root-styling wrappers. Every
   * post-boot screen shares those two wrappers (applied once below), so each branch here returns
   * only its own inner element. Takes the loaded `pack` so it stays non-nullable throughout. */
  function renderScreen(pack: CompiledContentPack): JSX.Element {
    if (screen.screen === 'title') {
      // A signed-in profile's `ProfileSession.connect` rejected outright (content/version
      // mismatch, or the handshake never completing) -- surfaced the same way the content-pack
      // fetch failure is above, since there is no session/notice to carry this through yet.
      if (account.status === 'signed-in' && profileError) {
        return (
          <main className="shell boot-error">
            <p className="eyebrow">The Woven Deep</p>
            <h1>Your run could not be reached.</h1>
            <p role="alert">{profileError}</p>
            <button type="button" onClick={() => setProfileError(undefined)}>
              Retry
            </button>
          </main>
        );
      }
      return (
        <main className="shell">
          <TitleScreen
            storage={storage}
            account={account}
            onEnterTheDeep={() => {
              // Guests only -- a signed-in profile's run is server-authoritative and connects
              // automatically (see the connect effect above); there is no client-side chargen
              // wizard for it (hero customization for profiles is a later milestone).
              if (account.status !== 'guest') return;
              closeOverlay();
              setChargenSeed(parseSeedFromQuery(window.location.search) ?? randomSeed());
              router.toChargen();
            }}
            onContinue={() => {
              if (account.status !== 'guest') return;
              closeOverlay();
              setPortraitGlyph(storage.get(PORTRAIT_KEY) ?? undefined);
              setSession(new GuestSession({ pack, storage, localStorage: localStorageInstance }));
              router.toPlay();
            }}
            onHall={() => router.toHall('title')}
            onOpenOverlay={openOverlay}
            onSignIn={() => router.toSignin()}
            onSignOut={handleSignOut}
          />
          <OverlayHost
            overlay={overlay}
            onClose={closeOverlay}
            isPlayActive={false}
            records={repository.records()}
            onClearGuestSession={handleClearGuestSession}
            sightings={loadSightings(storage).sightings}
            account={account}
          />
        </main>
      );
    }

    if (screen.screen === 'signin') {
      return (
        <main className="shell">
          <SignInScreen fetcher={fetcher} onBack={() => router.toTitle()} />
        </main>
      );
    }

    if (screen.screen === 'chargen') {
      if (chargenError) {
        return (
          <main className="shell boot-error">
            <p className="eyebrow">The Woven Deep</p>
            <h1>Something went wrong building your hero.</h1>
            <p role="alert">{chargenError}</p>
            <button type="button" onClick={() => setChargenError(undefined)}>
              Back
            </button>
          </main>
        );
      }
      // `chargenSeed` is always set before this screen is reached (see `onEnterTheDeep` above).
      const seed = chargenSeed!;
      return (
        <ChargenScreen
          pack={pack}
          seed={seed}
          settings={settings}
          onChangeSettings={handleSettingsChange}
          unlockedClassIds={account.unlockedClassIds}
          onConfirm={(choices: HeroChoices, glyph: string) => {
            let hero: ReturnType<typeof heroFromChoices>;
            try {
              hero = heroFromChoices({ pack, choices });
            } catch (thrown) {
              // A client bug (a malformed choice heroFromChoices' own validation somehow missed
              // upstream) must never fail silently -- surface it visibly rather than only logging.
              setChargenError(
                thrown instanceof Error ? thrown.message : 'Hero creation failed unexpectedly.',
              );
              return;
            }
            try {
              storage.set(PORTRAIT_KEY, glyph);
            } catch {
              // Best-effort, same as every other portrait/cosmetic persistence attempt in this app —
              // the run itself is unaffected if this particular write fails.
            }
            setPortraitGlyph(glyph);
            setSession(
              new GuestSession({
                pack,
                storage,
                seed,
                hero,
                startFresh: true,
                localStorage: localStorageInstance,
              }),
            );
            router.toPlay();
          }}
        />
      );
    }

    if (screen.screen === 'hall') {
      const { returnTo } = screen;
      return (
        <main className="shell">
          <HallScreen repository={repository} onBack={() => router.returnFromHall(returnTo)} />
        </main>
      );
    }

    if (screen.screen === 'conclusion') {
      // `conclusion` is always set before this screen is reached — `GameRoot`'s `onConcluded`
      // (below) sets both together, in the same event.
      if (!conclusion) {
        return (
          <main className="shell boot-loading">
            <p className="eyebrow">The Woven Deep</p>
            <p role="status">The run has ended.</p>
          </main>
        );
      }
      return (
        <ConclusionScreen
          projection={conclusion.projection}
          pack={pack}
          logTail={conclusion.logTail}
          onHall={() => router.toHall('conclusion')}
          onNewHero={() => {
            setSession(undefined);
            setConclusion(undefined);
            setChargenSeed(parseSeedFromQuery(window.location.search) ?? randomSeed());
            router.toChargen();
          }}
          onTitle={() => {
            setSession(undefined);
            setConclusion(undefined);
            router.toTitle();
          }}
        />
      );
    }

    if (!session) {
      return (
        <main className="shell boot-loading">
          <p className="eyebrow">The Woven Deep</p>
          <p role="status">Binding the current content pack…</p>
        </main>
      );
    }

    return (
      <GameRoot
        session={session}
        pack={pack}
        repository={repository}
        portraitGlyph={portraitGlyph}
        overlay={overlay}
        onOpenOverlay={openOverlay}
        onCloseOverlay={closeOverlay}
        onClearGuestSession={handleClearGuestSession}
        onSignOut={account.status === 'signed-in' ? handleSignOut : undefined}
        account={account}
        onboardingEnabled={settings.onboarding === 'on' && !quickstart}
        onConcluded={(projection, logTail) => {
          setConclusion({ projection, logTail });
          router.toConclusion();
        }}
        onFinalizeError={setFinalizeWarning}
      />
    );
  }

  return (
    <RootStyling settings={settings} fadeToken={router.fadeToken}>
      <AppBanners
        hallNotice={hallNotice}
        finalizeWarning={finalizeWarning}
        settingsWriteWarning={settingsWriteWarning}
        showSettingsCorrupted={settingsLoad.corrupted && !settingsCorruptedDismissed}
        onDismissSettingsCorrupted={() => setSettingsCorruptedDismissed(true)}
      >
        <UiProviders
          pack={pack}
          settings={settings}
          onChangeSettings={handleSettingsChange}
          session={session}
        >
          {renderScreen(pack)}
        </UiProviders>
      </AppBanners>
    </RootStyling>
  );
}
