import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack } from '@woven-deep/content';
import { runMagicDemo, stableJson } from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('magic demo', () => {
  it('is deterministic across two runs', () => {
    const a = runMagicDemo(pack);
    const b = runMagicDemo(pack);
    expect(stableJson(a.records.map((r) => r.projection))).toBe(
      stableJson(b.records.map((r) => r.projection)),
    );
    expect(stableJson(a.state)).toBe(stableJson(b.state));
  });

  it('proves learn, all four cast shapes, a burn tick, and recall+return', () => {
    const result = runMagicDemo(pack);
    const types = new Set(result.records.flatMap((r) => r.authoritativeEvents.map((e) => e.type)));
    expect(types.has('spell.learned')).toBe(true);
    expect(types.has('hero.recalled')).toBe(true);
    expect(types.has('attack.hit')).toBe(true);
    expect(types.has('condition.applied')).toBe(true);
    const boundaries = result.records.map((r) => r.boundary);
    expect(boundaries).toContain('after-return');
  });

  it('actually damages a distinct actor in each of the four cast shapes', () => {
    const result = runMagicDemo(pack);
    const boundary = (name: string) => result.records.find((r) => r.boundary === name)!;
    for (const name of ['after-single', 'after-burst', 'after-line', 'after-cone']) {
      const record = boundary(name);
      expect(record.commandResult.status).toBe('applied');
      expect(record.authoritativeEvents.some((event) => event.type === 'attack.hit')).toBe(true);
      expect(record.authoritativeEvents.some((event) => event.type === 'actor.damaged')).toBe(true);
    }
    // The burst/line/cone AoE shapes must damage more than one distinct actor, not just
    // repeatedly hit the same one -- otherwise a regression that narrows AoE targeting
    // back to a single actor would still pass the assertions above.
    for (const name of ['after-burst', 'after-line', 'after-cone']) {
      const record = boundary(name);
      const damagedActorIds = new Set(
        record.authoritativeEvents
          .filter((event) => event.type === 'actor.damaged')
          .map((event) => event.actorId),
      );
      expect(damagedActorIds.size).toBeGreaterThan(1);
    }
    // The burst also applies a burn condition (fireball's second effect).
    expect(
      boundary('after-burst').authoritativeEvents.some(
        (event) => event.type === 'condition.applied',
      ),
    ).toBe(true);
    // The self-buff cast applies a duration condition to the hero, not damage.
    const shield = boundary('after-shield');
    expect(shield.commandResult.status).toBe('applied');
    expect(shield.authoritativeEvents.some((event) => event.type === 'condition.applied')).toBe(
      true,
    );
    expect(shield.authoritativeEvents.some((event) => event.type === 'attack.hit')).toBe(false);
  });

  it('learns the tome spell before any casting happens', () => {
    const result = runMagicDemo(pack);
    const learn = result.records.find((r) => r.boundary === 'after-learn')!;
    expect(
      learn.authoritativeEvents.some(
        (event) => event.type === 'spell.learned' && event.spellId === 'spell.frost-shard',
      ),
    ).toBe(true);
  });

  it('recalls to town and returns to the same anchored dungeon floor', () => {
    const result = runMagicDemo(pack);
    const beforeRecall = result.records.find((r) => r.boundary === 'after-cone')!.projection;
    const recall = result.records.find((r) => r.boundary === 'after-recall')!;
    const back = result.records.find((r) => r.boundary === 'after-return')!;
    expect(recall.authoritativeEvents.some((event) => event.type === 'hero.recalled')).toBe(true);
    expect(recall.projection.floor.floorId).not.toBe(beforeRecall.floor.floorId);
    expect(back.projection.floor.floorId).toBe(beforeRecall.floor.floorId);
  });
});
