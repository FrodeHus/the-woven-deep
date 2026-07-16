import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  heroFromChoices, type HeroChoices, type RunConclusionProjection, type RunRecordRepository, type Uint32State,
} from '@woven-deep/engine';
import { loadContentPack } from './api.js';
import type { LogLine } from './session/event-log.js';
import { GuestSession, type SessionNotice } from './session/guest-session.js';
import { createSessionRunRecordRepository, SessionHallCorruptError } from './session/run-records-storage.js';
import { useGuestSession } from './session/store.js';
import { browserSessionStorage, type SessionStorageLike } from './session/storage.js';
import { ChargenScreen } from './ui/screens/ChargenScreen.js';
import { ConclusionScreen } from './ui/screens/ConclusionScreen.js';
import { HallScreen } from './ui/screens/HallScreen.js';
import { TitleScreen } from './ui/screens/TitleScreen.js';
import { PlayScreen } from './ui/PlayScreen.js';
import './styles.css';

export interface AppProps {
  readonly fetcher?: typeof fetch;
  /** Test-only escape hatch: lets tests swap in an in-memory `SessionStorageLike` instead of the
   * real `window.sessionStorage`, exactly like `PlayScreen`'s `tier` prop. */
  readonly storage?: SessionStorageLike;
}

/**
 * The client-side screen state machine: title (the landing menu) -> chargen (the wizard) -> play
 * (the live run) -> conclusion (payload wiring lands in a later task) -> hall (the Hall of
 * Records, reachable from either title or conclusion, hence `returnTo`).
 */
export type ScreenState =
  | { readonly screen: 'title' }
  | { readonly screen: 'chargen' }
  | { readonly screen: 'play' }
  | { readonly screen: 'conclusion' }
  | { readonly screen: 'hall'; readonly returnTo: 'title' | 'conclusion' };

/** Where the confirmed portrait glyph is persisted: client-only cosmetic side-state, never engine
 * data, saved at chargen confirm and read back on Continue. */
export const PORTRAIT_KEY = 'woven-deep.guest-portrait';

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

/** Wording for the dismissible fresh/restored/save-discarded banner. Storage notices never reach
 * this — they get their own persistent, non-dismissible warning (see `storageWarningMessage`). */
