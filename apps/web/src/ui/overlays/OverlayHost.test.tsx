import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { CompiledContentPack, MonsterContentEntry } from '@woven-deep/content';
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

  it('sources the codex body from the sightings prop when no session is present (title screen)', async () => {
    const user = userEvent.setup();
    const caveRat: MonsterContentEntry = {
      id: 'monster.cave-rat', kind: 'monster', name: 'Cave Rat', tags: [], glyph: 'r', color: '#a00',
      attributes: { might: 1, agility: 1, vitality: 1, wits: 1, resolve: 1 }, health: 4, speed: 1, accuracy: 1,
      defense: 1, perception: 1, damage: { count: 1, sides: 4, bonus: 0 }, armor: 0,
      resistances: {} as MonsterContentEntry['resistances'], disposition: 'hostile', behaviorId: 'behavior.approach-and-attack',
      behaviorParameters: {}, minDepth: 1, maxDepth: 1, threat: 1, rarity: 'common',
      lootTableId: null, dropChance: 1,
    };
    const pack = { entries: [caveRat] } as unknown as CompiledContentPack;

    render(
      <UiProviders pack={pack} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}}>
        <OverlayHost
          overlay="codex"
          onClose={() => {}}
          isPlayActive={false}
          records={[]}
          sightings={{ monsterIds: ['monster.cave-rat'], itemIds: [], landmarks: [] }}
        />
      </UiProviders>,
    );

    await user.click(screen.getByRole('tab', { name: /monsters/i }));
    expect(screen.getByRole('option', { name: /cave rat/i })).toBeInTheDocument();
  });
});
