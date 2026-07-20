import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO,
  createNewRun,
  projectGameplayState,
  type GameplayProjection,
} from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { HeroStatusAnnouncer } from './HeroStatusAnnouncer.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../content'),
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
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  };
}

function heroWith(overrides: Record<string, unknown>): GameplayProjection {
  const heroData = baseProjection.hero as unknown as Record<string, unknown>;
  return {
    ...baseProjection,
    hero: { ...heroData, ...overrides },
  } as unknown as GameplayProjection;
}

function floorWith(overrides: Record<string, unknown>): GameplayProjection {
  const floorData = baseProjection.floor as unknown as Record<string, unknown>;
  return {
    ...baseProjection,
    floor: { ...floorData, ...overrides },
  } as unknown as GameplayProjection;
}

describe('HeroStatusAnnouncer', () => {
  it('renders a visually-hidden polite status region that is silent on first mount', () => {
    render(
      <HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 100, maxHealth: 100 }))} />,
    );
    const region = screen.getByRole('status');
    expect(region).toHaveClass('sr-only');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
  });

  it('announces a health band crossing when the hero worsens', () => {
    const { rerender } = render(
      <HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 100, maxHealth: 100 }))} />,
    );
    const region = screen.getByRole('status');
    rerender(
      <HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 40, maxHealth: 100 }))} />,
    );
    expect(region.textContent).toContain('Health low.');
  });

  it('stays silent on a health drop that does not cross a band (no spam)', () => {
    const { rerender } = render(
      <HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 100, maxHealth: 100 }))} />,
    );
    const region = screen.getByRole('status');
    rerender(
      <HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 60, maxHealth: 100 }))} />,
    );
    expect(region.textContent).toBe('');
  });

  it('announces a newly gained condition by name', () => {
    const { rerender } = render(
      <HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ conditions: [] }))} />,
    );
    const region = screen.getByRole('status');
    rerender(
      <HeroStatusAnnouncer
        snapshot={snapshotOf(
          heroWith({
            conditions: [
              {
                conditionId: 'condition.poisoned',
                name: 'Poisoned',
                color: '#7ac86a',
                stacks: 1,
                remaining: 50,
              },
            ],
          }),
        )}
      />,
    );
    expect(region.textContent).toContain('Afflicted: Poisoned.');
  });

  it('stays silent on mount even when the hero boots in at low/critical health (no announce-on-restore)', () => {
    render(<HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 10, maxHealth: 100 }))} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('stays silent on mount even when booting directly into a dungeon depth (no announce-on-restore)', () => {
    render(
      <HeroStatusAnnouncer
        snapshot={snapshotOf(floorWith({ floorId: 'floor.depth-003', depth: 3, town: false }))}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('announces descending from town into depth 1', () => {
    const { rerender } = render(
      <HeroStatusAnnouncer
        snapshot={snapshotOf(floorWith({ floorId: 'floor.town', depth: 0, town: true }))}
      />,
    );
    const region = screen.getByRole('status');
    rerender(
      <HeroStatusAnnouncer
        snapshot={snapshotOf(floorWith({ floorId: 'floor.depth-001', depth: 1, town: false }))}
      />,
    );
    expect(region.textContent).toContain('Depth 1.');
  });

  it('announces returning to town from a depth', () => {
    const { rerender } = render(
      <HeroStatusAnnouncer
        snapshot={snapshotOf(floorWith({ floorId: 'floor.depth-001', depth: 1, town: false }))}
      />,
    );
    const region = screen.getByRole('status');
    rerender(
      <HeroStatusAnnouncer
        snapshot={snapshotOf(floorWith({ floorId: 'floor.town', depth: 0, town: true }))}
      />,
    );
    expect(region.textContent).toContain('Returned to the town.');
  });

  it('stays silent when the floor is unchanged across projection churn', () => {
    const { rerender } = render(
      <HeroStatusAnnouncer
        snapshot={snapshotOf(floorWith({ floorId: 'floor.depth-001', depth: 1, town: false }))}
      />,
    );
    const region = screen.getByRole('status');
    rerender(
      <HeroStatusAnnouncer
        snapshot={snapshotOf(floorWith({ floorId: 'floor.depth-001', depth: 1, town: false }))}
      />,
    );
    expect(region.textContent).toBe('');
  });
});
