import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  applyCondition, DEFAULT_GUEST_HERO, DERIVED_STAT_NAMES, createNewRun, heroActor, projectGameplayState,
  type ActiveRun, type GameplayProjection,
} from '@woven-deep/engine';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { CharacterSheetOverlay } from '../src/ui/overlays/CharacterSheetOverlay.js';
import { OverlayScaffold } from '../src/ui/overlays/OverlayScaffold.js';

let pack: CompiledContentPack;
let baseRun: ActiveRun;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  baseRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
});

function snapshotFor(run: ActiveRun): SessionSnapshot {
  const projection = projectGameplayState({ state: run, content: pack });
  return {
    projection, log: [], lastEvents: [], pendingDecision: null, notice: null, houseOpen: false, conclusion: null, sightings: { monsterIds: [], itemIds: [] }, heroClassTags: [], onboarding: { counts: {}, dismissed: [] },
  };
}

describe('CharacterSheetOverlay', () => {
  it('renders every DERIVED_STAT_NAMES entry with its value and formula text', () => {
    const snapshot = snapshotFor(baseRun);
    render(<CharacterSheetOverlay snapshot={snapshot} />);

    for (const statName of DERIVED_STAT_NAMES) {
      const derived = (snapshot.projection.hero as unknown as {
        derived: Record<string, { value: number; formula: Record<string, number> }>;
      }).derived[statName]!;
      // Every operand in the formula (e.g. "base", "vitality") must appear disclosed as text.
      for (const operand of Object.keys(derived.formula)) {
        expect(screen.getAllByText(new RegExp(operand, 'i')).length).toBeGreaterThan(0);
      }
      expect(screen.getAllByText(new RegExp(`^${derived.value}$`)).length).toBeGreaterThan(0);
    }
  });

  it('renders every base attribute', () => {
    const snapshot = snapshotFor(baseRun);
    render(<CharacterSheetOverlay snapshot={snapshot} />);
    expect(screen.getByText('Might')).toBeInTheDocument();
    expect(screen.getByText('Agility')).toBeInTheDocument();
    expect(screen.getByText('Vitality')).toBeInTheDocument();
    expect(screen.getByText('Wits')).toBeInTheDocument();
    expect(screen.getByText('Resolve')).toBeInTheDocument();
  });

  it('shows hunger stage and sight radius plainly', () => {
    const snapshot = snapshotFor(baseRun);
    render(<CharacterSheetOverlay snapshot={snapshot} />);
    const hero = snapshot.projection.hero as unknown as { hungerStage: string; sightRadius: number };
    expect(screen.getByText(hero.hungerStage)).toBeInTheDocument();
    expect(screen.getByText(String(hero.sightRadius))).toBeInTheDocument();
  });

  it('shows run statistics from projection.metrics with human labels', () => {
    const runWithMetrics: ActiveRun = {
      ...baseRun,
      metrics: {
        ...baseRun.metrics, kills: 3, damageDealt: 40, damageTaken: 12, itemsCollected: 5, itemsIdentified: 2,
        currencyEarned: 100, currencySpent: 30, floorsEntered: 4, deepestDepth: 3, turnsElapsed: 250, restsCompleted: 2,
      },
    };
    const snapshot = snapshotFor(runWithMetrics);
    const { container } = render(<CharacterSheetOverlay snapshot={snapshot} />);
    const metrics = within(container.querySelector('.character-sheet-metrics')!);

    expect(metrics.getByText('Kills').nextElementSibling).toHaveTextContent('3');
    expect(metrics.getByText('Damage dealt').nextElementSibling).toHaveTextContent('40');
    expect(metrics.getByText('Damage taken').nextElementSibling).toHaveTextContent('12');
    expect(metrics.getByText('Items collected').nextElementSibling).toHaveTextContent('5');
    expect(metrics.getByText('Items identified').nextElementSibling).toHaveTextContent('2');
    expect(metrics.getByText('Currency earned').nextElementSibling).toHaveTextContent('100');
    expect(metrics.getByText('Currency spent').nextElementSibling).toHaveTextContent('30');
    expect(metrics.getByText('Floors entered').nextElementSibling).toHaveTextContent('4');
    expect(metrics.getByText('Deepest depth').nextElementSibling).toHaveTextContent('3');
    expect(metrics.getByText('Turns elapsed').nextElementSibling).toHaveTextContent('250');
    expect(metrics.getByText('Rests').nextElementSibling).toHaveTextContent('2');
  });

  it('shows a condition-bearing (poisoned-style) fixture hero\'s condition name, stacks, and remaining duration outside town', () => {
    const hero = heroActor(baseRun);
    const applied = applyCondition({
      actors: baseRun.actors, content: pack, targetActorId: hero.actorId, sourceActorId: hero.actorId,
      conditionId: 'condition.disengaged', worldTime: baseRun.worldTime, eventId: 'event.test-condition',
    });
    // The demo starting floor is town (depth 0); force a non-town floor depth so the frozen-time
    // marker does not apply here -- this test is specifically the "live, non-frozen" case.
    const dungeonFloor = { ...baseRun.floors[0]!, depth: 1 };
    const dungeonRun: ActiveRun = {
      ...baseRun, actors: applied.actors,
      floors: [dungeonFloor, ...baseRun.floors.slice(1)],
    };
    const snapshot = snapshotFor(dungeonRun);
    expect(snapshot.projection.floor.town).toBe(false);
    const condition = (snapshot.projection.hero as unknown as {
      conditions: readonly { name: string; stacks: number; remaining: number | null }[];
    }).conditions[0]!;
    expect(condition.name).toBe('Disengaged');
    expect(condition.remaining).not.toBeNull();

    render(<CharacterSheetOverlay snapshot={snapshot} />);
    expect(screen.getByText('Disengaged')).toBeInTheDocument();
    expect(screen.getByText('×1')).toBeInTheDocument();
    expect(screen.getByText(`${condition.remaining} world-time units remaining`)).toBeInTheDocument();
  });

  it('shows "Permanent" (no countdown) for a permanent condition outside town', () => {
    const hero = heroActor(baseRun);
    const applied = applyCondition({
      actors: baseRun.actors, content: pack, targetActorId: hero.actorId, sourceActorId: hero.actorId,
      conditionId: 'condition.incapacitated', worldTime: baseRun.worldTime, eventId: 'event.test-permanent',
    });
    const dungeonFloor = { ...baseRun.floors[0]!, depth: 1 };
    const dungeonRun: ActiveRun = {
      ...baseRun, actors: applied.actors,
      floors: [dungeonFloor, ...baseRun.floors.slice(1)],
    };
    const snapshot = snapshotFor(dungeonRun);
    expect(snapshot.projection.floor.town).toBe(false);
    const condition = (snapshot.projection.hero as unknown as {
      conditions: readonly { name: string; remaining: number | null }[];
    }).conditions[0]!;
    expect(condition.remaining).toBeNull();

    render(<CharacterSheetOverlay snapshot={snapshot} />);
    expect(screen.getByText('Incapacitated')).toBeInTheDocument();
    expect(screen.getByText('Permanent')).toBeInTheDocument();
  });

  it('shows the frozen-time marker for a condition while in town, where worldTime is frozen', () => {
    const hero = heroActor(baseRun);
    const applied = applyCondition({
      actors: baseRun.actors, content: pack, targetActorId: hero.actorId, sourceActorId: hero.actorId,
      conditionId: 'condition.disengaged', worldTime: baseRun.worldTime, eventId: 'event.test-condition-town',
    });
    const townRun: ActiveRun = { ...baseRun, actors: applied.actors };
    const snapshot = snapshotFor(townRun);
    expect(snapshot.projection.floor.town).toBe(true);

    render(<CharacterSheetOverlay snapshot={snapshot} />);
    expect(screen.getByText(/frozen while in town/i)).toBeInTheDocument();
  });

  it('has no dispatch surface: no buttons anywhere in the body, only the scaffold\'s own close hint', () => {
    const snapshot = snapshotFor(baseRun);
    render(
      <OverlayScaffold title="Character Sheet" onClose={vi.fn()} testId="overlay-character-sheet">
        <CharacterSheetOverlay snapshot={snapshot} />
      </OverlayScaffold>,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const dialog = screen.getByRole('dialog', { name: /character sheet/i });
    expect(dialog).toHaveTextContent('Esc close');
  });

  it('renders equipped gear read-only', () => {
    const snapshot = snapshotFor(baseRun);
    const hero = snapshot.projection.hero as unknown as {
      equipment: Readonly<Record<string, { name: string } | null>>;
    };
    render(<CharacterSheetOverlay snapshot={snapshot} />);
    for (const [slot, item] of Object.entries(hero.equipment)) {
      expect(screen.getByText(slot)).toBeInTheDocument();
      if (item) expect(screen.getByText(item.name)).toBeInTheDocument();
    }
  });

  it('omits a resistances section entirely, since projection.hero does not carry one', () => {
    const snapshot = snapshotFor(baseRun);
    expect('resistances' in (snapshot.projection.hero as object)).toBe(false);
    const { container } = render(<CharacterSheetOverlay snapshot={snapshot} />);
    expect(container.innerHTML.toLowerCase()).not.toContain('resistance');
  });
});
