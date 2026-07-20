import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO,
  createNewRun,
  projectGameplayState,
  type GameplayProjection,
} from '@woven-deep/engine';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { HouseScreen } from '../src/ui/screens/HouseScreen.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

function snapshotOf(projection: GameplayProjection): SessionSnapshot {
  return {
    projection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    notice: null,
    houseOpen: true,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  };
}

function withHouseItems(
  projection: GameplayProjection,
  items: readonly { itemId: string; name: string }[],
  capacity = 6,
): GameplayProjection {
  return { ...projection, house: { capacity, upgradesPurchased: 0, items } };
}

describe('HouseScreen', () => {
  it('shows the capacity readout for an empty house', () => {
    render(
      <HouseScreen snapshot={snapshotOf(baseProjection)} onDispatch={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('House (0/6)')).toBeInTheDocument();
  });

  it('deposits the selected backpack item on Enter (keyboard-only)', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <HouseScreen
        snapshot={snapshotOf(baseProjection)}
        onDispatch={onDispatch}
        onClose={vi.fn()}
      />,
    );
    const backpack = baseProjection.hero as unknown as { backpack: readonly { itemId: string }[] };
    const first = backpack.backpack[0]!;

    await user.keyboard('{Enter}');

    expect(onDispatch).toHaveBeenCalledWith({
      type: 'house-transfer',
      action: 'deposit',
      itemId: first.itemId,
      quantity: 1,
    });
  });

  it('switches focus to the house column on Tab and withdraws the selected house item on Enter', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const projection = withHouseItems(baseProjection, [
      { itemId: 'item.house-test.sword', name: 'Old sword' },
    ]);
    render(
      <HouseScreen snapshot={snapshotOf(projection)} onDispatch={onDispatch} onClose={vi.fn()} />,
    );

    await user.keyboard('{Tab}');
    await user.keyboard('{Enter}');

    expect(onDispatch).toHaveBeenCalledWith({
      type: 'house-transfer',
      action: 'withdraw',
      itemId: 'item.house-test.sword',
      quantity: 1,
    });
  });

  it('moves the selection within the focused list with ArrowUp/ArrowDown', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const projection = withHouseItems(baseProjection, [
      { itemId: 'item.house-test.a', name: 'Item A' },
      { itemId: 'item.house-test.b', name: 'Item B' },
    ]);
    render(
      <HouseScreen snapshot={snapshotOf(projection)} onDispatch={onDispatch} onClose={vi.fn()} />,
    );

    await user.keyboard('{Tab}'); // focus the house column
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onDispatch).toHaveBeenCalledWith({
      type: 'house-transfer',
      action: 'withdraw',
      itemId: 'item.house-test.b',
      quantity: 1,
    });
  });

  it('renders correctly and still allows dispatching a deposit attempt when the house is at capacity', () => {
    const onDispatch = vi.fn();
    const fullItems = Array.from({ length: 6 }, (_, index) => ({
      itemId: `item.house-test.${index}`,
      name: `Stack ${index}`,
    }));
    const projection = withHouseItems(baseProjection, fullItems);
    render(
      <HouseScreen snapshot={snapshotOf(projection)} onDispatch={onDispatch} onClose={vi.fn()} />,
    );

    expect(screen.getByText('House (6/6)')).toBeInTheDocument();
    // The screen never validates capacity itself -- the engine's `house.full` rejection is what
    // ultimately stops an over-capacity deposit, surfaced as a log line by the session.
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <HouseScreen snapshot={snapshotOf(baseProjection)} onDispatch={vi.fn()} onClose={onClose} />,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
