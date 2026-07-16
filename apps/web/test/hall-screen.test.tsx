import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type {
  FallenChampionTemplateContentEntry, ItemContentEntry, MonsterContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack, createDemoRun, createInMemoryRunRecordRepository, emptyRunMetrics, finalizeRun,
  type ActiveRun, type LifetimeState, type RunMetrics, type RunRecordRepository, type StoredHallRecord,
  type Uint32State,
} from '@woven-deep/engine';
import type { CompletionType } from '@woven-deep/content';
import { HallScreen } from '../src/ui/screens/HallScreen.js';

const fallenChampionTemplate: FallenChampionTemplateContentEntry = {
  kind: 'fallen-champion-template', id: 'fallen-champion-template.core', name: "The Deep's Champion",
  tags: ['champion'], fallbackMonsterId: 'monster.boss', fallbackItemId: 'item.fallback',
  minimumHealth: 30, maximumHealth: 100, attributeMaximum: 20, damageMaximum: 24, abilityLimit: 2,
  echoAppearanceChance: 0.5, maximumEchoesPerRun: 2, echoHealthPercent: 65, echoDamagePercent: 70,
  echoDefensePercent: 80, echoAbilityLimit: 1, echoLootTableId: 'loot-table.boss',
  heirloomSelection: { rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 }, qualityRankBonus: 2 },
};

const fallbackItem: ItemContentEntry = {
  kind: 'item', id: 'item.fallback', name: 'Fallback item', tags: [], glyph: ')', color: '#c0c0c0',
  category: 'weapon', stackLimit: 1, price: 10, rarity: 'common', heirloomEligible: true, minDepth: 1, maxDepth: 20,
  actionCost: 100, equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
  combat: null, light: null, identification: { mode: 'known', poolId: null }, effects: [],
};

const fallbackMonster: MonsterContentEntry = {
  kind: 'monster', id: 'monster.boss', name: 'Boss', glyph: 'B', color: '#aa4444', tags: [],
  minDepth: 1, maxDepth: 20,
  attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
  health: 10, speed: 100, accuracy: 100, defense: 8, perception: 8,
  damage: { count: 1, sides: 1, bonus: 0 }, armor: 0,
  resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
  disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
  rarity: 'common', threat: 4,
};

function emptyLifetime(): LifetimeState {
  return {
    conqueredChampionRecordIds: [], grantedAchievementIds: [], discoveryProtection: [], totals: emptyRunMetrics(),
  };
}

/** Builds a genuine `StoredHallRecord` by driving the real engine's `finalizeRun` (following
 * `run-records-storage.test.ts`'s approach) over a demo run whose seed, hero identity, conclusion
 * and metrics are overridden directly — this varies completion type/score without needing a full
 * command-by-command simulation for every outcome. */
function genuineRecord(input: Readonly<{
  runSeed: Uint32State;
  heroName: string;
  classTags: readonly string[];
  completionType: CompletionType;
  metrics: Partial<RunMetrics>;
  achievedAt: string;
  portraitGlyph: string;
}>): StoredHallRecord {
  const base = createDemoContentPack();
  const content = { ...base, entries: [...base.entries, fallenChampionTemplate, fallbackItem, fallbackMonster] };
  const demo = createDemoRun();
  const metrics: RunMetrics = { ...emptyRunMetrics(), ...input.metrics };
  const run: ActiveRun = {
    ...demo,
    runSeed: input.runSeed,
    hero: { ...demo.hero, name: input.heroName, classTags: input.classTags },
    metrics,
    conclusion: {
      completionType: input.completionType,
      cause: { killerContentId: null, depth: metrics.deepestDepth, turn: 10, worldTime: 1000 },
      concludedAtRevision: 0,
      finalized: false,
    },
  };
  const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
  return { ...finalized.record, enrichment: { achievedAt: input.achievedAt, portraitGlyph: input.portraitGlyph } };
}

/** Three genuine records with deliberately non-monotonic tier/score: `diedHighScore` outscores
 * everything on raw depth alone, but its `died` tier is the lowest, so a correct
 * `compareHallRecords` sort must still place it LAST — this exercises tier-before-score, not just
 * an already-sorted list. */
function threeRecords(): { diedHighScore: StoredHallRecord; becameHeart: StoredHallRecord; brokeCycle: StoredHallRecord } {
  const diedHighScore = genuineRecord({
    runSeed: [1, 1, 1, 1], heroName: 'Ada', classTags: ['fighter'], completionType: 'died',
    metrics: { deepestDepth: 20 }, achievedAt: 'Run #1', portraitGlyph: '@',
  });
  const becameHeart = genuineRecord({
    runSeed: [2, 2, 2, 2], heroName: 'Bryn', classTags: ['mage'], completionType: 'became-heart',
    metrics: { deepestDepth: 1 }, achievedAt: 'Run #2', portraitGlyph: '&',
  });
  const brokeCycle = genuineRecord({
    runSeed: [3, 3, 3, 3], heroName: 'Corin', classTags: ['ranger'], completionType: 'broke-cycle',
    metrics: { deepestDepth: 1 }, achievedAt: 'Run #3', portraitGlyph: '%',
  });
  return { diedHighScore, becameHeart, brokeCycle };
}

