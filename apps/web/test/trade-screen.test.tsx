import { resolve } from 'node:path';
import { useState, type JSX } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO, createNewRun, heroActor, heroPerception, projectGameplayState, refreshKnowledge,
  resolveCommand, validateActiveRun, type ActiveRun, type FloorSnapshot, type GameCommand,
  type GameplayProjection, type ItemInstance, type MerchantPopulation,
} from '@woven-deep/engine';
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
    houseOpen: false, conclusion: null, sightings: { monsterIds: [], itemIds: [] }, heroClassTags: [],
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

  it('opens the identify target picker for a service with eligible targets, then dispatches the chosen target', async () => {
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

    // Enter on a service with eligible targets opens the picker instead of dispatching immediately.
    expect(onDispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox', { name: 'Identify target' })).toBeInTheDocument();

    await user.keyboard('{Enter}');

    expect(onDispatch).toHaveBeenCalledWith({
      type: 'trade-service', serviceId: 'merchant-service.identify', targetItemId: 'item.mystery-ring',
    });
    expect(screen.queryByRole('listbox', { name: 'Identify target' })).not.toBeInTheDocument();
  });

  it('closes the picker on Escape without closing the trade dialog', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const onClose = vi.fn();
    const projection = withTrade(baseProjection, {
      services: [{
        serviceId: 'merchant-service.identify', unitPrice: 10, remainingUses: 2,
        targetItemIds: ['item.mystery-ring', 'item.mystery-potion'],
      }],
    });
    render(<TradeScreen snapshot={snapshotOf(projection)} onDispatch={onDispatch} onClose={onClose} />);

    await user.keyboard('{Tab}{Tab}');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox', { name: 'Identify target' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(onDispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox', { name: 'Identify target' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Services' })).toBeInTheDocument();
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

function townFloor(run: ActiveRun): FloorSnapshot {
  return run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
}

/** Mirrors the identical helper in `trade-close-escape.test.tsx`: teleports the hero and refreshes
 * the active floor's knowledge in place, since `trade-open` requires the merchant to be visible. */
function teleportHero(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  const moved: ActiveRun = {
    ...run,
    actors: run.actors.map((actor) => actor.actorId === hero.actorId ? { ...actor, ...position } : actor),
  };
  const floor = townFloor(moved);
  const movedHero = heroActor(moved);
  const knowledge = refreshKnowledge({
    floor, hero: heroPerception(moved.hero, movedHero),
    actors: new Map(moved.actors.filter((actor) => actor.floorId === floor.floorId).map((actor) => [actor.actorId, actor] as const)),
  }).knowledge;
  return validateActiveRun({
    ...moved,
    floors: moved.floors.map((candidate) => candidate.floorId === floor.floorId ? { ...candidate, knowledge } : candidate),
  });
}

/** Stands the hero directly beside (Chebyshev distance 1 from) the given point. */
function adjacentFreeCell(run: ActiveRun, target: Readonly<{ x: number; y: number }>): Readonly<{ x: number; y: number }> {
  const floor = townFloor(run);
  const occupied = new Set(run.actors.filter((actor) => actor.floorId === floor.floorId && actor.health > 0)
    .map((actor) => `${actor.x}:${actor.y}`));
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
    if (occupied.has(`${x}:${y}`)) continue;
    return { x, y };
  }
  throw new Error(`test setup failure: cannot stand adjacent to ${target.x}:${target.y}`);
}

function apply(run: ActiveRun, command: GameCommand): ActiveRun {
  const resolved = resolveCommand(run, command, { content: pack });
  if (resolved.result.status !== 'applied') {
    throw new Error(`test setup failure: ${command.type} was not applied (${JSON.stringify(resolved.result)})`);
  }
  return resolved.state;
}

/** Minimal reducer harness: owns the `ActiveRun` in state, re-projects on every dispatch, and
 * forwards each intent straight to the matching real engine command (only the two intents this
 * regression needs -- selling from the sell list, nothing else). This lets the test observe the
 * *actual* list-shrinking-after-sale behavior `TradeScreen` sees in production, rather than a
 * synthetic `withTrade` override. */
function TradeHarness({ initialRun }: { readonly initialRun: ActiveRun }): JSX.Element {
  const [run, setRun] = useState(initialRun);
  const projection = projectGameplayState({ state: run, content: pack });
  return (
    <TradeScreen
      snapshot={snapshotOf(projection)}
      onDispatch={(intent) => {
        if (intent.type !== 'trade-sell') throw new Error(`unexpected intent in harness: ${intent.type}`);
        const merchantPopulationId = projection.trade!.merchantPopulationId;
        setRun((current) => apply(current, {
          type: 'trade-sell', commandId: `command.sell.${intent.itemId}`, expectedRevision: current.revision,
          merchantPopulationId, itemId: intent.itemId, quantity: intent.quantity,
        }));
      }}
      onClose={vi.fn()}
    />
  );
}

// Regression for the reviewer-verified bug: selling the selected sale offer removes it from
// `saleOffers`, and the surviving offer slides into the same list position. `useListNavigation`'s
// refocus effect only re-ran on `selectedIndex` changes, so when the index stayed the same (0) but
// the DOM node at that position was replaced (new key, since the row's text/itemId changed), DOM
// focus was stranded on the detached old button. The next Enter keypress then had nowhere to land
// -- `document.activeElement` falls back to `<body>`, which is outside the dialog's `onKeyDown`
// handler, so the keystroke never reaches `TradeScreen` at all. Fixed by adding `length` to the
// refocus effect's dependency array (roving-focus.ts) so a list-size change also re-triggers focus.
describe('TradeScreen roving focus after a sale shrinks the list', () => {
  it('keeps focus on the surviving offer so a second Enter sells it too', async () => {
    const user = userEvent.setup();
    let run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const armorer = run.populations.find((population): population is MerchantPopulation =>
      population.model === 'merchant' && population.encounterId === 'encounter.town-armorer')!;
    const merchantActor = run.actors.find((actor) => actor.actorId === armorer.actorId)!;

    run = teleportHero(run, adjacentFreeCell(run, merchantActor));
    // Unequip the starting sword and armor into the backpack: both are sellable to the armorer
    // (acceptedCategories: weapon, armor -- see content/encounters/town-merchants.yaml), giving two
    // distinct sale offers.
    run = apply(run, { type: 'unequip', commandId: 'command.unequip-sword', expectedRevision: run.revision, slot: 'main-hand' });
    run = apply(run, { type: 'unequip', commandId: 'command.unequip-armor', expectedRevision: run.revision, slot: 'body' });
    run = apply(run, {
      type: 'trade-open', commandId: 'command.trade-open', expectedRevision: run.revision,
      merchantActorId: merchantActor.actorId,
    });

    const opened = projectGameplayState({ state: run, content: pack });
    expect(opened.trade?.saleOffers.length).toBe(2);
    const backpack = opened.hero as unknown as { backpack: readonly { itemId: string; name: string }[] };
    const nameOf = (itemId: string) => backpack.backpack.find((item) => item.itemId === itemId)!.name;
    const [firstOffer, secondOffer] = opened.trade!.saleOffers;
    const survivorName = nameOf(secondOffer!.itemId);
    const soldFirstName = nameOf(firstOffer!.itemId);

    render(<TradeHarness initialRun={run} />);
    const sellList = () => screen.getByRole('listbox', { name: 'Sell' });

    await user.keyboard('{Tab}'); // buy -> sell list
    await user.keyboard('{Enter}'); // sell the first offer (index 0)
    // The sold item leaves the backpack (and reappears as merchant stock, so the item's name may
    // still be on the page in the Buy list) -- scope the assertions to the Sell listbox.
    expect(await within(sellList()).findByText(new RegExp(survivorName))).toBeInTheDocument();
    expect(within(sellList()).queryByText(new RegExp(soldFirstName))).not.toBeInTheDocument();

    // The surviving offer slid into index 0. If focus were stranded on the removed node, this
    // keypress would land on <body> and never reach the dialog's key handler.
    await user.keyboard('{Enter}'); // sell the surviving offer (now at index 0)

    await screen.findAllByText('Nothing here.');
    expect(screen.queryByRole('listbox', { name: 'Sell' })).not.toBeInTheDocument();
  });
});

/** Minimal reducer harness for `trade-service`: owns the `ActiveRun` in state, re-projects on
 * every dispatch, and forwards the intent straight to the real engine command -- mirrors
 * `TradeHarness` above, but for identify instead of sell. `onRunChange` lets a test observe the
 * *actual* post-command `ActiveRun` (e.g. which item got identified) directly, rather than only
 * through the DOM -- the same "real resolveCommand style" the sale-list regression above uses. */
function IdentifyHarness({ initialRun, onRunChange }: Readonly<{
  initialRun: ActiveRun; onRunChange?: (run: ActiveRun) => void;
}>): JSX.Element {
  const [run, setRun] = useState(initialRun);
  const projection = projectGameplayState({ state: run, content: pack });
  return (
    <TradeScreen
      snapshot={snapshotOf(projection)}
      onDispatch={(intent) => {
        if (intent.type !== 'trade-service') throw new Error(`unexpected intent in harness: ${intent.type}`);
        const merchantPopulationId = projection.trade!.merchantPopulationId;
        setRun((current) => {
          const next = apply(current, {
            type: 'trade-service', commandId: `command.identify.${intent.targetItemId}`, expectedRevision: current.revision,
            merchantPopulationId, serviceId: intent.serviceId, targetItemId: intent.targetItemId,
          });
          onRunChange?.(next);
          return next;
        });
      }}
      onClose={vi.fn()}
    />
  );
}

// Task 9: the identify target picker. Places two unidentified potions (distinct contentIds, so
// their generated appearance names differ) straight into the hero's backpack -- bypassing the
// normal loot path, same fixture technique `merchant-service.test.ts` uses in the engine package --
// then stands the hero beside the town curios dealer (the only permanent town merchant offering
// `merchant-service.identify`; see `content/encounters/town-merchants.yaml`) and opens trade for
// real.
describe('TradeScreen identify target picker', () => {
  function runWithUnidentifiedPair(): ActiveRun {
    let run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = heroActor(run);
    const unidentified: readonly ItemInstance[] = [
      { itemId: 'item.hero.test-potion-a', contentId: 'item.crimson-potion', quantity: 1, condition: 100,
        enchantment: null, identified: false, charges: null, fuel: null, enabled: null,
        location: { type: 'backpack', actorId: hero.actorId } },
      { itemId: 'item.hero.test-potion-b', contentId: 'item.ashen-potion', quantity: 1, condition: 100,
        enchantment: null, identified: false, charges: null, fuel: null, enabled: null,
        location: { type: 'backpack', actorId: hero.actorId } },
    ];
    run = validateActiveRun({
      ...run,
      items: [...run.items, ...unidentified].sort((left, right) => left.itemId < right.itemId ? -1 : 1),
    });
    const curiosDealer = run.populations.find((population): population is MerchantPopulation =>
      population.model === 'merchant' && population.encounterId === 'encounter.town-curios-dealer')!;
    const merchantActor = run.actors.find((actor) => actor.actorId === curiosDealer.actorId)!;
    run = teleportHero(run, adjacentFreeCell(run, merchantActor));
    run = apply(run, {
      type: 'trade-open', commandId: 'command.trade-open', expectedRevision: run.revision,
      merchantActorId: merchantActor.actorId,
    });
    return run;
  }

  it('lists exactly the eligible items, and identifying the SECOND one identifies only that item', async () => {
    const user = userEvent.setup();
    const run = runWithUnidentifiedPair();
    const opened = projectGameplayState({ state: run, content: pack });
    const identifyService = opened.trade!.services.find((service) => service.serviceId === 'merchant-service.identify')!;
    expect(identifyService.targetItemIds).toEqual(['item.hero.test-potion-a', 'item.hero.test-potion-b']);

    const backpack = opened.hero as unknown as { backpack: readonly { itemId: string; name: string }[] };
    const nameOf = (itemId: string) => backpack.backpack.find((item) => item.itemId === itemId)!.name;
    const [firstTargetId, secondTargetId] = identifyService.targetItemIds;
    const firstName = nameOf(firstTargetId!);
    const secondName = nameOf(secondTargetId!);

    let latestRun = run;
    render(<IdentifyHarness initialRun={run} onRunChange={(next) => { latestRun = next; }} />);

    await user.keyboard('{Tab}{Tab}'); // buy -> sell -> services
    await user.keyboard('{Enter}'); // opens the picker (targetItemIds is non-empty)

    const picker = screen.getByRole('listbox', { name: 'Identify target' });
    const options = within(picker).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(within(picker).getByText(new RegExp(firstName))).toBeInTheDocument();
    expect(within(picker).getByText(new RegExp(secondName))).toBeInTheDocument();

    await user.keyboard('{ArrowDown}'); // select the second item
    await user.keyboard('{Enter}'); // identify it

    // Identifying doesn't close the trade dialog -- only the picker.
    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Identify target' })).not.toBeInTheDocument();

    // Assert against the real post-command `ActiveRun`: the SECOND target item is identified,
    // the first is untouched.
    const firstItem = latestRun.items.find((item) => item.itemId === firstTargetId)!;
    const secondItem = latestRun.items.find((item) => item.itemId === secondTargetId)!;
    expect(secondItem.identified).toBe(true);
    expect(firstItem.identified).toBe(false);
  });

  it('closes the picker on Escape and returns to the services list without closing the trade dialog', async () => {
    const user = userEvent.setup();
    const run = runWithUnidentifiedPair();
    render(<IdentifyHarness initialRun={run} />);

    await user.keyboard('{Tab}{Tab}');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox', { name: 'Identify target' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: 'Trade' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Identify target' })).not.toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Services' })).toBeInTheDocument();
  });
});
