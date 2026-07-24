import { describe, expect, it } from 'vitest';
import { placeFloorPopulations } from '../src/index.js';
import { buildGuaranteedBossFixture } from './helpers/guaranteed-boss-fixture.js';

describe('guaranteed vault-gated boss pre-pass', () => {
  it('force-places a boss whose non-empty required vault tags are present on the floor', () => {
    const { content, run, floor } = buildGuaranteedBossFixture({ arenaTagPresent: true });
    const result = placeFloorPopulations({ run, floor, content });
    const bossActors = result.state.actors.filter(
      (actor) => actor.contentId === 'monster.arena-boss',
    );
    expect(bossActors).toHaveLength(1);
  });

  it('does not force-place the boss when the arena tag is absent (no vault) — RNG untouched', () => {
    const withArena = buildGuaranteedBossFixture({ arenaTagPresent: true });
    const withoutArena = buildGuaranteedBossFixture({ arenaTagPresent: false });
    const result = placeFloorPopulations({
      run: withoutArena.run,
      floor: withoutArena.floor,
      content: withoutArena.content,
    });
    const bossActors = result.state.actors.filter(
      (actor) => actor.contentId === 'monster.arena-boss',
    );
    expect(bossActors).toHaveLength(0);
    // The encounters RNG stream is untouched when the pre-pass places nothing and no weighted
    // encounter is eligible on the bare floor.
    expect(result.state.rng.encounters).toEqual(withoutArena.run.rng.encounters);
    expect(withArena.content).toBeDefined();
  });

  it('excludes an empty-vault-tag boss from the pre-pass (weighted behavior preserved)', () => {
    const { content, run, floor } = buildGuaranteedBossFixture({
      arenaTagPresent: true,
      emptyTagBoss: true,
    });
    const result = placeFloorPopulations({ run, floor, content });
    // The empty-tag boss is never force-placed; only the tagged arena boss is guaranteed.
    const emptyTagActors = result.state.actors.filter(
      (actor) => actor.contentId === 'monster.wild-boss',
    );
    expect(emptyTagActors).toHaveLength(0);
  });

  it('throws the internal-invariant error instead of silently dropping a guaranteed boss that cannot anchor', () => {
    // The boss is eligible and its arena tags ARE present (a `guaranteedBosses` member), but its
    // only legal vault anchor cell is reserved by a pre-existing entity, so `placePopulation`
    // can find no legal placement and returns `status: 'skipped'` (the boss's `failureMode` is
    // `optional`). Before the fix this silently left the run without its guaranteed boss; now
    // the pre-pass must fail loudly instead.
    const { content, run, floor } = buildGuaranteedBossFixture({
      arenaTagPresent: true,
      blockArenaSlot: true,
    });
    expect(() => placeFloorPopulations({ run, floor, content })).toThrow(
      /internal invariant.*encounter\.arena-boss.*depth 3/s,
    );
  });
});