function repositoryWith(records: readonly StoredHallRecord[]): RunRecordRepository {
  const repository = createInMemoryRunRecordRepository();
  for (const record of records) repository.appendRecord(record);
  return repository;
}

/** The listbox's own `role="option"` rows, scoped away from the native `<select><option>`
 * elements (which also carry an implicit `option` role) rendered by the outcome/class filters. */
function hallRows(): readonly HTMLElement[] {
  return within(screen.getByRole('listbox', { name: /hall records/i })).getAllByRole('option');
}

describe('HallScreen', () => {
  it('lists records sorted by compareHallRecords (tier before score)', () => {
    const { diedHighScore, becameHeart, brokeCycle } = threeRecords();
    const repository = repositoryWith([diedHighScore, becameHeart, brokeCycle]);

    render(<HallScreen repository={repository} onBack={vi.fn()} />);

    const rows = hallRows();
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('Corin')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Bryn')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Ada')).toBeInTheDocument();
  });

  it('shows portrait glyph, name, class tags, depth, score total, and the Run #N marker for each row', () => {
    const { diedHighScore } = threeRecords();
    const repository = repositoryWith([diedHighScore]);

    render(<HallScreen repository={repository} onBack={vi.fn()} />);

    const row = hallRows()[0]!;
    expect(within(row).getByText('@')).toBeInTheDocument();
    expect(within(row).getByText('Ada')).toBeInTheDocument();
    expect(within(row).getByText(/fighter/)).toBeInTheDocument();
    expect(within(row).getByText(new RegExp(String(diedHighScore.deepestDepth)))).toBeInTheDocument();
    expect(within(row).getByText(String(diedHighScore.score.total))).toBeInTheDocument();
    expect(within(row).getByText('Run #1')).toBeInTheDocument();
  });

  it('narrows the list with the outcome filter', async () => {
    const user = userEvent.setup();
    const { diedHighScore, becameHeart, brokeCycle } = threeRecords();
    const repository = repositoryWith([diedHighScore, becameHeart, brokeCycle]);

    render(<HallScreen repository={repository} onBack={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox', { name: /outcome/i }), 'died');

    const rows = hallRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText('Ada')).toBeInTheDocument();
  });

  it('narrows the list with the class filter', async () => {
    const user = userEvent.setup();
    const { diedHighScore, becameHeart, brokeCycle } = threeRecords();
    const repository = repositoryWith([diedHighScore, becameHeart, brokeCycle]);

    render(<HallScreen repository={repository} onBack={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox', { name: /class/i }), 'ranger');

    const rows = hallRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText('Corin')).toBeInTheDocument();
  });

  it('expands the score breakdown lines when Enter is pressed on a focused row', async () => {
    const user = userEvent.setup();
    const { diedHighScore } = threeRecords();
    const repository = repositoryWith([diedHighScore]);

    render(<HallScreen repository={repository} onBack={vi.fn()} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(hallRows()[0]).toHaveFocus();

    await user.keyboard('{Enter}');

    const table = screen.getByRole('table');
    const depthLine = diedHighScore.score.lines.find((line) => line.lineId === 'depth')!;
    expect(within(table).getByText('depth')).toBeInTheDocument();
    expect(within(table).getByText(String(depthLine.amount))).toBeInTheDocument();
    expect(within(table).getByText(String(diedHighScore.score.total))).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('every row and filter is keyboard-reachable', async () => {
    const user = userEvent.setup();
    const { diedHighScore, becameHeart } = threeRecords();
    const repository = repositoryWith([diedHighScore, becameHeart]);

    render(<HallScreen repository={repository} onBack={vi.fn()} />);

    const rows = hallRows();
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(rows[0]).toHaveFocus();

    screen.getByRole('combobox', { name: /outcome/i }).focus();
    expect(screen.getByRole('combobox', { name: /outcome/i })).toHaveFocus();
    screen.getByRole('combobox', { name: /class/i }).focus();
    expect(screen.getByRole('combobox', { name: /class/i })).toHaveFocus();
  });

  it('renders an explanatory line when the Hall is empty', () => {
    const repository = createInMemoryRunRecordRepository();

    render(<HallScreen repository={repository} onBack={vi.fn()} />);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText(/no runs have been recorded/i)).toBeInTheDocument();
  });

  it('marks the Hall as unverified and session-only', () => {
    const repository = createInMemoryRunRecordRepository();

    render(<HallScreen repository={repository} onBack={vi.fn()} />);

    expect(screen.getByText(/unverified/i)).toBeInTheDocument();
    expect(screen.getByText(/this session only/i)).toBeInTheDocument();
  });

  it('returns via onBack on Escape and via the Back button', async () => {
    const user = userEvent.setup();
    const onBackFromEscape = vi.fn();
    const repository = createInMemoryRunRecordRepository();

    const { unmount } = render(<HallScreen repository={repository} onBack={onBackFromEscape} />);
    await user.keyboard('{Escape}');
    expect(onBackFromEscape).toHaveBeenCalledTimes(1);
    unmount();

    const onBackFromButton = vi.fn();
    render(<HallScreen repository={repository} onBack={onBackFromButton} />);
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onBackFromButton).toHaveBeenCalledTimes(1);
  });
});