function noticeMessage(notice: DismissibleNotice): string {
  if (notice.kind === 'fresh') return 'A new run has begun.';
  if (notice.kind === 'restored') return 'Welcome back — your run was restored.';
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
  readonly portraitGlyph: string | undefined;
  readonly onConcluded: (projection: RunConclusionProjection, logTail: readonly LogLine[]) => void;
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
function GameRoot({ session, pack, repository, portraitGlyph, onConcluded }: GameRootProps): JSX.Element {
  const snapshot = useGuestSession(session);
  const [dismissed, setDismissed] = useState(false);
  const { notice, conclusion } = snapshot;
  const finalizedRef = useRef(false);

  useEffect(() => {
    setDismissed(false);
  }, [notice]);

  useEffect(() => {
    if (conclusion === null || finalizedRef.current) return;
    finalizedRef.current = true;
    const projection = session.finalizeConcludedRun(repository, {
      achievedAt: `Run #${repository.records().length + 1}`,
      portraitGlyph: portraitGlyph ?? '@',
    });
    onConcluded(projection, session.getSnapshot().log.slice(-CONCLUSION_LOG_TAIL));
  }, [conclusion, onConcluded, portraitGlyph, repository, session]);

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
      <PlayScreen session={session} pack={pack} />
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
export function App({ fetcher = fetch, storage: storageOverride }: AppProps): JSX.Element {
  const [pack, setPack] = useState<CompiledContentPack>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

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

  const storage = useMemo(() => storageOverride ?? browserSessionStorage(), [storageOverride]);

  // The session-scoped Hall of Records repository. A corrupt blob throws `SessionHallCorruptError`
  // at construction; the module itself clears the storage key back to a fresh, empty Hall before
  // throwing, so retrying the SAME construction immediately below always succeeds. The active run
  // (an entirely separate storage key) is untouched either way — only a notice is surfaced.
  const [repository, hallNotice] = useMemo((): readonly [RunRecordRepository, string | null] => {
    try {
      return [createSessionRunRecordRepository(storage), null] as const;
    } catch (thrown) {
      if (thrown instanceof SessionHallCorruptError) {
        return [createSessionRunRecordRepository(storage), thrown.message] as const;
      }
      throw thrown;
    }
  }, [storage]);

  const [screen, setScreen] = useState<ScreenState>(
    () => (isQuickstart(window.location.search) ? { screen: 'play' } : { screen: 'title' }),
  );
  const [session, setSession] = useState<GuestSession>();
  const [chargenSeed, setChargenSeed] = useState<Uint32State>();
  const [portraitGlyph, setPortraitGlyph] = useState<string>();
  const [conclusion, setConclusion] = useState<{
    projection: RunConclusionProjection; logTail: readonly LogLine[];
  }>();

  /** Wraps every post-boot screen with the persistent Hall-corruption notice, when one is
   * pending — the active run survives regardless; only the Hall itself was reset. */
  function withHallNotice(children: JSX.Element): JSX.Element {
    if (!hallNotice) return children;
    return (
      <>
        <div role="alert" aria-label="Hall notice" className="storage-warning-banner" data-kind="hall-corrupt">
          <p>Your Hall of Records could not be read and has been reset. ({hallNotice})</p>
        </div>
        {children}
      </>
    );
  }

  // Quickstart's session is constructed once the pack is ready (it can't be constructed at the
  // `useState` initializer above — the pack isn't loaded yet at first render).
  useEffect(() => {
    if (!pack || session) return;
    if (!isQuickstart(window.location.search)) return;
    const seed = parseSeedFromQuery(window.location.search);
    setSession(seed ? new GuestSession({ pack, storage, seed }) : new GuestSession({ pack, storage }));
  }, [pack, storage, session]);

  if (error) {
    return (
      <main className="shell boot-error">
        <p className="eyebrow">The Woven Deep</p>
        <h1>The archive would not answer.</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => setAttempt((count) => count + 1)}>Retry</button>
      </main>
    );
  }

  if (!pack) {
    return (
      <main className="shell boot-loading">
        <p className="eyebrow">The Woven Deep</p>
        <p role="status">Binding the current content pack…</p>
      </main>
    );
  }

  if (screen.screen === 'title') {
    return withHallNotice(
      <main className="shell">
        <TitleScreen
          storage={storage}
          onEnterTheDeep={() => {
            setChargenSeed(parseSeedFromQuery(window.location.search) ?? randomSeed());
            setScreen({ screen: 'chargen' });
          }}
          onContinue={() => {
            setPortraitGlyph(storage.get(PORTRAIT_KEY) ?? undefined);
            setSession(new GuestSession({ pack, storage }));
            setScreen({ screen: 'play' });
          }}
          onHall={() => setScreen({ screen: 'hall', returnTo: 'title' })}
        />
      </main>,
    );
  }

  if (screen.screen === 'chargen') {
    // `chargenSeed` is always set before this screen is reached (see `onEnterTheDeep` above).
    const seed = chargenSeed!;
    return withHallNotice(
      <ChargenScreen
        pack={pack}
        seed={seed}
        onConfirm={(choices: HeroChoices, glyph: string) => {
          const hero = heroFromChoices({ pack, choices });
          try {
            storage.set(PORTRAIT_KEY, glyph);
          } catch {
            // Best-effort, same as every other portrait/cosmetic persistence attempt in this app —
            // the run itself is unaffected if this particular write fails.
          }
          setPortraitGlyph(glyph);
          setSession(new GuestSession({ pack, storage, seed, hero }));
          setScreen({ screen: 'play' });
        }}
      />,
    );
  }

  if (screen.screen === 'hall') {
    const { returnTo } = screen;
    return withHallNotice(
      <main className="shell">
        <HallScreen repository={repository} onBack={() => setScreen({ screen: returnTo })} />
      </main>,
    );
  }

  if (screen.screen === 'conclusion') {
    // `conclusion` is always set before this screen is reached — `GameRoot`'s `onConcluded`
    // (below) sets both together, in the same event.
    if (!conclusion) {
      return withHallNotice(
        <main className="shell boot-loading">
          <p className="eyebrow">The Woven Deep</p>
          <p role="status">The run has ended.</p>
        </main>,
      );
    }
    return withHallNotice(
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
    );
  }

  if (!session) {
    return withHallNotice(
      <main className="shell boot-loading">
        <p className="eyebrow">The Woven Deep</p>
        <p role="status">Binding the current content pack…</p>
      </main>,
    );
  }

  return withHallNotice(
    <GameRoot
      session={session}
      pack={pack}
      repository={repository}
      portraitGlyph={portraitGlyph}
      onConcluded={(projection, logTail) => {
        setConclusion({ projection, logTail });
        setScreen({ screen: 'conclusion' });
      }}
    />,
  );
}
