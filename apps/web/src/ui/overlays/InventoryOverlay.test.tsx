import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO,
  createInMemoryRunRecordRepository,
  createNewRun,
  projectGameplayState,
  type ActiveRun,
  type ArtifactLedger,
  type GameplayProjection,
  type RunRecordRepository,
} from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import { DEFAULT_SETTINGS } from '../../session/settings.js';
import { UiProviders } from '../providers.js';
import {
  InventoryOverlay,
  type InventoryOverlayProps,
  type ProjectedItemLike,
} from './InventoryOverlay.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../content'),
  });
  const baseRun: ActiveRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: baseRun, content: pack });
});

function item(
  overrides: Readonly<Partial<ProjectedItemLike>> &
    Pick<ProjectedItemLike, 'itemId' | 'name' | 'category'>,
): ProjectedItemLike {
  return {
    quantity: 1,
    identified: true,
    condition: 100,
    fuel: null,
    enabled: null,
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
    pendingFinalChamberChoice: null,
    notice: null,
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  };
}

function stubSession(snapshot: SessionSnapshot): {
  session: GuestSession;
  dispatch: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  const session = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    dispatch,
  } as unknown as GuestSession;
  return { session, dispatch };
}

function renderInventory(
  session: GuestSession,
  overlayProps?: Readonly<InventoryOverlayProps>,
  repository?: RunRecordRepository,
) {
  return render(
    <UiProviders
      pack={pack}
      settings={DEFAULT_SETTINGS}
      onChangeSettings={() => {}}
      session={session}
      repository={repository}
    >
      <InventoryOverlay
        onBeginScrollTargeting={overlayProps?.onBeginScrollTargeting}
        onCloseOverlay={overlayProps?.onCloseOverlay}
      />
    </UiProviders>,
  );
}

/** A records repository whose artifact ledger is stated outright, so a provenance render case does
 * not have to drive a run to its death to earn a stint. */
function repositoryWithLedger(ledger: ArtifactLedger): RunRecordRepository {
  return { ...createInMemoryRunRecordRepository(), artifactLedger: () => ledger };
}

