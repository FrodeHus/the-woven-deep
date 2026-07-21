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
import { DEFAULT_SETTINGS, resolveKeymap } from '../../session/settings.js';
import { ThreatPanel } from './ThreatPanel.js';

const DEFAULT_KEYMAP = resolveKeymap(DEFAULT_SETTINGS.bindings);

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

function heroPosition(projection: GameplayProjection): { x: number; y: number } {
  const heroCore = projection.hero as unknown as { x: number; y: number };
  return { x: heroCore.x, y: heroCore.y };
}

function withLockedDoorEast(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    features: [
      ...projection.features,
      { featureId: 'feature.door-locked-1', type: 'door', state: 'locked', x: x + 1, y },
    ],
  };
}

function withLockpickInBackpack(projection: GameplayProjection): GameplayProjection {
  return {
    ...projection,
    hero: {
      ...projection.hero,
      backpack: [
        ...(projection.hero as unknown as { backpack: readonly unknown[] }).backpack,
        {
          itemId: 'item.a-lockpick',
          contentId: 'item.lockpick',
          name: 'Bent lockpick',
          quantity: 1,
        },
      ],
    },
  };
}

describe('ThreatPanel', () => {
  it('lists visible hostile actors with intent and health band, and ground items', () => {
    const projection: GameplayProjection = {
      ...baseProjection,
      actors: [
        {
          actorId: 'actor.rat',
          name: 'Cave rat',
          glyph: 'r',
          disposition: 'hostile',
          healthPresentation: { band: 'wounded' },
          intentPresentation: 'intent.approach',
        },
      ],
      groundItems: [{ itemId: 'item.floor-sword', name: 'Iron sword' }],
    } as unknown as GameplayProjection;

    render(<ThreatPanel snapshot={snapshotOf(projection)} keymap={DEFAULT_KEYMAP} pack={pack} />);
    expect(screen.getByText(/Cave rat/)).toBeInTheDocument();
    expect(screen.getByText(/wounded/)).toBeInTheDocument();
    expect(screen.getByText(/intent\.approach/)).toBeInTheDocument();
    expect(screen.getByText('Iron sword')).toBeInTheDocument();
    expect(screen.getByText('On the ground nearby')).toBeInTheDocument();
  });

  it('renders a "nothing nearby" placeholder on an empty-threat snapshot', () => {
    const projection: GameplayProjection = { ...baseProjection, actors: [], groundItems: [] };
    render(<ThreatPanel snapshot={snapshotOf(projection)} keymap={DEFAULT_KEYMAP} pack={pack} />);
    expect(screen.getByText(/nothing nearby/i)).toBeInTheDocument();
  });

  it('ignores non-hostile visible actors', () => {
    const projection: GameplayProjection = {
      ...baseProjection,
      actors: [
        {
          actorId: 'actor.merchant',
          name: 'Merchant',
          glyph: 'm',
          disposition: 'friendly',
          healthPresentation: { band: 'healthy' },
        },
      ],
      groundItems: [],
    } as unknown as GameplayProjection;
    render(<ThreatPanel snapshot={snapshotOf(projection)} keymap={DEFAULT_KEYMAP} pack={pack} />);
    expect(screen.queryByText(/Merchant/)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing nearby/i)).toBeInTheDocument();
  });

  it('offers the pick-lock action only when a locked door/chest is adjacent and the hero holds a lockpick', () => {
    const projection: GameplayProjection = {
      ...baseProjection,
      actors: [],
      groundItems: [],
    };
    render(<ThreatPanel snapshot={snapshotOf(projection)} keymap={DEFAULT_KEYMAP} pack={pack} />);
    expect(screen.queryByText(/press p to pick it/i)).not.toBeInTheDocument();

    const withLockedDoor = withLockedDoorEast(projection);
    render(
      <ThreatPanel snapshot={snapshotOf(withLockedDoor)} keymap={DEFAULT_KEYMAP} pack={pack} />,
    );
    // Adjacent to a locked door but not carrying a key/lockpick: named, but no press-to-pick hint.
    expect(
      screen.getByText(/locked door is here, but you have no key or lockpick/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/press p to pick it/i)).not.toBeInTheDocument();

    const withPick = withLockpickInBackpack(withLockedDoor);
    render(<ThreatPanel snapshot={snapshotOf(withPick)} keymap={DEFAULT_KEYMAP} pack={pack} />);
    expect(screen.getByText(/press p to pick it/i)).toBeInTheDocument();
  });
});
