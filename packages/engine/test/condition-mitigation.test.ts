import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type {
  CompiledContentPack,
  ConditionContentEntry,
  MonsterContentEntry,
} from '@woven-deep/content';
import {
  createDemoRun,
  expandLegacySeed,
  nextUint32,
  resolveEffectSequence,
  type ActorState,
  type Uint32State,
} from '../src/index.js';
import { combat, damageMitigation, profile } from '../src/combat-profile.js';

let basePack: CompiledContentPack;
let pack: CompiledContentPack;

// A pure-armor ward: +3 armor per stack, no resistance, no tick effects. Proves the
// `armorPerStack` half of the schema plumbs through both mitigation paths.
const shieldCondition: ConditionContentEntry = {
  kind: 'condition',
  id: 'condition.test-shield',
  name: 'Test Shield',
  tags: [],
  description: 'Synthetic armor ward used only by condition-mitigation.test.ts.',
  color: '#7090c0',
  duration: { mode: 'timed', default: 10, maximum: 20 },
  stacking: { mode: 'replace', maximumStacks: 1 },
  modifiersPerStack: {},
  traits: [],
  tickEffects: [],
  mitigation: { armorPerStack: 3 },
};

// A 50% fire ward: proves the `resistancePerStack` half of the schema.
const wardCondition: ConditionContentEntry = {
  kind: 'condition',
  id: 'condition.test-ward',
  name: 'Test Ward',
  tags: [],
  description: 'Synthetic fire ward used only by condition-mitigation.test.ts.',
  color: '#c07030',
  duration: { mode: 'timed', default: 10, maximum: 20 },
  stacking: { mode: 'replace', maximumStacks: 1 },
  modifiersPerStack: {},
  traits: [],
  tickEffects: [],
  mitigation: { resistancePerStack: { fire: 50 } },
};

// A 100% fire ward: proves resistance >= 100 flips `immune`.
const immuneWardCondition: ConditionContentEntry = {
  ...wardCondition,
  id: 'condition.test-ward-immune',
  mitigation: { resistancePerStack: { fire: 100 } },
};

// A 60%-per-stack fire ward. Stacked to 2 (`stacking.mode: 'intensify'`), the combined
// resistance is 120 -- OVER the 100 that `resolveDamage` (combat.ts) rejects with a RangeError.
// Proves the engine clamps the returned resistance to <=100 (and derives `immune` from the
// unclamped total) so stacking wards never crash resolveDamage.
const stackingWardCondition: ConditionContentEntry = {
  ...wardCondition,
  id: 'condition.test-ward-stacking',
  stacking: { mode: 'intensify', maximumStacks: 3 },
  mitigation: { resistancePerStack: { fire: 60 } },
};

// A condition with no `mitigation` block at all (the shape of every condition shipped today) —
// proves the plumbing is a strict no-op when the block is absent.
const noopCondition: ConditionContentEntry = {
  ...shieldCondition,
  id: 'condition.test-noop',
  mitigation: undefined,
};

// A synthetic monster with a fixed 1-sided damage die (always rolls 1) and a flat bonus, so rolled
// damage before mitigation is deterministic and independent of dice RNG (only the attack roll,
// forced to a natural 20 via `stateProducing(20)`, needs to be controlled). The bonus is kept well
// below the hero's health so mitigated/unmitigated damage never clamp to the same floored value.
const bruteMonster: MonsterContentEntry = {
  kind: 'monster',
  id: 'monster.test-brute',
  name: 'Test Brute',
  tags: [],
  glyph: 'B',
  color: '#902020',
  attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
  health: 20,
  speed: 100,
  accuracy: 0,
  defense: 0,
  perception: 0,
  damage: { count: 1, sides: 1, bonus: 8 },
  armor: 0,
  resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
  disposition: 'hostile',
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  minDepth: 1,
  maxDepth: 1,
  threat: 1,
  rarity: 'common',
  lootTableId: null,
  dropChance: 0,
};

