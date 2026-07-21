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
import { HeroPanel, VitalsStrip } from './HeroPanel.js';

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
    pendingFinalChamberChoice: null,
    notice: null,
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  };
}

describe('HeroPanel', () => {
  it('shows name, health bar text, hunger stage, equipped slots, and backpack summary', () => {
    render(<HeroPanel snapshot={snapshotOf(baseProjection)} />);
    const hero = baseProjection.hero as unknown as {
      name: string;
      health: number;
      maxHealth: number;
      hungerStage: string;
      equipment: Record<string, { name: string } | null>;
      backpack: readonly unknown[];
      backpackCapacity: number;
    };
    expect(screen.getByText(hero.name)).toBeInTheDocument();
    expect(screen.getByText(`${hero.health}/${hero.maxHealth} HP`)).toBeInTheDocument();
    expect(screen.getByText(`Hunger: ${hero.hungerStage}`)).toBeInTheDocument();
    const mainHand = hero.equipment['main-hand'];
    expect(mainHand).not.toBeNull();
    expect(screen.getByText(`main-hand: ${mainHand!.name}`)).toBeInTheDocument();
    expect(
      screen.getByText(`Backpack: ${hero.backpack.length}/${hero.backpackCapacity}`),
    ).toBeInTheDocument();
  });

  it('renders the WEAVE meter value and maximum', () => {
    render(<HeroPanel snapshot={snapshotOf(baseProjection)} />);
    const hero = baseProjection.hero as unknown as { weave: number; maxWeave: number };
    expect(hero.maxWeave).toBeGreaterThan(0);
    expect(screen.getByText(`${hero.weave}/${hero.maxWeave} WEAVE`)).toBeInTheDocument();
  });

  it('keeps the panel\'s accessible name as "Hero"', () => {
    render(<HeroPanel snapshot={snapshotOf(baseProjection)} />);
    const region = screen.getByRole('region', { name: 'Hero' });
    const hero = baseProjection.hero as unknown as { name: string };
    const title = screen.getByText(hero.name);
    expect(title.tagName).toBe('H2');
    expect(region).toContainElement(title);
  });
});

describe('VitalsStrip', () => {
  it('shows health, hunger, and light state as text under an accessible "Vitals" name', () => {
    render(<VitalsStrip snapshot={snapshotOf(baseProjection)} />);
    const hero = baseProjection.hero as unknown as {
      health: number;
      maxHealth: number;
      hungerStage: string;
    };
    expect(screen.getByLabelText('Vitals')).toBeInTheDocument();
    expect(screen.getByText(`${hero.health}/${hero.maxHealth} HP`)).toBeInTheDocument();
    expect(screen.getByText(`Hunger: ${hero.hungerStage}`)).toBeInTheDocument();
  });
});
