import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun, DEFAULT_GUEST_HERO, decodeActiveRun, encodeActiveRun,
  heroActor, validateActiveRun,
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

  it('ignores an enabled:true override on a non-light equipped item instead of propagating it (content kits set enabled on every slot, light or not)', () => {
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
    expect(() => validateActiveRun(run)).not.toThrow();
  });

  it('rejects an all-zero seed and unknown equipment content', () => {
    expect(() => createNewRun({ pack, seed: [0, 0, 0, 0], hero: DEFAULT_GUEST_HERO })).toThrow(/seed/i);
    expect(() => createNewRun({
      pack, seed: SEED,
      hero: { ...DEFAULT_GUEST_HERO, equipped: [{ contentId: 'item.no-such-thing', slot: 'main-hand' }] },
    })).toThrow(/item\.no-such-thing/);
  });
});
