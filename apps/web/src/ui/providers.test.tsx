import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UiProviders, usePack, useSettingsCtx, useSessionCtx } from './providers.js';
import { DEFAULT_SETTINGS } from '../session/settings.js';

function Probe() {
  const pack = usePack() as unknown as { id: string };
  const { keymap } = useSettingsCtx();
  const session = useSessionCtx();
  return <output>{pack.id}:{keymap.byAction.inventory.key}:{session ? 'session' : 'none'}</output>;
}

describe('UiProviders', () => {
  it('exposes pack, resolved keymap, and null session when none given', () => {
    const pack = { id: 'core' } as never;
    render(
      <UiProviders pack={pack} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}}>
        <Probe />
      </UiProviders>,
    );
    expect(screen.getByRole('status').textContent).toBe('core:i:none');
  });
});
