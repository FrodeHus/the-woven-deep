import type { ReactElement } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { UiProviders } from '../src/ui/providers.js';
import { DEFAULT_SETTINGS, type Settings } from '../src/session/settings.js';

/**
 * Test-only wrapper mirroring the single `UiProviders` `App` renders around the whole
 * authenticated tree -- for specs that mount `PlayScreen` (or anything else reading
 * `useSettingsCtx`/`usePack`) standalone instead of through `App`.
 */
export function withUiProviders(
  pack: CompiledContentPack,
  ui: ReactElement,
  settings: Settings = DEFAULT_SETTINGS,
): ReactElement {
  return (
    <UiProviders pack={pack} settings={settings} onChangeSettings={() => {}}>
      {ui}
    </UiProviders>
  );
}
