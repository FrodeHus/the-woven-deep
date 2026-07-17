import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState, type GameplayProjection } from '@woven-deep/engine';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { DEFAULT_SETTINGS, resolveKeymap } from '../src/session/settings.js';
import { TownPanel } from '../src/ui/TownPanel.js';

const DEFAULT_KEYMAP = resolveKeymap(DEFAULT_SETTINGS.bindings);

let pack: CompiledContentPack;
let townProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  townProjection = projectGameplayState({ state: run, content: pack });
});

function snapshotOf(projection: GameplayProjection): SessionSnapshot {
  return {
    projection, log: [], lastEvents: [], pendingDecision: null, notice: null,
    houseOpen: false, conclusion: null, sightings: { monsterIds: [], itemIds: [] }, heroClassTags: [], onboarding: { counts: {}, dismissed: [] },
  };
}

function houseDoor(projection: GameplayProjection): { x: number; y: number } {
  const slots = projection.slots as unknown as readonly { tags: readonly string[]; x: number; y: number }[];
  const found = slots.find((slot) => slot.tags.includes('house-door'));
  if (!found) throw new Error('town projection is missing its house-door slot');
  return { x: found.x, y: found.y };
}

function withMerchants(projection: GameplayProjection): GameplayProjection {
  const hero = projection.hero as unknown as { x: number; y: number };
  return {
    ...projection,
    actors: [
      { actorId: 'population.town-provisioner', contentId: null, name: 'Provisioner', factionName: 'Provisioners Guild',
        reputationTier: 'neutral', tradeAvailable: true, x: hero.x + 1, y: hero.y },
      { actorId: 'population.town-armorer', contentId: null, name: 'Armorer', factionName: 'Armorers Guild',
        reputationTier: 'neutral', tradeAvailable: true, x: hero.x + 10, y: hero.y },
      { actorId: 'population.town-curios-dealer', contentId: null, name: 'Curios dealer', factionName: 'Curio Sellers',
        reputationTier: 'neutral', tradeAvailable: false, x: hero.x + 20, y: hero.y },
    ],
  };
}

describe('TownPanel', () => {
  it('lists the three permanent town merchants by faction, without any hostile-actor framing', () => {
    render(<TownPanel snapshot={snapshotOf(withMerchants(townProjection))} keymap={DEFAULT_KEYMAP} />);
    const list = screen.getByRole('list');
    const items = list.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(screen.getByText('Provisioner')).toBeInTheDocument();
    expect(screen.getByText('unavailable')).toBeInTheDocument();
  });

  it('marks a merchant as nearby only when the hero is Chebyshev-adjacent to it', () => {
    const withThree = withMerchants(townProjection);
    render(<TownPanel snapshot={snapshotOf(withThree)} keymap={DEFAULT_KEYMAP} />);
    const nearby = document.querySelectorAll('.town-merchant--nearby');
    // Only the provisioner (placed one tile east of the hero above) is adjacent.
    expect(nearby.length).toBe(1);
    expect(nearby[0]?.textContent).toContain('Provisioner');
  });

  it('shows a trade-key hint only for a nearby merchant that is actually trade-available', () => {
    render(<TownPanel snapshot={snapshotOf(withMerchants(townProjection))} keymap={DEFAULT_KEYMAP} />);
    // The provisioner is nearby and trade-available; the curios dealer is neither nearby nor
    // trade-available (see `withMerchants`).
    expect(screen.getByText(/press shift\+t to trade/i)).toBeInTheDocument();
    expect(screen.getAllByText(/press shift\+t to trade/i)).toHaveLength(1);
  });

  it('renders the trade hint from the resolved keymap, not a hardcoded "Shift+T" (regression: rebindable trade chord)', () => {
    const rebound = resolveKeymap({ ...DEFAULT_SETTINGS.bindings, trade: { key: 'y', shift: false } });
    render(<TownPanel snapshot={snapshotOf(withMerchants(townProjection))} keymap={rebound} />);
    expect(screen.getByText(/press y to trade/i)).toBeInTheDocument();
    expect(screen.queryByText(/shift\+t/i)).not.toBeInTheDocument();
  });

  it('shows a house-door proximity hint only when the hero is Chebyshev-adjacent to it', () => {
    const door = houseDoor(townProjection);
    const farProjection: GameplayProjection = {
      ...townProjection,
      hero: { ...townProjection.hero, x: door.x + 6, y: door.y },
    };
    render(<TownPanel snapshot={snapshotOf(farProjection)} keymap={DEFAULT_KEYMAP} />);
    expect(screen.queryByText(/press shift\+h/i)).not.toBeInTheDocument();

    const nearProjection: GameplayProjection = {
      ...townProjection,
      hero: { ...townProjection.hero, x: door.x + 1, y: door.y + 1 },
    };
    render(<TownPanel snapshot={snapshotOf(nearProjection)} keymap={DEFAULT_KEYMAP} />);
    expect(screen.getByText(/press shift\+h/i)).toBeInTheDocument();
  });

  it('renders the house hint from the resolved keymap, not a hardcoded "Shift+H" (regression: rebindable house chord)', () => {
    const door = houseDoor(townProjection);
    const nearProjection: GameplayProjection = {
      ...townProjection,
      hero: { ...townProjection.hero, x: door.x + 1, y: door.y + 1 },
    };
    const rebound = resolveKeymap({ ...DEFAULT_SETTINGS.bindings, house: { key: 'u', shift: false } });
    render(<TownPanel snapshot={snapshotOf(nearProjection)} keymap={rebound} />);
    expect(screen.getByText(/press u to open it/i)).toBeInTheDocument();
    expect(screen.queryByText(/shift\+h/i)).not.toBeInTheDocument();
  });
});
