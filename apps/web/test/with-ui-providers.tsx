import type { ReactElement } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { UiProviders } from '../src/ui/providers.js';
import type { RunSession } from '../src/session/run-session.js';
import { DEFAULT_SETTINGS, type Settings } from '../src/session/settings.js';

/**
 * Test-only wrapper mirroring the single `UiProviders` `App` renders around the whole
 * authenticated tree -- for specs that mount `PlayScreen` (or anything else reading
 * `useSettingsCtx`/`usePack`) standalone instead of through `App`. Pass `session` when a spec needs
 * the session context too (e.g. the command palette's cast entries read it via `useSessionCtx`).
 */
export function withUiProviders(
  pack: CompiledContentPack,
  ui: ReactElement,
  settings: Settings = DEFAULT_SETTINGS,
  session?: RunSession,
): ReactElement {
  return (
    <UiProviders
      pack={pack}
      settings={settings}
      onChangeSettings={() => {}}
      {...(session ? { session } : {})}
    >
      {ui}
    </UiProviders>
  );
}
