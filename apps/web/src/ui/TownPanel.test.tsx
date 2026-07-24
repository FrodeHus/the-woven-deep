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
  type ActiveRun,
  type GameplayProjection,
} from '@woven-deep/engine';
import type { SessionSnapshot } from '../session/guest-session.js';
import { DEFAULT_SETTINGS, resolveKeymap } from '../session/settings.js';
import { TownPanel } from './TownPanel.js';

let pack: CompiledContentPack;
let baseRun: ActiveRun;

const SEED = [11, 22, 33, 44] as const;
const keymap = resolveKeymap(DEFAULT_SETTINGS.bindings);

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../content'),
  });
  baseRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
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

function townProjection(overrides: Readonly<{ returnAnchorFloorId?: string }>): GameplayProjection {
  const run: ActiveRun = { ...baseRun, ...overrides };
  return projectGameplayState({ state: run, content: pack });
}

describe('TownPanel', () => {
  it('shows a return-to-depth hint when a recall anchor is set', () => {
    const anchor = baseRun.floors[0]!;
    const projection = townProjection({ returnAnchorFloorId: anchor.floorId });

    render(<TownPanel snapshot={snapshotOf(projection)} keymap={keymap} />);

    expect(screen.getByText(new RegExp(`Return to depth ${anchor.depth}`))).toBeInTheDocument();
  });

  it('omits the return hint with no anchor', () => {
    const projection = townProjection({});

    render(<TownPanel snapshot={snapshotOf(projection)} keymap={keymap} />);

    expect(screen.queryByText(/Return to depth/)).not.toBeInTheDocument();
  });
});
