import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { RunConclusionProjection } from '@woven-deep/engine';
import { ConclusionScreen } from '../src/ui/screens/ConclusionScreen.js';
import type { LogLine } from '../src/session/event-log.js';
import { contentPack } from './content-pack-fixture.js';

const pack = contentPack('a'.repeat(64), ['monster', 'item']);

function projection(overrides: Partial<RunConclusionProjection> = {}): RunConclusionProjection {
  return {
    completionType: 'died',
    cause: { killerContentId: 'monster.rat', depth: 3, turn: 42, worldTime: 4200 },
    metrics: {
      kills: 2,
      killsByModel: { individual: 2, group: 0, swarm: 0, boss: 0 },
      bossKills: 0,
      championKills: 0,
      echoKills: 0,
      threatDefeated: 6,
      damageDealt: 30,
      damageTaken: 12,
      itemsCollected: 3,
      itemsIdentified: 1,
      currencyEarned: 0,
      currencySpent: 0,
      tradesCompleted: 0,
      floorsEntered: 3,
      deepestDepth: 3,
      discoveriesRevealed: 1,
      turnsElapsed: 42,
      restsCompleted: 0,
    },
    finalized: true,
    score: {
      lines: [
        { lineId: 'depth', quantity: 3, coefficient: 100, amount: 300 },
        { lineId: 'threat', quantity: 6, coefficient: 5, amount: 30 },
        { lineId: 'completion-bonus', quantity: 1, coefficient: 0, amount: 0 },
      ],
      total: 330,
    },
    heirloom: {
      contentId: 'item.lantern',
      sourceItemId: null,
      enchantment: null,
      condition: 100,
      charges: null,
      fuel: null,
      qualityRank: 1,
      displayName: "Ada's Lantern",
      glyph: '¤',
      color: '#eeeeaa',
      originatingHallRecordId: 'record.test',
    },
    achievements: [
      {
        achievementId: 'achievement.first-blood',
        criteriaId: 'first-champion-defeat',
        name: 'First Blood',
      },
    ],
    ...overrides,
  };
}

function logTail(): readonly LogLine[] {
  return [
    { id: 1, text: 'You strike the creature down.', tone: 'combat' },
    { id: 2, text: 'Something lunges out of the dark.', tone: 'combat' },
    { id: 3, text: 'You take 12 damage.', tone: 'combat' },
  ];
}

describe('ConclusionScreen', () => {
  it('renders the cause with the killer name and depth/turn facts', () => {
    render(
      <ConclusionScreen
        projection={projection()}
        pack={pack}
        logTail={logTail()}
        onHall={vi.fn()}
        onNewHero={vi.fn()}
        onTitle={vi.fn()}
      />,
    );

    expect(screen.getByText(/Rat/)).toBeInTheDocument();
    expect(screen.getByText(/depth 3/i)).toBeInTheDocument();
    expect(screen.getByText(/turn 42/i)).toBeInTheDocument();
  });

  it('attributes an environmental death to no named killer', () => {
    render(
      <ConclusionScreen
        projection={projection({
          cause: { killerContentId: null, depth: 2, turn: 10, worldTime: 1000 },
        })}
        pack={pack}
        logTail={logTail()}
        onHall={vi.fn()}
        onNewHero={vi.fn()}
        onTitle={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Rat/)).not.toBeInTheDocument();
  });

  it('renders the last-moments recap from the supplied log tail', () => {
    render(
      <ConclusionScreen
        projection={projection()}
        pack={pack}
        logTail={logTail()}
        onHall={vi.fn()}
        onNewHero={vi.fn()}
        onTitle={vi.fn()}
      />,
    );

    for (const line of logTail()) {
      expect(screen.getByText(line.text)).toBeInTheDocument();
    }
  });

  it('renders the itemized score table rows from the score breakdown', () => {
    render(
      <ConclusionScreen
        projection={projection()}
        pack={pack}
        logTail={logTail()}
        onHall={vi.fn()}
        onNewHero={vi.fn()}
        onTitle={vi.fn()}
      />,
    );

    expect(screen.getByRole('table', { name: /score/i })).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('330')).toBeInTheDocument();
  });

  it('renders the heirloom and any granted achievements', () => {
    render(
      <ConclusionScreen
        projection={projection()}
        pack={pack}
        logTail={logTail()}
        onHall={vi.fn()}
        onNewHero={vi.fn()}
        onTitle={vi.fn()}
      />,
    );

    expect(screen.getByText(/Ada's Lantern/)).toBeInTheDocument();
    expect(screen.getByText(/First Blood/)).toBeInTheDocument();
  });

  it('marks the standing as unverified and session-only', () => {
    render(
      <ConclusionScreen
        projection={projection()}
        pack={pack}
        logTail={logTail()}
        onHall={vi.fn()}
        onNewHero={vi.fn()}
        onTitle={vi.fn()}
      />,
    );

    expect(screen.getByText(/unverified/i)).toBeInTheDocument();
    expect(screen.getByText(/this session only/i)).toBeInTheDocument();
  });

  it.each([
    {
      completionType: 'became-heart' as const,
      headline: /you have become the heart/i,
      epilogue: /bindings close around you/i,
    },
    {
      completionType: 'refused' as const,
      headline: /you have refused the deep/i,
      epilogue: /crumbling passages/i,
    },
    {
      completionType: 'broke-cycle' as const,
      headline: /you have broken the cycle/i,
      epilogue: /cycle .* ends here/i,
    },
  ])(
    'renders a distinct headline and epilogue for $completionType',
    ({ completionType, headline, epilogue }) => {
      render(
        <ConclusionScreen
          projection={projection({
            completionType,
            cause: { killerContentId: null, depth: 20, turn: 900, worldTime: 90000 },
          })}
          pack={pack}
          logTail={logTail()}
          onHall={vi.fn()}
          onNewHero={vi.fn()}
          onTitle={vi.fn()}
        />,
      );

      expect(screen.getByRole('heading', { name: headline })).toBeInTheDocument();
      expect(screen.getByText(epilogue)).toBeInTheDocument();
    },
  );

  it('offers the three actions as keyboard-reachable buttons', async () => {
    const user = userEvent.setup();
    const onHall = vi.fn();
    const onNewHero = vi.fn();
    const onTitle = vi.fn();

    render(
      <ConclusionScreen
        projection={projection()}
        pack={pack}
        logTail={logTail()}
        onHall={onHall}
        onNewHero={onNewHero}
        onTitle={onTitle}
      />,
    );

    expect(screen.getByRole('option', { name: /hall/i })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onHall).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onNewHero).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onTitle).toHaveBeenCalledTimes(1);
  });
});
