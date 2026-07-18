import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO, createNewRun, projectGameplayState,
  type ActiveRun, type GameplayProjection,
} from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import { DEFAULT_SETTINGS } from '../../session/settings.js';
import { UiProviders } from '../providers.js';
import { InventoryOverlay, type ProjectedItemLike } from './InventoryOverlay.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../../../content') });
  const baseRun: ActiveRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: baseRun, content: pack });
});

function item(overrides: Readonly<Partial<ProjectedItemLike>> & Pick<ProjectedItemLike, 'itemId' | 'name' | 'category'>): ProjectedItemLike {
  return {
    quantity: 1, identified: true, condition: 100, fuel: null, enabled: null,
    ...overrides,
  };
}

function snapshotWithBackpack(
  items: readonly ProjectedItemLike[],
  equipment: Readonly<Record<string, ProjectedItemLike | null>> = {},
): SessionSnapshot {
  return {
    projection: {
      ...baseProjection,
      hero: { ...baseProjection.hero, backpack: items, equipment },
    } as unknown as GameplayProjection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    notice: null,
    houseOpen: false,
    conclusion: null, sightings: { monsterIds: [], itemIds: [], landmarks: [] }, heroClassTags: [], onboarding: { counts: {}, dismissed: [] },
  };
}

function stubSession(snapshot: SessionSnapshot): { session: GuestSession; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn();
  const session = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    dispatch,
  } as unknown as GuestSession;
  return { session, dispatch };
}

function renderInventory(session: GuestSession) {
  return render(
    <UiProviders pack={pack} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}} session={session}>
      <InventoryOverlay />
    </UiProviders>,
  );
}

describe('InventoryOverlay (structure 1: ListDetail-based drawer)', () => {
  it('shows the equipped slot-grid with the weapon glyph', () => {
    const snapshot = snapshotWithBackpack(
      [],
      { 'main-hand': item({ itemId: 'item.sword', name: 'Iron sword', category: 'weapon' }) },
    );
    const { session } = stubSession(snapshot);
    renderInventory(session);

    expect(screen.getByText('Main hand')).toBeInTheDocument();
    expect(screen.getByText(') Iron sword')).toBeInTheDocument();
  });

  it('lists the pack items by label in the listbox', () => {
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.torch', name: 'Torch', category: 'light' }),
      item({ itemId: 'item.potion', name: 'Potion', category: 'potion' }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    const list = within(screen.getByRole('listbox', { name: 'Backpack items' }));
    expect(list.getByText('Torch')).toBeInTheDocument();
    expect(list.getByText('Potion')).toBeInTheDocument();
  });

  it('shows an EQ badge for an equipped item in the pack list', () => {
    const snapshot = snapshotWithBackpack(
      [item({ itemId: 'item.ration', name: 'Travel ration', category: 'food' })],
      { 'main-hand': item({ itemId: 'item.sword', name: 'Iron sword', category: 'weapon' }) },
    );
    const { session } = stubSession(snapshot);
    renderInventory(session);

    const list = within(screen.getByRole('listbox', { name: 'Backpack items' }));
    const options = list.getAllByRole('option');
    // Backpack stack first, then the equipped item -- same default ordering as before.
    expect(options[0]).toHaveTextContent('Travel ration');
    expect(options[1]).toHaveTextContent('Iron sword');
    expect(options[1]).toHaveTextContent('EQ');
    expect(options[0]).not.toHaveTextContent('EQ');
  });

  it('pressing e on the selected equipped item dispatches unequip', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack(
      [item({ itemId: 'item.ration', name: 'Travel ration', category: 'food' })],
      { 'main-hand': item({ itemId: 'item.sword', name: 'Iron sword', category: 'weapon' }) },
    );
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session);

    const list = within(screen.getByRole('listbox', { name: 'Backpack items' }));
    await user.click(list.getByRole('option', { name: /Iron sword/ }));
    await user.keyboard('e');

    expect(dispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'unequip', itemId: 'item.sword' });
  });

  it('pressing e on a selected unequipped item dispatches equip', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.torch', name: 'Torch', category: 'light' }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session);

    await user.keyboard('e');
    expect(dispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'equip', itemId: 'item.torch' });
  });

  it('pressing d dispatches drop for the selected item', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.torch', name: 'Torch', category: 'light' }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session);

    await user.keyboard('d');
    expect(dispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'drop', itemId: 'item.torch' });
  });

  it('pressing u dispatches use, and l dispatches toggle-light, for the selected item', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.torch', name: 'Torch', category: 'light' }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session);

    await user.keyboard('u');
    expect(dispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'use', itemId: 'item.torch' });
    await user.keyboard('l');
    expect(dispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'toggle-light', itemId: 'item.torch' });
  });

  it('the category filter toolbar button cycles through categories and back to all', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.sword', name: 'Sword', category: 'weapon' }),
      item({ itemId: 'item.shield', name: 'Shield', category: 'shield' }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    const list = within(screen.getByRole('listbox', { name: 'Backpack items' }));
    expect(list.getByText('Sword')).toBeInTheDocument();
    expect(list.getByText('Shield')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Filter: All/ }));
    expect(screen.getByRole('button', { name: /Filter: Weapons/ })).toBeInTheDocument();
    expect(list.getByText('Sword')).toBeInTheDocument();
    expect(list.queryByText('Shield')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Filter: Weapons/ }));
    expect(screen.getByRole('button', { name: /Filter: Armor/ })).toBeInTheDocument();
    expect(list.getByText('Shield')).toBeInTheDocument();
  });

  it('the sort toolbar button toggles a stable, locale-free name sort', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.zebra', name: 'Zebra pelt', category: 'misc' }),
      item({ itemId: 'item.apple', name: 'Apple', category: 'food' }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    const list = within(screen.getByRole('listbox', { name: 'Backpack items' }));
    let options = list.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Zebra pelt');
    expect(options[1]).toHaveTextContent('Apple');

    await user.click(screen.getByRole('button', { name: /Sort: Default/ }));
    options = list.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Apple');
    expect(options[1]).toHaveTextContent('Zebra pelt');
  });

  it('renders nothing when there is no session in context', () => {
    const { container } = render(
      <UiProviders pack={pack} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}}>
        <InventoryOverlay />
      </UiProviders>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
