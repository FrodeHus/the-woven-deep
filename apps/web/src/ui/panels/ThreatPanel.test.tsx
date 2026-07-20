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
import { ThreatPanel } from './ThreatPanel.js';

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

    render(<ThreatPanel snapshot={snapshotOf(projection)} />);
    expect(screen.getByText(/Cave rat/)).toBeInTheDocument();
    expect(screen.getByText(/wounded/)).toBeInTheDocument();
    expect(screen.getByText(/intent\.approach/)).toBeInTheDocument();
    expect(screen.getByText('Iron sword')).toBeInTheDocument();
    expect(screen.getByText('On the ground nearby')).toBeInTheDocument();
  });

  it('renders a "nothing nearby" placeholder on an empty-threat snapshot', () => {
    const projection: GameplayProjection = { ...baseProjection, actors: [], groundItems: [] };
    render(<ThreatPanel snapshot={snapshotOf(projection)} />);
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
    render(<ThreatPanel snapshot={snapshotOf(projection)} />);
    expect(screen.queryByText(/Merchant/)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing nearby/i)).toBeInTheDocument();
  });
});