beforeAll(async () => {
  basePack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  pack = {
    ...basePack,
    entries: [
      ...basePack.entries,
      shieldCondition,
      wardCondition,
      immuneWardCondition,
      stackingWardCondition,
      noopCondition,
      bruteMonster,
    ],
  };
});

function stateProducing(face: number, sides = 20): Uint32State {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  for (let seed = 1; seed < 100_000; seed += 1) {
    const state = expandLegacySeed(seed);
    const step = nextUint32(state);
    if (step.value < limit && (step.value % sides) + 1 === face) return state;
  }
  throw new Error(`no state found for d${sides} face ${face}`);
}

function heroWithConditions(conditionId: string | null, stacks = 1): ActorState {
  const run = createDemoRun();
  const hero = run.actors[0]!;
  return {
    ...hero,
    conditions: conditionId
      ? [
          {
            conditionId,
            sourceActorId: hero.actorId,
            appliedAt: 0,
            expiresAt: 100,
            stacks,
          },
        ]
      : [],
  };
}

function bruteActor(): ActorState {
  const run = createDemoRun();
  return {
    ...run.actors[0]!,
    actorId: 'monster.brute',
    contentId: 'monster.test-brute',
    playerControlled: false,
    disposition: 'hostile',
    conditions: [],
  };
}

function meleeDamageAgainst(hero: ActorState): number {
  const run = createDemoRun();
  const attacker = bruteActor();
  const actors = [attacker, hero];
  const result = combat({
    actors,
    combatState: stateProducing(20),
    attackerId: attacker.actorId,
    targetActorId: hero.actorId,
    eventId: 'command.attack',
    content: pack,
    items: [],
    survival: run.survival,
    populations: [],
    fallenHeroStandings: [],
    worldTime: 0,
    hero: run.hero,
  });
  const damagedHero = result.actors.find((actor) => actor.actorId === hero.actorId)!;
  return hero.health - damagedHero.health;
}

function tickDamage(hero: ActorState, damageType: 'physical' | 'fire' = 'fire'): number {
  const run = createDemoRun();
  const step = resolveEffectSequence({
    effects: [
      {
        effectId: 'effect.damage',
        parameters: { damageType, dice: { count: 1, sides: 1, bonus: 9 } },
        requiresLivingTarget: true,
      },
    ],
    actors: [hero],
    content: pack,
    sourceActorId: hero.actorId,
    targetActorId: hero.actorId,
    effectsState: expandLegacySeed(1),
    worldTime: 0,
    eventId: 'command.tick',
    forceMoveDirection: { x: 1, y: 0 },
    operations: {},
    survival: run.survival,
    survivalActorId: hero.actorId,
    mitigationByActorId: { [hero.actorId]: damageMitigation(hero, pack, damageType) },
  });
  const damaged = step.actors.find((actor) => actor.actorId === hero.actorId)!;
  return hero.health - damaged.health;
}

