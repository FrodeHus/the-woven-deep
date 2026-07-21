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
import type { SessionSnapshot } from '../../session/guest-session.js';
import { SpellsPanel } from './SpellsPanel.js';

let pack: CompiledContentPack;
let baseRun: ActiveRun;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../content'),
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

describe('SpellsPanel', () => {
  it('renders nothing for a non-caster hero (empty castableSpells)', () => {
    const projection = projectGameplayState({ state: baseRun, content: pack });
    const { container } = render(
      <SpellsPanel snapshot={snapshotOf(projection)} onCast={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('region', { name: 'Spells' })).not.toBeInTheDocument();
  });

  it('renders an enabled row for a known spell when weave covers its cost, and calls onCast', async () => {
    const caster: ActiveRun = {
      ...baseRun,
      hero: { ...baseRun.hero, knownSpellIds: ['spell.ember-bolt'] },
    };
    const projection = projectGameplayState({ state: caster, content: pack });
    expect(projection.hero.castableSpells).toEqual([
      {
        spellId: 'spell.ember-bolt',
        name: 'Ember bolt',
        weaveCost: 3,
        range: 6,
        targetingId: 'target.actor',
      },
    ]);
    const onCast = vi.fn();
    render(<SpellsPanel snapshot={snapshotOf(projection)} onCast={onCast} />);
    const row = screen.getByRole('button', { name: /Ember bolt/ });
    expect(row).toBeEnabled();
    expect(screen.getByText('3 Weave · rng 6')).toBeInTheDocument();
    await userEvent.click(row);
    expect(onCast).toHaveBeenCalledWith('spell.ember-bolt');
  });

  it('disables the row when the hero does not have enough weave', () => {
    const heroActorId = baseRun.hero.actorId;
    const caster: ActiveRun = {
      ...baseRun,
      hero: { ...baseRun.hero, knownSpellIds: ['spell.ember-bolt'] },
      actors: baseRun.actors.map((actor) =>
        actor.actorId === heroActorId ? { ...actor, weave: 0 } : actor,
      ),
    };
    const projection = projectGameplayState({ state: caster, content: pack });
    render(<SpellsPanel snapshot={snapshotOf(projection)} onCast={vi.fn()} />);
    const row = screen.getByRole('button', { name: /Ember bolt/ });
    expect(row).toBeDisabled();
  });
});
