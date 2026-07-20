import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  applyCondition,
  DEFAULT_GUEST_HERO,
  createNewRun,
  heroActor,
  projectGameplayState,
  type ActiveRun,
} from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import { DEFAULT_SETTINGS } from '../../session/settings.js';
import { playerVisibleDerivedStats } from '../derived-stats-display.js';
import { UiProviders } from '../providers.js';
import { CharacterSheetOverlay } from './CharacterSheetOverlay.js';

let pack: CompiledContentPack;
let baseRun: ActiveRun;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../content'),
  });
  baseRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
});

function snapshotFor(run: ActiveRun): SessionSnapshot {
  const projection = projectGameplayState({ state: run, content: pack });
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

function stubSession(snapshot: SessionSnapshot): GuestSession {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    dispatch: vi.fn(),
  } as unknown as GuestSession;
}

function renderSheet(snapshot: SessionSnapshot) {
  return render(
    <UiProviders
      pack={pack}
      settings={DEFAULT_SETTINGS}
      onChangeSettings={() => {}}
      session={stubSession(snapshot)}
    >
      <CharacterSheetOverlay />
    </UiProviders>,
  );
}

function sectionFor(heading: string): ReturnType<typeof within> {
  return within(screen.getByRole('heading', { name: heading }).closest('section')!);
}

// Mirrors CharacterSheetOverlay's private METRIC_ROWS -- kept here only to assert full coverage
// of the labels the component renders, not to duplicate its behavior.
const METRIC_ROWS = [
  { key: 'kills', label: 'Kills' },
  { key: 'damageDealt', label: 'Damage dealt' },
  { key: 'damageTaken', label: 'Damage taken' },
  { key: 'itemsCollected', label: 'Items collected' },
  { key: 'itemsIdentified', label: 'Items identified' },
  { key: 'currencyEarned', label: 'Currency earned' },
  { key: 'currencySpent', label: 'Currency spent' },
  { key: 'floorsEntered', label: 'Floors entered' },
  { key: 'deepestDepth', label: 'Deepest depth' },
  { key: 'turnsElapsed', label: 'Turns elapsed' },
  { key: 'restsCompleted', label: 'Rests' },
] as const;

