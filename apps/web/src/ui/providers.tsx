import { createContext, useContext, useMemo, type JSX, type ReactNode } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { RunRecordRepository } from '@woven-deep/engine';
import type { SessionSnapshot } from '../session/guest-session.js';
import type { RunSession } from '../session/run-session.js';
import { resolveKeymap, type ResolvedKeymap, type Settings } from '../session/settings.js';
import { useOptionalRunSession } from '../session/store.js';

const PackContext = createContext<CompiledContentPack | null>(null);
const SettingsContext = createContext<{
  settings: Settings;
  onChange: (next: Settings) => void;
  keymap: ResolvedKeymap;
} | null>(null);
const SessionContext = createContext<{ session: RunSession; snapshot: SessionSnapshot } | null>(
  null,
);
const RepositoryContext = createContext<RunRecordRepository | null>(null);

export function usePack(): CompiledContentPack {
  const value = useContext(PackContext);
  if (!value) throw new Error('usePack must be used within UiProviders');
  return value;
}

export function useSettingsCtx(): {
  readonly settings: Settings;
  readonly onChange: (next: Settings) => void;
  readonly keymap: ResolvedKeymap;
} {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettingsCtx must be used within UiProviders');
  return value;
}

/**
 * The profile's records repository, or `null` where none is mounted (the pre-boot tree, and every
 * test that renders an overlay without one). Cross-run history -- the Hall records and the artifact
 * ledger -- lives here rather than in a projection: the engine never holds the ledger, so an
 * overlay that wants an artifact's provenance joins it client-side off this repository.
 */
export function useRecordsRepository(): RunRecordRepository | null {
  return useContext(RepositoryContext);
}

export function useSessionCtx(): {
  readonly session: RunSession;
  readonly snapshot: SessionSnapshot;
} | null {
  return useContext(SessionContext);
}

/** Always mounted, session or not: a layer that appears only once a session exists would change
 * the element type at this tree position the moment one is set, and React would then unmount and
 * remount every screen below it -- detaching the exact element the player is clicking when a
 * profile's held connection resolves under the title menu (#200). With no session the context
 * value is simply `null`, which is what `useSessionCtx` already hands to sessionless callers. */
function SessionBridge({
  session,
  children,
}: Readonly<{ session: RunSession | undefined; children: ReactNode }>): JSX.Element {
  const snapshot = useOptionalRunSession(session);
  const value = useMemo(
    () => (session && snapshot ? { session, snapshot } : null),
    [session, snapshot],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function UiProviders({
  pack,
  settings,
  onChangeSettings,
  session,
  repository,
  children,
}: Readonly<{
  pack: CompiledContentPack;
  settings: Settings;
  onChangeSettings: (next: Settings) => void;
  session?: RunSession | undefined;
  /** Optional so every pre-existing caller/test keeps compiling: without one, `useRecordsRepository`
   * yields `null` and the features that read cross-run history simply render nothing. */
  repository?: RunRecordRepository | undefined;
  children: ReactNode;
}>): JSX.Element {
  const settingsValue = useMemo(
    () => ({ settings, onChange: onChangeSettings, keymap: resolveKeymap(settings.bindings) }),
    [settings, onChangeSettings],
  );
  return (
    <PackContext.Provider value={pack}>
      <SettingsContext.Provider value={settingsValue}>
        <RepositoryContext.Provider value={repository ?? null}>
          <SessionBridge session={session}>{children}</SessionBridge>
        </RepositoryContext.Provider>
      </SettingsContext.Provider>
    </PackContext.Provider>
  );
}
