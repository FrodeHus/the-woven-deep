import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createDemoRun,
  emptyRunMetrics,
  foldRunMetrics,
  type ActiveRun,
  type DomainEvent,
} from '../src/index.js';

let content: CompiledContentPack;
let state: ActiveRun;
beforeAll(async () => {
  content = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  state = createDemoRun();
});

function fold(events: readonly DomainEvent[]): ReturnType<typeof foldRunMetrics> {
  return foldRunMetrics({
    metrics: emptyRunMetrics(),
    state,
    content,
    events,
    turnAdvanced: false,
  });
}

describe('defeatedBossMonsterIds', () => {
  it('records the monster id of a defeated boss, resolved from the encounter', () => {
    const metrics = fold([
      {
        type: 'boss.defeated',
        eventId: 'event.x',
        populationId: 'population.1',
        actorId: 'actor.1',
        encounterId: 'encounter.ashfather',
      },
    ]);
    expect(metrics.defeatedBossMonsterIds).toEqual(['monster.ashfather']);
  });

  it('is empty when no boss was defeated and dedupes/sorts multiple', () => {
    expect(emptyRunMetrics().defeatedBossMonsterIds).toEqual([]);
    const metrics = fold([
      {
        type: 'boss.defeated',
        eventId: 'e1',
        populationId: 'population.1',
        actorId: 'actor.1',
        encounterId: 'encounter.tide-sovereign',
      },
      {
        type: 'boss.defeated',
        eventId: 'e2',
        populationId: 'population.1',
        actorId: 'actor.1',
        encounterId: 'encounter.ashfather',
      },
      {
        type: 'boss.defeated',
        eventId: 'e3',
        populationId: 'population.1',
        actorId: 'actor.1',
        encounterId: 'encounter.ashfather',
      },
    ]);
    expect(metrics.defeatedBossMonsterIds).toEqual(['monster.ashfather', 'monster.tide-sovereign']);
  });
});
