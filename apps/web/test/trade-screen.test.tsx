import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState, type GameplayProjection } from '@woven-deep/engine';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { TradeScreen } from '../src/ui/screens/TradeScreen.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

function snapshotOf(projection: GameplayProjection): SessionSnapshot {
  return {
    projection, log: [], lastEvents: [], pendingDecision: null, notice: null,
    backpackOpen: false, houseOpen: false, conclusion: null,
  };
}

function withTrade(
  projection: GameplayProjection, overrides: Partial<NonNullable<GameplayProjection['trade']>> = {},
): GameplayProjection {
  return {
    ...projection,
    trade: {
      merchantPopulationId: 'population.town-provisioner',
      merchantActorId: 'actor.population.town-provisioner.001',
      merchantName: 'Provisioner',
      factionName: 'Provisioners Guild',
      reputationTier: 'neutral',
      currency: 100,
      stock: [],
      saleOffers: [],
      services: [],
      ...overrides,
    },
  };
}

describe('TradeScreen', () => {
  it('renders nothing when the projection has no active trade', () => {
    const { container } = render(
      <TradeScreen snapshot={snapshotOf(baseProjection)} onDispatch={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the merchant name, reputation, and a live currency readout', () => {
    const projection = withTrade(baseProjection, { currency: 42 });
    render(<TradeScreen snapshot={snapshotOf(projection)} onDispatch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();
    expect(screen.getByText('Provisioner')).toBeInTheDocument();
    expect(screen.getByText('neutral')).toBeInTheDocument();
    expect(screen.getByText('42g')).toBeInTheDocument();
  });

  it('dispatches trade-buy for the selected stock entry on Enter (keyboard-only)', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const projection = withTrade(baseProjection, {
      stock: [{ item: { itemId: 'item.stock-ration', name: 'Travel ration' }, quantity: 5, unitPrice: 3 }],
    });
    render(<TradeScreen snapshot={snapshotOf(projection)} onDispatch={onDispatch} onClose={vi.fn()} />);

    await user.keyboard('{Enter}');

    expect(onDispatch).toHaveBeenCalledWith({ type: 'trade-buy', itemId: 'item.stock-ration', quantity: 1 });
  });

  it('switches focus to the sell list on Tab and dispatches trade-sell for the selected offer', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const backpack = baseProjection.hero as unknown as { backpack: readonly { itemId: string; name: string }[] };
    const ration = backpack.backpack.find((item) => item.name.toLowerCase().includes('ration'))!;
    const projection = withTrade(baseProjection, {
      saleOffers: [{ itemId: ration.itemId, quantity: 1, unitPrice: 2 }],
    });
    render(<TradeScreen snapshot={snapshotOf(projection)} onDispatch={onDispatch} onClose={vi.fn()} />);

    await user.keyboard('{Tab}');
    // The sell row displays the offer's name resolved from the hero's own backpack projection.
    expect(screen.getByText(new RegExp(ration.name))).toBeInTheDocument();
    await user.keyboard('{Enter}');

    expect(onDispatch).toHaveBeenCalledWith({ type: 'trade-sell', itemId: ration.itemId, quantity: 1 });
  });

  it('switches focus to the services list on Tab+Tab and dispatches trade-service (targetless strongbox)', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const projection = withTrade(baseProjection, {
      services: [{
        serviceId: 'merchant-service.strongbox', unitPrice: 120, remainingUses: 1, targetItemIds: [],
      }],
    });
    render(<TradeScreen snapshot={snapshotOf(projection)} onDispatch={onDispatch} onClose={vi.fn()} />);

    await user.keyboard('{Tab}{Tab}');
    await user.keyboard('{Enter}');

    expect(onDispatch).toHaveBeenCalledWith({
      type: 'trade-service', serviceId: 'merchant-service.strongbox', targetItemId: null,
    });
  });

  it('dispatches trade-service with a target item for an identify-style service', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const projection = withTrade(baseProjection, {
      services: [{
        serviceId: 'merchant-service.identify', unitPrice: 10, remainingUses: 2,
        targetItemIds: ['item.mystery-ring'],
      }],
    });
    render(<TradeScreen snapshot={snapshotOf(projection)} onDispatch={onDispatch} onClose={vi.fn()} />);

    await user.keyboard('{Tab}{Tab}');
    await user.keyboard('{Enter}');

    expect(onDispatch).toHaveBeenCalledWith({
      type: 'trade-service', serviceId: 'merchant-service.identify', targetItemId: 'item.mystery-ring',
    });
  });

  it('moves the selection within the focused list with ArrowUp/ArrowDown', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const projection = withTrade(baseProjection, {
      stock: [
        { item: { itemId: 'item.stock-a', name: 'Item A' }, quantity: 1, unitPrice: 1 },
        { item: { itemId: 'item.stock-b', name: 'Item B' }, quantity: 1, unitPrice: 1 },
      ],
    });
    render(<TradeScreen snapshot={snapshotOf(projection)} onDispatch={onDispatch} onClose={vi.fn()} />);

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onDispatch).toHaveBeenCalledWith({ type: 'trade-buy', itemId: 'item.stock-b', quantity: 1 });
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const projection = withTrade(baseProjection);
    render(<TradeScreen snapshot={snapshotOf(projection)} onDispatch={vi.fn()} onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('unmounts cleanly when the session closes the trade (projection.trade goes undefined)', () => {
    const projection = withTrade(baseProjection);
    const { rerender, container } = render(
      <TradeScreen snapshot={snapshotOf(projection)} onDispatch={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();

    rerender(<TradeScreen snapshot={snapshotOf(baseProjection)} onDispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole('dialog', { name: 'Trade' })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
