import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { ClassContentEntry } from '@woven-deep/content';
import {
  createNewRun, DEFAULT_GUEST_HERO, decodeActiveRun, encodeActiveRun,
  heroActor, heroFromChoices, itemLightSources, resolveCommand, validateActiveRun, validateContentBoundRun,
  type HeroChoices, type ResolutionContext,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [11, 22, 33, 44] as const;

describe('createNewRun', () => {
  it('builds a valid, deterministic schema-v7 run on a generated depth-1 floor', () => {
    const first = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const second = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(encodeActiveRun(first)).toBe(encodeActiveRun(second));
    expect(() => validateActiveRun(first)).not.toThrow();
    expect(first.schemaVersion).toBe(7);
    expect(first.floors).toHaveLength(1);
    expect(first.floors[0]?.depth).toBe(1);
    expect(first.activeFloorId).toBe(first.floors[0]?.floorId);
    expect(first.metrics.floorsEntered).toBe(1);
    expect(first.metrics.deepestDepth).toBe(1);
    expect(first.conclusion).toBeNull();
    expect(first.contentHash).toBe(pack.hash);
  });

  it('places and equips the default hero', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = heroActor(run);
    expect(hero.playerControlled).toBe(true);
    expect(hero.attributes).toEqual({ might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 });
    expect(run.hero.name).toBe('Wayfarer');
    const floor = run.floors[0]!;
    expect({ x: hero.x, y: hero.y }).toEqual(floor.stairUp);
    const equippedContent = Object.values(hero.equipment)
      .filter((id): id is string => id !== null)
      .map((itemId) => run.items.find((item) => item.itemId === itemId)?.contentId)
      .sort();
    expect(equippedContent).toEqual(['item.iron-sword', 'item.leather-armor', 'item.pitch-torch']);
    const torch = run.items.find((item) => item.contentId === 'item.pitch-torch')!;
    expect(torch.enabled).toBe(true);
    expect(torch.fuel).toBe(800);
    const rations = run.items.find((item) => item.contentId === 'item.travel-ration')!;
    expect(rations.location).toEqual({ type: 'backpack', actorId: hero.actorId });
    expect(rations.quantity).toBe(3);
  });

  it('derives different runs from different seeds and round-trips the codec', () => {
    const a = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const b = createNewRun({ pack, seed: [5, 6, 7, 8], hero: DEFAULT_GUEST_HERO });
    expect(a.runId).not.toBe(b.runId);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(a)))).toBe(encodeActiveRun(a));
  });

  it('derives hero maxHealth from attributes and starts at full health', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(heroActor(run).maxHealth).toBe(20); // 10 + 10*1 with the retuned formula
    expect(heroActor(run).health).toBe(20);
    const tough = { ...DEFAULT_GUEST_HERO, attributes: { ...DEFAULT_GUEST_HERO.attributes, vitality: 14 } };
    const toughRun = createNewRun({ pack, seed: SEED, hero: tough });
    expect(heroActor(toughRun).maxHealth).toBe(24);
    expect(heroActor(toughRun).health).toBe(24);
  });

  it('carries classTags and statModifiers onto the hero state', () => {
    const run = createNewRun({
      pack, seed: SEED,
      hero: { ...DEFAULT_GUEST_HERO, classTags: ['wayfarer'], statModifiers: { search: 1 } },
    });
    expect(run.hero.classTags).toEqual(['wayfarer']);
    expect(run.hero.statModifiers).toEqual({ search: 1 });
  });

  it('ignores an enabled:true override on a non-light equipped item instead of propagating it (a hand-authored hero, or a stale kit, could still carry one)', () => {
    const run = createNewRun({
      pack, seed: SEED,
      hero: {
        ...DEFAULT_GUEST_HERO,
        equipped: [
          { contentId: 'item.iron-sword', slot: 'main-hand', enabled: true },
          { contentId: 'item.leather-armor', slot: 'body', enabled: true },
        ],
      },
    });
    const sword = run.items.find((item) => item.contentId === 'item.iron-sword')!;
    const armor = run.items.find((item) => item.contentId === 'item.leather-armor')!;
    expect(sword.enabled).toBeNull();
    expect(sword.fuel).toBeNull();
    expect(armor.enabled).toBeNull();
    // The real crash this guards against: content-bound validation (run by
    // resolveCommand on a hero's first command) rejects a non-light item that
    // carries fuel/enabled state. validateActiveRun alone does not catch this --
    // it only checks save-schema shape, not cross-referenced content invariants.
    expect(() => validateContentBoundRun(run, pack)).not.toThrow();
  });

  it('rejects an all-zero seed and unknown equipment content', () => {
    expect(() => createNewRun({ pack, seed: [0, 0, 0, 0], hero: DEFAULT_GUEST_HERO })).toThrow(/seed/i);
    expect(() => createNewRun({
      pack, seed: SEED,
      hero: { ...DEFAULT_GUEST_HERO, equipped: [{ contentId: 'item.no-such-thing', slot: 'main-hand' }] },
    })).toThrow(/item\.no-such-thing/);
  });

  // Closes the gap that let the kit-created-hero-crashes-on-first-command regression slip
  // through with only 1-of-4 bundled kits under test: every playable class's every kit must
  // survive chargen -> createNewRun -> content-bound validation -> a first resolved command.
  // Kits are discovered from the compiled pack (not hardcoded), so a future kit is covered
  // automatically instead of silently falling through untested.
  it('survives chargen, createNewRun, content-bound validation, and a first command for every playable class and kit', () => {
    const backgroundId = 'background.caravan-guard';
    const context: ResolutionContext = { content: pack };
    const playableClasses = pack.entries
      .filter((entry): entry is ClassContentEntry => entry.kind === 'class' && entry.playable);
    expect(playableClasses.length).toBeGreaterThan(0);

    let checked = 0;
    for (const classEntry of playableClasses) {
      for (const kit of classEntry.kits) {
        const choices: HeroChoices = {
          name: 'Coverage Hero',
          method: 'roll',
          attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
          classId: classEntry.id,
          kitId: kit.kitId,
          backgroundId,
          traitIds: [],
        };
        const hero = heroFromChoices({ pack, choices });
        const run = createNewRun({ pack, seed: SEED, hero });
        expect(() => validateContentBoundRun(run, pack)).not.toThrow();

        const wait = resolveCommand(
          run,
          { type: 'wait', commandId: `command.coverage-${classEntry.id}-${kit.kitId}`, expectedRevision: run.revision },
          context,
        );
        expect(wait.result.status).toBe('applied');
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});

// Regression: a guest hero always starts with a lit, equipped torch. If the hero dies from
// starvation mid-worldstep (in the advance-world-time branch, before another actor's pending
// turn is prepared), `itemLightSources` used to keep emitting a light for the now-dead hero
// (it only checked fuel/enabled, not wielder health) while the turn-preparation position map
// filters actors to `health > 0`. The lighting resolver then failed to resolve the dead
// hero's actor id and threw a RangeError, crashing the whole command.
describe('dead wielders and illumination', () => {
  it('does not crash illumination when a starving hero with a lit torch dies mid-command', () => {
    // Real depth-1 generation for this seed places a live individual-model population
    // (two hostile cave rats, already energy-ready) alongside the guest hero -- exactly the
    // "another actor's turn pending" condition that exposes the bug: one of those rats gets
    // its turn prepared in the same resolveWorldStep call that kills the hero from starvation.
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = heroActor(run);
    expect(run.items.find((item) => item.contentId === 'item.pitch-torch')?.enabled).toBe(true);
    expect(run.actors.filter((actor) => actor.actorId !== hero.actorId && actor.health > 0).length)
      .toBeGreaterThan(0);

    const dyingHero = { ...hero, health: 1 };
    const state = {
      ...run,
      actors: run.actors.map((actor) => actor.actorId === hero.actorId ? dyingHero : actor),
      survival: { ...run.survival, hungerReserve: 0, hungerStage: 'starving' as const, nextStarvationAt: 1 },
    };

    const context: ResolutionContext = { content: pack };
    let result: ReturnType<typeof resolveCommand>;
    expect(() => {
      result = resolveCommand(state, { type: 'wait', commandId: 'command.starve-with-torch', expectedRevision: state.revision }, context);
    }).not.toThrow();
    result = result!;
    expect(result.result.status).toBe('applied');
    expect(result.events.map((event) => event.type)).toContain('actor.died');
    const heroAfter = result.state.actors.find((actor) => actor.actorId === hero.actorId);
    expect(heroAfter?.health).toBe(0);
    expect(result.state.conclusion).not.toBeNull();
    expect(() => encodeActiveRun(result.state)).not.toThrow();

    // The dead hero's torch must no longer illuminate: it must not appear as a light source
    // referencing an actor absent from the floor's living-actor position map.
    const torch = result.state.items.find((item) => item.contentId === 'item.pitch-torch')!;
    const lights = itemLightSources({ run: result.state, content: pack, floorId: hero.floorId });
    expect(lights.some((light) => light.lightId === torch.itemId)).toBe(false);
  });
});