describe('condition-based damage mitigation', () => {
  it('(a) an armor-ward condition reduces both a physical tick and a direct melee attack by armorPerStack * stacks', () => {
    const unshielded = heroWithConditions(null);
    const shielded = heroWithConditions('condition.test-shield');

    const meleeUnshielded = meleeDamageAgainst(unshielded);
    const meleeShielded = meleeDamageAgainst(shielded);
    expect(meleeUnshielded - meleeShielded).toBe(3);

    // Reuse the same damage pipeline for a physical tick via `damageMitigation` directly, mirroring
    // production's `mitigationFor` seam (world-step.ts -> condition-tick.ts).
    const mitigationUnshielded = damageMitigation(unshielded, pack, 'physical');
    const mitigationShielded = damageMitigation(shielded, pack, 'physical');
    expect(mitigationShielded.armor - mitigationUnshielded.armor).toBe(3);

    const tickUnshielded = tickDamage(unshielded, 'physical');
    const tickShielded = tickDamage(shielded, 'physical');
    expect(tickUnshielded - tickShielded).toBe(3);
  });

  it('(b) a resistance-ward condition halves fire tick damage', () => {
    const unwarded = heroWithConditions(null);
    const warded = heroWithConditions('condition.test-ward');
    const unwardedDamage = tickDamage(unwarded);
    const wardedDamage = tickDamage(warded);
    expect(unwardedDamage).toBe(10);
    expect(wardedDamage).toBe(5);
  });

  it('(c) a 100%-fire-resistance ward condition makes the actor immune to fire damage', () => {
    const immune = heroWithConditions('condition.test-ward-immune');
    expect(tickDamage(immune)).toBe(0);
    expect(damageMitigation(immune, pack, 'fire').immune).toBe(true);
  });

  it('(d) a condition with no mitigation block is a strict no-op', () => {
    const bare = heroWithConditions(null);
    const noop = heroWithConditions('condition.test-noop');
    expect(damageMitigation(noop, pack, 'physical')).toEqual(
      damageMitigation(bare, pack, 'physical'),
    );
    expect(damageMitigation(noop, pack, 'fire')).toEqual(damageMitigation(bare, pack, 'fire'));
    expect(profile(noop, pack)).toEqual(profile(bare, pack));
    expect(meleeDamageAgainst(noop)).toBe(meleeDamageAgainst(bare));
  });

  it('scales armorPerStack by stacks', () => {
    const twoStacks = heroWithConditions('condition.test-shield', 2);
    expect(damageMitigation(twoStacks, pack, 'physical').armor).toBe(6);
  });

  it('(e) stacking wards whose combined resistance exceeds 100 resolve to immune/0 damage without throwing', () => {
    // Two stacks of a 60%-per-stack ward sum to 120% -- over resolveDamage's supported range.
    // Before the clamp in combat-profile.ts, damageMitigation returned resistance: 120 unmodified
    // and resolveDamage (combat.ts:18-20) threw `RangeError: ... outside their supported range`.
    const overcapped = heroWithConditions('condition.test-ward-stacking', 2);
    const mitigation = damageMitigation(overcapped, pack, 'fire');
    expect(mitigation.resistance).toBeLessThanOrEqual(100);
    expect(mitigation.resistance).toBeGreaterThanOrEqual(-100);
    expect(mitigation.immune).toBe(true);
    expect(() => tickDamage(overcapped)).not.toThrow();
    expect(tickDamage(overcapped)).toBe(0);

    // The melee/profile() path must clamp identically -- also must not throw. profile() only ever
    // tracks 'physical' resistance (melee/ranged attacks are hardcoded physical, see combat()), and
    // this ward only grants fire resistance, so profile() itself reports no resistance/immunity here;
    // the assertion is that it stays in-range and doesn't throw, mirroring the fire-specific checks
    // above via damageMitigation.
    expect(() => meleeDamageAgainst(overcapped)).not.toThrow();
    const meleeProfile = profile(overcapped, pack);
    expect(meleeProfile.resistance).toBeLessThanOrEqual(100);
    expect(meleeProfile.resistance).toBeGreaterThanOrEqual(-100);
    expect(meleeProfile.armor).toBeGreaterThanOrEqual(0);
  });

  it('(f) a combined resistance well above 100 (three stacks, 180%) still clamps to immune/0, no throw', () => {
    const wayOvercapped = heroWithConditions('condition.test-ward-stacking', 3);
    const mitigation = damageMitigation(wayOvercapped, pack, 'fire');
    expect(mitigation.resistance).toBeLessThanOrEqual(100);
    expect(mitigation.immune).toBe(true);
    expect(() => tickDamage(wayOvercapped)).not.toThrow();
    expect(tickDamage(wayOvercapped)).toBe(0);
  });

  it('(g) a single-stack 50% ward still halves damage (regression, unchanged by the clamp)', () => {
    const warded = heroWithConditions('condition.test-ward');
    expect(tickDamage(warded)).toBe(5);
    const mitigation = damageMitigation(warded, pack, 'fire');
    expect(mitigation.resistance).toBe(50);
    expect(mitigation.immune).toBe(false);
  });

  it('(h) the no-mitigation-block case remains unchanged (regression)', () => {
    const bare = heroWithConditions(null);
    expect(damageMitigation(bare, pack, 'physical')).toEqual({
      armor: 0,
      resistance: 0,
      immune: false,
    });
  });
});
