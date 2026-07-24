import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import { DEFAULT_SETTINGS } from '../../session/settings.js';
import type { CastableSpellView } from '../../session/projection-view.js';
import { UiProviders } from '../providers.js';
import { SpellbookOverlay, type SpellbookOverlayProps } from './SpellbookOverlay.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

const FIREBALL: CastableSpellView = {
  spellId: 'spell.fireball',
  name: 'Fireball',
  weaveCost: 6,
  range: 6,
  targetingId: 'target.burst',
  aoe: { shape: 'burst', radius: 2 },
};

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../content'),
  });
  const baseRun: ActiveRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: baseRun, content: pack });
});

function snapshotWithSpells(spells: readonly CastableSpellView[], weave: number): SessionSnapshot {
  return {
    projection: {
      ...baseProjection,
      hero: { ...baseProjection.hero, castableSpells: spells, weave },
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

function stubSession(snapshot: SessionSnapshot): { session: GuestSession } {
  const session = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    dispatch: vi.fn(),
  } as unknown as GuestSession;
  return { session };
}

function renderSpellbook(input: {
  spells: readonly CastableSpellView[];
  weave: number;
  onCast?: SpellbookOverlayProps['onCast'];
}) {
  const { session } = stubSession(snapshotWithSpells(input.spells, input.weave));
  return render(
    <UiProviders
      pack={pack}
      settings={DEFAULT_SETTINGS}
      onChangeSettings={() => {}}
      session={session}
    >
      <SpellbookOverlay onCast={input.onCast} />
    </UiProviders>,
  );
}

describe('SpellbookOverlay', () => {
  it('lists known spells with weave cost, range, and an AoE badge', () => {
    renderSpellbook({ spells: [FIREBALL], weave: 20 });
    expect(screen.getAllByText('Fireball').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/burst r2/).length).toBeGreaterThan(0);
    expect(screen.getByText(/6 Weave/)).toBeInTheDocument();
  });

  it('disables the Cast button for an unaffordable spell', () => {
    renderSpellbook({ spells: [FIREBALL], weave: 1 });
    expect(screen.getByRole('button', { name: /Cast/ })).toBeDisabled();
  });

  it('Cast enters targeting via onCast for an affordable spell', async () => {
    const onCast = vi.fn();
    renderSpellbook({ spells: [FIREBALL], weave: 20, onCast });
    const castButton = screen.getByRole('button', { name: /Cast/ });
    expect(castButton).toBeEnabled();
    await userEvent.click(castButton);
    expect(onCast).toHaveBeenCalledWith('spell.fireball');
  });

  it('renders an empty state for a hero who knows no spells', () => {
    renderSpellbook({ spells: [], weave: 20 });
    expect(screen.getByText(/no spells/i)).toBeInTheDocument();
  });
});
