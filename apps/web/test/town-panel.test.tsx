import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState, type GameplayProjection } from '@woven-deep/engine';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { TownPanel } from '../src/ui/TownPanel.js';

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
    backpackOpen: false, houseOpen: false, conclusion: null,
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
      { actorId: 'population.town-provisioner', name: 'Provisioner', factionName: 'Provisioners Guild',
        reputationTier: 'neutral', tradeAvailable: true, x: hero.x + 1, y: hero.y },
      { actorId: 'population.town-armorer', name: 'Armorer', factionName: 'Armorers Guild',
        reputationTier: 'neutral', tradeAvailable: true, x: hero.x + 10, y: hero.y },
      { actorId: 'population.town-curios-dealer', name: 'Curios dealer', factionName: 'Curio Sellers',
        reputationTier: 'neutral', tradeAvailable: false, x: hero.x + 20, y: hero.y },
    ],
  };
}

describe('TownPanel', () => {
  it('lists the three permanent town merchants by faction, without any hostile-actor framing', () => {
    render(<TownPanel snapshot={snapshotOf(withMerchants(townProjection))} />);
    const list = screen.getByRole('list');
    const items = list.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(screen.getByText('Provisioner')).toBeInTheDocument();
    expect(screen.getByText('unavailable')).toBeInTheDocument();
  });

  it('marks a merchant as nearby only when the hero is Chebyshev-adjacent to it', () => {
    const withThree = withMerchants(townProjection);
    render(<TownPanel snapshot={snapshotOf(withThree)} />);
    const nearby = document.querySelectorAll('.town-merchant--nearby');
    // Only the provisioner (placed one tile east of the hero above) is adjacent.
    expect(nearby.length).toBe(1);
    expect(nearby[0]?.textContent).toContain('Provisioner');
  });

  it('shows a house-door proximity hint only when the hero is Chebyshev-adjacent to it', () => {
    const door = houseDoor(townProjection);
    const farProjection: GameplayProjection = {
      ...townProjection,
      hero: { ...townProjection.hero, x: door.x + 6, y: door.y },
    };
    render(<TownPanel snapshot={snapshotOf(farProjection)} />);
    expect(screen.queryByText(/press shift\+h/i)).not.toBeInTheDocument();

    const nearProjection: GameplayProjection = {
      ...townProjection,
      hero: { ...townProjection.hero, x: door.x + 1, y: door.y + 1 },
    };
    render(<TownPanel snapshot={snapshotOf(nearProjection)} />);
    expect(screen.getByText(/press shift\+h/i)).toBeInTheDocument();
  });
});