describe('CharacterSheetOverlay', () => {
  it('renders all six section headings', () => {
    const snapshot = snapshotFor(baseRun);
    renderSheet(snapshot);

    expect(screen.getByRole('heading', { name: 'Attributes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Derived stats' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vitals' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conditions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Equipment' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Run statistics' })).toBeInTheDocument();
  });

  it('renders a sample attribute value', () => {
    const snapshot = snapshotFor(baseRun);
    renderSheet(snapshot);
    const hero = snapshot.projection.hero as unknown as {
      attributes: Readonly<Record<string, number>>;
    };

    const attributesSection = within(
      screen.getByRole('heading', { name: 'Attributes' }).closest('section')!,
    );
    expect(attributesSection.getByText('Might').nextElementSibling).toHaveTextContent(
      String(hero.attributes.might),
    );
  });

  it('renders a condition badge with its inline color', () => {
    const hero = heroActor(baseRun);
    const applied = applyCondition({
      actors: baseRun.actors,
      content: pack,
      targetActorId: hero.actorId,
      sourceActorId: hero.actorId,
      conditionId: 'condition.disengaged',
      worldTime: baseRun.worldTime,
      eventId: 'event.test-condition',
    });
    const dungeonFloor = { ...baseRun.floors[0]!, depth: 1 };
    const dungeonRun: ActiveRun = {
      ...baseRun,
      actors: applied.actors,
      floors: [dungeonFloor, ...baseRun.floors.slice(1)],
    };
    const snapshot = snapshotFor(dungeonRun);
    const condition = (
      snapshot.projection.hero as unknown as {
        conditions: readonly { name: string; color: string }[];
      }
    ).conditions[0]!;

    renderSheet(snapshot);

    const nameNode = screen.getByText(condition.name);
    expect(nameNode.closest('li')).toHaveStyle({ color: condition.color });
  });

  it('shows "Permanent" (no countdown) for a permanent condition outside town', () => {
    const hero = heroActor(baseRun);
    const applied = applyCondition({
      actors: baseRun.actors,
      content: pack,
      targetActorId: hero.actorId,
      sourceActorId: hero.actorId,
      conditionId: 'condition.incapacitated',
      worldTime: baseRun.worldTime,
      eventId: 'event.test-permanent',
    });
    const dungeonFloor = { ...baseRun.floors[0]!, depth: 1 };
    const dungeonRun: ActiveRun = {
      ...baseRun,
      actors: applied.actors,
      floors: [dungeonFloor, ...baseRun.floors.slice(1)],
    };
    const snapshot = snapshotFor(dungeonRun);
    expect(snapshot.projection.floor.town).toBe(false);
    const condition = (
      snapshot.projection.hero as unknown as {
        conditions: readonly { name: string; remaining: number | null }[];
      }
    ).conditions[0]!;
    expect(condition.remaining).toBeNull();

    renderSheet(snapshot);
    const conditionsSection = sectionFor('Conditions');
    expect(conditionsSection.getByText('Incapacitated')).toBeInTheDocument();
    expect(conditionsSection.getByText('Permanent')).toBeInTheDocument();
  });

  it('shows the frozen-time marker for the same permanent condition while in town', () => {
    const hero = heroActor(baseRun);
    const applied = applyCondition({
      actors: baseRun.actors,
      content: pack,
      targetActorId: hero.actorId,
      sourceActorId: hero.actorId,
      conditionId: 'condition.incapacitated',
      worldTime: baseRun.worldTime,
      eventId: 'event.test-permanent-town',
    });
    const townRun: ActiveRun = { ...baseRun, actors: applied.actors };
    const snapshot = snapshotFor(townRun);
    expect(snapshot.projection.floor.town).toBe(true);
    const condition = (
      snapshot.projection.hero as unknown as {
        conditions: readonly { name: string; remaining: number | null }[];
      }
    ).conditions[0]!;
    expect(condition.remaining).toBeNull();

    renderSheet(snapshot);
    const conditionsSection = sectionFor('Conditions');
    expect(conditionsSection.getByText('Incapacitated')).toBeInTheDocument();
    expect(conditionsSection.getByText(/frozen while in town/i)).toBeInTheDocument();
  });

  it('has no dispatch surface: no buttons anywhere in the rendered sheet', () => {
    const snapshot = snapshotFor(baseRun);
    renderSheet(snapshot);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders every player-visible derived stat entry with its value and formula text', () => {
    const snapshot = snapshotFor(baseRun);
    renderSheet(snapshot);
    const derivedSection = sectionFor('Derived stats');

    for (const statName of playerVisibleDerivedStats()) {
      const derived = (
        snapshot.projection.hero as unknown as {
          derived: Record<string, { value: number; formula: Record<string, number> }>;
        }
      ).derived[statName]!;
      for (const operand of Object.keys(derived.formula)) {
        expect(derivedSection.getAllByText(new RegExp(operand, 'i')).length).toBeGreaterThan(0);
      }
      expect(derivedSection.getAllByText(new RegExp(`^${derived.value}$`)).length).toBeGreaterThan(
        0,
      );
    }
  });

  it('shows Defense in the Derived stats section but hides the internal light-out knobs', () => {
    const snapshot = snapshotFor(baseRun);
    renderSheet(snapshot);
    const derivedSection = sectionFor('Derived stats');

    expect(derivedSection.getByText('Defense')).toBeInTheDocument();
    expect(derivedSection.queryByText(/light-out/i)).not.toBeInTheDocument();
    expect(derivedSection.queryByText(/lightOutRevealRadius/i)).not.toBeInTheDocument();
    expect(derivedSection.queryByText(/lightOutMemoryPersists/i)).not.toBeInTheDocument();
  });

  it('renders every base attribute label', () => {
    const snapshot = snapshotFor(baseRun);
    renderSheet(snapshot);
    const attributesSection = sectionFor('Attributes');
    expect(attributesSection.getByText('Might')).toBeInTheDocument();
    expect(attributesSection.getByText('Agility')).toBeInTheDocument();
    expect(attributesSection.getByText('Vitality')).toBeInTheDocument();
    expect(attributesSection.getByText('Wits')).toBeInTheDocument();
    expect(attributesSection.getByText('Resolve')).toBeInTheDocument();
  });

  it('shows hunger stage and sight radius plainly', () => {
    const snapshot = snapshotFor(baseRun);
    renderSheet(snapshot);
    const hero = snapshot.projection.hero as unknown as {
      hungerStage: string;
      sightRadius: number;
    };
    const vitalsSection = sectionFor('Vitals');
    expect(vitalsSection.getByText(hero.hungerStage)).toBeInTheDocument();
    expect(vitalsSection.getByText(String(hero.sightRadius))).toBeInTheDocument();
  });

  it('shows run statistics from projection.metrics with human labels', () => {
    const runWithMetrics: ActiveRun = {
      ...baseRun,
      metrics: {
        ...baseRun.metrics,
        kills: 3,
        damageDealt: 40,
        damageTaken: 12,
        itemsCollected: 5,
        itemsIdentified: 2,
        currencyEarned: 100,
        currencySpent: 30,
        floorsEntered: 4,
        deepestDepth: 3,
        turnsElapsed: 250,
        restsCompleted: 2,
      },
    };
    const snapshot = snapshotFor(runWithMetrics);
    renderSheet(snapshot);
    const metricsSection = sectionFor('Run statistics');

    const expectedValues: Readonly<Record<string, string>> = {
      kills: '3',
      damageDealt: '40',
      damageTaken: '12',
      itemsCollected: '5',
      itemsIdentified: '2',
      currencyEarned: '100',
      currencySpent: '30',
      floorsEntered: '4',
      deepestDepth: '3',
      turnsElapsed: '250',
      restsCompleted: '2',
    };
    for (const { key, label } of METRIC_ROWS) {
      expect(metricsSection.getByText(label).nextElementSibling).toHaveTextContent(
        expectedValues[key]!,
      );
    }
  });

  it('renders equipped gear read-only', () => {
    const snapshot = snapshotFor(baseRun);
    const hero = snapshot.projection.hero as unknown as {
      equipment: Readonly<Record<string, { name: string } | null>>;
    };
    renderSheet(snapshot);
    const equipmentSection = sectionFor('Equipment');
    for (const [slot, item] of Object.entries(hero.equipment)) {
      expect(equipmentSection.getByText(slot)).toBeInTheDocument();
      if (item) expect(equipmentSection.getByText(item.name)).toBeInTheDocument();
    }
  });

  it('omits a resistances section entirely, since projection.hero does not carry one', () => {
    const snapshot = snapshotFor(baseRun);
    expect('resistances' in (snapshot.projection.hero as object)).toBe(false);
    const { container } = renderSheet(snapshot);
    expect(container.innerHTML.toLowerCase()).not.toContain('resistance');
  });
});
