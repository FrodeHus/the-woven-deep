import { useEffect, useMemo, useState, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { Uint32State } from '@woven-deep/engine';
import { loadContentPack } from './api.js';
import { GuestSession, type SessionNotice } from './session/guest-session.js';
import { useGuestSession } from './session/store.js';
import { browserSessionStorage, type SessionStorageLike } from './session/storage.js';
import { PlayScreen } from './ui/PlayScreen.js';
import './styles.css';

export interface AppProps {
  readonly fetcher?: typeof fetch;
  /** Test-only escape hatch: lets tests swap in an in-memory `SessionStorageLike` instead of the
   * real `window.sessionStorage`, exactly like `PlayScreen`'s `tier` prop. */
  readonly storage?: SessionStorageLike;
}

/**
 * Test-only seed override: `?seed=11.22.33.44` (four dot-separated `Uint32` words) pins the
 * fresh run's RNG instead of the ambient `crypto.getRandomValues` seed `GuestSession` otherwise
 * generates. Never a real feature — no UI links to it, and it's parsed straight out of
 * `location.search`, so it only ever matters to a test (or a developer poking at the URL bar).
 */
function parseSeedFromQuery(search: string): Uint32State | undefined {
  const raw = new URLSearchParams(search).get('seed');
  if (!raw) return undefined;
  const words = raw.split('.').map(Number);
  if (words.length !== 4 || words.some((word) => !Number.isFinite(word))) return undefined;
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

interface GameRootProps {
  readonly session: GuestSession;
  readonly pack: CompiledContentPack;
}

/** Everything that needs a live `GuestSession` snapshot: the notice banners and the play screen
 * itself. Split out from `App` so `useGuestSession` (a hook) is only ever called once a session
 * actually exists — `App` renders this conditionally, not the hook.
 *
 * Storage notices (unavailable/full) get their own persistent, non-dismissible `role="alert"`
 * warning per the design spec — play continues unsaved, but the player must keep seeing that.
 * Every other notice (fresh/restored/save-discarded) stays a dismissible `role="status"` banner. */
function GameRoot({ session, pack }: GameRootProps): JSX.Element {
  const snapshot = useGuestSession(session);
  const [dismissed, setDismissed] = useState(false);
  const { notice } = snapshot;

  useEffect(() => {
    setDismissed(false);
  }, [notice]);

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
 * Boots the guest client: fetches the compiled content pack, then constructs the single
 * `GuestSession` for this browser tab (restoring from storage if a save is present) and hands off
 * to `PlayScreen`. Distinct screens for the two ways boot can go wrong: the pack fetch failing
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
  const session = useMemo(() => {
    if (!pack) return undefined;
    const seed = parseSeedFromQuery(window.location.search);
    return seed ? new GuestSession({ pack, storage, seed }) : new GuestSession({ pack, storage });
  }, [pack, storage]);

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

  if (!session || !pack) {
    return (
      <main className="shell boot-loading">
        <p className="eyebrow">The Woven Deep</p>
        <p role="status">Binding the current content pack…</p>
      </main>
    );
  }

  return <GameRoot session={session} pack={pack} />;
}