describe('InventoryOverlay (structure 1: ListDetail-based drawer)', () => {
  it('shows the equipped slot-grid with the weapon glyph', () => {
    const snapshot = snapshotWithBackpack([], {
      'main-hand': item({ itemId: 'item.sword', name: 'Iron sword', category: 'weapon' }),
    });
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

    expect(dispatch).toHaveBeenCalledWith({
      type: 'backpack',
      action: 'unequip',
      itemId: 'item.sword',
    });
  });

  it('pressing e on a selected unequipped item dispatches equip', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.torch', name: 'Torch', category: 'light' }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session);

    await user.keyboard('e');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'backpack',
      action: 'equip',
      itemId: 'item.torch',
    });
  });

  it('pressing d dispatches drop for the selected item', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.torch', name: 'Torch', category: 'light' }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session);

    await user.keyboard('d');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'backpack',
      action: 'drop',
      itemId: 'item.torch',
    });
  });

  it('pressing u dispatches use, and l dispatches toggle-light, for the selected item', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.torch', name: 'Torch', category: 'light' }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session);

    await user.keyboard('u');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'backpack',
      action: 'use',
      itemId: 'item.torch',
    });
    await user.keyboard('l');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'backpack',
      action: 'toggle-light',
      itemId: 'item.torch',
    });
  });

  it('clicking a category filter pill narrows the pack list to that bucket', async () => {
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

    // The "All" pill starts pressed; selecting "Weapons" keeps the sword and drops the shield.
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Weapons' }));
    expect(screen.getByRole('button', { name: 'Weapons' })).toHaveAttribute('aria-pressed', 'true');
    expect(list.getByText('Sword')).toBeInTheDocument();
    expect(list.queryByText('Shield')).not.toBeInTheDocument();

    // A shield buckets under "Armor" (not "Weapons"), so that pill reveals it.
    await user.click(screen.getByRole('button', { name: 'Armor' }));
    expect(list.getByText('Shield')).toBeInTheDocument();
    expect(list.queryByText('Sword')).not.toBeInTheDocument();
  });

  it('pressing f cycles the category filter through the buckets', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack([
      item({ itemId: 'item.sword', name: 'Sword', category: 'weapon' }),
      item({ itemId: 'item.shield', name: 'Shield', category: 'shield' }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    const list = within(screen.getByRole('listbox', { name: 'Backpack items' }));
    // all -> weapons: only the sword survives.
    await user.keyboard('f');
    expect(screen.getByRole('button', { name: 'Weapons' })).toHaveAttribute('aria-pressed', 'true');
    expect(list.getByText('Sword')).toBeInTheDocument();
    expect(list.queryByText('Shield')).not.toBeInTheDocument();
  });

  it('pressing s toggles a stable, locale-free name sort', async () => {
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

    await user.keyboard('s');
    options = list.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Apple');
    expect(options[1]).toHaveTextContent('Zebra pelt');
  });

  it('shows a Refuel affordance for fuel matching an equipped light, and dispatches a refuel intent', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack(
      [
        item({
          itemId: 'item.oil-stack',
          contentId: 'item.lamp-oil',
          name: 'Lamp oil',
          category: 'fuel',
          quantity: 3,
        }),
      ],
      {
        'off-hand': item({
          itemId: 'item.lantern-1',
          contentId: 'item.brass-lantern',
          name: 'Brass lantern',
          category: 'light',
        }),
      },
    );
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session);

    const list = within(screen.getByRole('listbox', { name: 'Backpack items' }));
    await user.click(list.getByRole('option', { name: /Lamp oil/ }));

    const refuelButton = screen.getByRole('button', { name: /Refuel Brass lantern/ });
    expect(refuelButton).toBeInTheDocument();

    await user.click(refuelButton);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'refuel',
      fuelItemId: 'item.oil-stack',
      targetItemId: 'item.lantern-1',
    });
  });

  it('shows no Refuel affordance when no equipped light matches the selected fuel', () => {
    const snapshot = snapshotWithBackpack(
      [
        item({
          itemId: 'item.oil-stack',
          contentId: 'item.lamp-oil',
          name: 'Lamp oil',
          category: 'fuel',
          quantity: 3,
        }),
      ],
      { 'main-hand': item({ itemId: 'item.sword', name: 'Iron sword', category: 'weapon' }) },
    );
    const { session } = stubSession(snapshot);
    renderInventory(session);

    expect(screen.queryByRole('button', { name: /Refuel/ })).not.toBeInTheDocument();
  });

  it('shows Damage and Worth fact rows and the authored description for an identified weapon', () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.sword-1',
        contentId: 'item.iron-sword',
        name: 'Iron sword',
        category: 'weapon',
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    const damage = screen.getByText('Damage');
    expect(damage.parentElement).toHaveTextContent('1d6');
    const worth = screen.getByText('Worth');
    expect(worth.parentElement).toHaveTextContent('18');
    expect(screen.getByText(/notched from honest use/i)).toBeInTheDocument();
  });

  it('shows a Light radius fact row for an identified light, from its content entry', () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.lantern-1',
        contentId: 'item.brass-lantern',
        name: 'Brass lantern',
        category: 'light',
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    const radius = screen.getByText('Light radius');
    expect(radius.parentElement).toHaveTextContent('7');
  });

  it('hides Damage, Worth, and the description for an unidentified item (no content entry resolves)', () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.mystery',
        name: 'Cloudy potion',
        category: 'potion',
        identified: false,
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    expect(screen.queryByText('Damage')).not.toBeInTheDocument();
    expect(screen.queryByText('Worth')).not.toBeInTheDocument();
    expect(screen.queryByText(/notched from honest use/i)).not.toBeInTheDocument();
  });

  it('using a targeted scroll enters targeting instead of dispatching use immediately', async () => {
    const user = userEvent.setup();
    const beginScroll = vi.fn();
    const closeOverlay = vi.fn();
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.ember-scroll.1',
        contentId: 'item.ember-scroll',
        name: 'Scroll of ember bolt',
        category: 'scroll',
      }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session, { onBeginScrollTargeting: beginScroll, onCloseOverlay: closeOverlay });

    await user.keyboard('u');

    expect(closeOverlay).toHaveBeenCalled();
    expect(beginScroll).toHaveBeenCalledWith(
      'item.ember-scroll.1',
      expect.objectContaining({ spellId: 'spell.ember-bolt', targetingId: 'target.actor' }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('using an AoE scroll previews the burst spell descriptor', async () => {
    const user = userEvent.setup();
    const beginScroll = vi.fn();
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.fireball-scroll.1',
        contentId: 'item.fireball-scroll',
        name: 'Scroll of fireball',
        category: 'scroll',
      }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session, { onBeginScrollTargeting: beginScroll });

    await user.keyboard('u');

    expect(beginScroll).toHaveBeenCalledWith(
      'item.fireball-scroll.1',
      expect.objectContaining({
        spellId: 'spell.fireball',
        targetingId: 'target.burst',
        aoe: expect.objectContaining({ shape: 'burst' }),
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('using a plain consumable dispatches use immediately (fire-and-forget)', async () => {
    const user = userEvent.setup();
    const beginScroll = vi.fn();
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.ration.1',
        contentId: 'item.travel-ration',
        name: 'Travel ration',
        category: 'food',
      }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session, { onBeginScrollTargeting: beginScroll });

    await user.keyboard('u');

    expect(dispatch).toHaveBeenCalledWith({
      type: 'backpack',
      action: 'use',
      itemId: 'item.ration.1',
    });
    expect(beginScroll).not.toHaveBeenCalled();
  });

  it('using a tome (learn effect, no spellId cast) dispatches use immediately', async () => {
    const user = userEvent.setup();
    const beginScroll = vi.fn();
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.fireball-tome.1',
        contentId: 'item.fireball-tome',
        name: 'Tome of fireball',
        category: 'misc',
      }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session, { onBeginScrollTargeting: beginScroll });

    await user.keyboard('u');

    expect(dispatch).toHaveBeenCalledWith({
      type: 'backpack',
      action: 'use',
      itemId: 'item.fireball-tome.1',
    });
    expect(beginScroll).not.toHaveBeenCalled();
  });

  it('renders an artifact name in the HUD gold accent, and an ordinary item in the plain heading color', () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.grace.1',
        contentId: 'item.marias-grace',
        name: "Maria's Grace",
        category: 'light',
        fuel: 2400,
        enabled: true,
      }),
      item({
        itemId: 'item.lantern.1',
        contentId: 'item.brass-lantern',
        name: 'Brass lantern',
        category: 'light',
        fuel: 900,
        enabled: false,
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    const artifactHeading = screen.getByRole('heading', { name: "Maria's Grace" });
    expect(artifactHeading).toHaveClass('text-accent');
    expect(screen.getByText('Relic')).toBeInTheDocument();
  });

  it('hides the fuel row and the refuel affordance for a fuelless artifact light', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotWithBackpack(
      [
        item({
          itemId: 'item.oil-stack',
          contentId: 'item.lamp-oil',
          name: 'Lamp oil',
          category: 'fuel',
          quantity: 3,
        }),
      ],
      {
        'off-hand': item({
          itemId: 'item.grace.1',
          contentId: 'item.marias-grace',
          name: "Maria's Grace",
          category: 'light',
          // A fuelless instance still HOLDS its capacity -- the gauge must hide on the pack's
          // `artifact.light.fuelless` flag, never on `fuel === null`.
          fuel: 2400,
          enabled: true,
        }),
      },
    );
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session);

    // Lamp oil is selected first: no refuel affordance for the fuelless lantern it "matches".
    expect(screen.queryByRole('button', { name: /Refuel/ })).not.toBeInTheDocument();
    await user.keyboard('r');
    expect(dispatch).not.toHaveBeenCalled();

    const list = within(screen.getByRole('listbox', { name: 'Backpack items' }));
    await user.click(list.getByRole('option', { name: /Maria's Grace/ }));
    expect(screen.queryByText('Fuel')).not.toBeInTheDocument();
  });

  it('still shows the fuel row for an ordinary light', () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.lantern.1',
        contentId: 'item.brass-lantern',
        name: 'Brass lantern',
        category: 'light',
        fuel: 900,
        enabled: false,
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    expect(screen.getByText('Fuel')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
  });

  it("states an artifact's drawback modifiers", () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.needle.1',
        contentId: 'item.thread-counts-needle',
        name: "Thread-Count's Needle",
        category: 'ring',
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    expect(screen.getByText('maxHealth')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
  });

  it("names an artifact's signature spell, its charges, and offers the cast affordance", () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.ember.1',
        contentId: 'item.warden-ember',
        name: "Warden's Ember",
        category: 'ring',
        charges: 2,
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    expect(screen.getByText('Signature')).toBeInTheDocument();
    expect(screen.getByText('Ember bolt')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cast Ember bolt/ })).toBeInTheDocument();
  });

  it('offers no cast affordance for an artifact with no signature', () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.grace.1',
        contentId: 'item.marias-grace',
        name: "Maria's Grace",
        category: 'light',
        fuel: 2400,
        enabled: true,
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    expect(screen.queryByText('Signature')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cast/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use/ })).toBeInTheDocument();
  });

  it('disables the cast affordance for a spent signature artifact', () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.ember.1',
        contentId: 'item.warden-ember',
        name: "Warden's Ember",
        category: 'ring',
        charges: 0,
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session);

    expect(screen.getByText('0 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cast Ember bolt/ })).toBeDisabled();
  });

  it('casting a signature artifact enters the shared aim mode for its spell', async () => {
    const user = userEvent.setup();
    const beginScroll = vi.fn();
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.ember.1',
        contentId: 'item.warden-ember',
        name: "Warden's Ember",
        category: 'ring',
        charges: 3,
      }),
    ]);
    const { session, dispatch } = stubSession(snapshot);
    renderInventory(session, { onBeginScrollTargeting: beginScroll });

    await user.keyboard('u');

    expect(beginScroll).toHaveBeenCalledWith(
      'item.ember.1',
      expect.objectContaining({ spellId: 'spell.ember-bolt', targetingId: 'target.actor' }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("renders the artifact's provenance from the records repository's ledger", () => {
    const ledger: ArtifactLedger = [
      {
        artifactId: 'item.marias-grace',
        status: 'undiscovered',
        holderRecordId: null,
        provenance: [
          {
            heroName: 'Yrsa',
            recordId: 'record.yrsa',
            outcome: 'died-with',
            depth: 12,
          },
          {
            heroName: 'Yrsa',
            recordId: 'record.yrsa',
            outcome: 'reclaimed-by-the-deep',
            depth: 0,
          },
        ],
      },
    ];
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.grace.1',
        contentId: 'item.marias-grace',
        name: "Maria's Grace",
        category: 'light',
        fuel: 2400,
        enabled: true,
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session, undefined, repositoryWithLedger(ledger));

    expect(screen.getByText('Borne by Yrsa — fell at depth 12')).toBeInTheDocument();
    expect(screen.getByText('Borne by Yrsa — the Deep took it back')).toBeInTheDocument();
  });

  it('renders no provenance block for an ordinary item', () => {
    const snapshot = snapshotWithBackpack([
      item({
        itemId: 'item.lantern.1',
        contentId: 'item.brass-lantern',
        name: 'Brass lantern',
        category: 'light',
        fuel: 900,
      }),
    ]);
    const { session } = stubSession(snapshot);
    renderInventory(session, undefined, repositoryWithLedger([]));

    expect(screen.queryByText(/Borne by/)).not.toBeInTheDocument();
    expect(screen.queryByText('Provenance')).not.toBeInTheDocument();
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
