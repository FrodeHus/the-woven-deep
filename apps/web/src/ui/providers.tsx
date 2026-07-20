import { createContext, useContext, useMemo, type JSX, type ReactNode } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GuestSession, SessionSnapshot } from '../session/guest-session.js';
import { resolveKeymap, type ResolvedKeymap, type Settings } from '../session/settings.js';
import { useGuestSession } from '../session/store.js';

const PackContext = createContext<CompiledContentPack | null>(null);
const SettingsContext = createContext<{
  settings: Settings; onChange: (next: Settings) => void; keymap: ResolvedKeymap;
} | null>(null);
const SessionContext = createContext<{ session: GuestSession; snapshot: SessionSnapshot } | null>(null);

export function usePack(): CompiledContentPack {
  const value = useContext(PackContext);
  if (!value) throw new Error('usePack must be used within UiProviders');
  return value;
}

export function useSettingsCtx(): { readonly settings: Settings; readonly onChange: (next: Settings) => void; readonly keymap: ResolvedKeymap } {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettingsCtx must be used within UiProviders');
  return value;
}

export function useSessionCtx(): { readonly session: GuestSession; readonly snapshot: SessionSnapshot } | null {
  return useContext(SessionContext);
}

function SessionBridge({ session, children }: Readonly<{ session: GuestSession; children: ReactNode }>): JSX.Element {
  const snapshot = useGuestSession(session);
  return <SessionContext.Provider value={{ session, snapshot }}>{children}</SessionContext.Provider>;
}

export function UiProviders({ pack, settings, onChangeSettings, session, children }: Readonly<{
  pack: CompiledContentPack;
  settings: Settings;
  onChangeSettings: (next: Settings) => void;
  session?: GuestSession | undefined;
  children: ReactNode;
}>): JSX.Element {
  const settingsValue = useMemo(
    () => ({ settings, onChange: onChangeSettings, keymap: resolveKeymap(settings.bindings) }),
    [settings, onChangeSettings],
  );
  const tree = session ? <SessionBridge session={session}>{children}</SessionBridge> : children;
  return (
    <PackContext.Provider value={pack}>
      <SettingsContext.Provider value={settingsValue}>{tree}</SettingsContext.Provider>
    </PackContext.Provider>
  );
}
