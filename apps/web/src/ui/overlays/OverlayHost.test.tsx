import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { CompiledContentPack } from '@woven-deep/content';
import { OverlayHost } from './OverlayHost.js';
import { UiProviders } from '../providers.js';
import { DEFAULT_SETTINGS } from '../../session/settings.js';

function renderHost(overlay: 'help' | null, onClose = vi.fn()) {
  const pack = { entries: [] } as unknown as CompiledContentPack;
  return {
    onClose,
    ...render(
      <UiProviders pack={pack} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}}>
        <OverlayHost overlay={overlay} onClose={onClose} isPlayActive={false} />
      </UiProviders>,
    ),
  };
}

describe('OverlayHost', () => {
  it('renders nothing when overlay is null', () => {
    renderHost(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a global overlay as a dialog and closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderHost('help');
    expect(screen.getByRole('dialog', { name: /help/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
