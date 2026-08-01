import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, CurseContentEntry, ItemContentEntry } from '@woven-deep/content';
import {
  compileContentDirectory,
  type MerchantEncounterContentEntry,
} from '@woven-deep/content/compiler';
import {
  createDemoContentPack,
  createDemoRun,
  deriveRunActorStats,
  dropItem,
  encodeActiveRun,
  equipmentPlan,
  identifyItemCompletely,
  merchantAcceptsItem,
  resolveCommand,
  unequipItem,
  type ItemInstance,
} from '../src/index.js';

function definition(id: string, overrides: Partial<ItemContentEntry>): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    glyph: '/',
    color: '#ffffff',
    tags: [],
    category: 'weapon',
    stackLimit: 1,
    price: 10,
    rarity: 'common',
    minDepth: 0,
    maxDepth: 20,
    actionCost: 100,
    equipment: null,
    combat: null,
    light: null,
    artifact: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
    ...overrides,
  };
}

function pack(...entries: (ItemContentEntry | CurseContentEntry)[]): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, ...entries] };
}

function item(itemId: string, contentId: string, location: ItemInstance['location']): ItemInstance {
  return {
    itemId,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location,
  };
}

const leadenWeight: CurseContentEntry = {
  kind: 'curse',
  id: 'curse.leaden-weight',
  name: 'Leaden Weight',
  tags: ['curse', 'weapon'],
  revealText: 'It settles onto you like wet earth, and does not lift.',
  drawbackModifiers: { defense: -1, meleeAccuracy: -1 },
  trigger: null,
};

const sword = definition('item.sword.cursed', {
  equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
  combat: { accuracy: 0, defense: 8, armor: 0, damage: null, range: 1, ammunitionTag: null },
});

const axe = definition('item.axe', {
  equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
  combat: {
    accuracy: 0,
    defense: 0,
    armor: 0,
    damage: { count: 1, sides: 8, bonus: 0 },
    range: 1,
    ammunitionTag: null,
  },
});

const swordId = 'item.sword.cursed.1';
const axeId = 'item.axe.1';

function withBackpackCursedSword(curse: { revealed: boolean }) {
  const base = createDemoRun();
  const swordItem: ItemInstance = {
    ...item(swordId, sword.id, { type: 'backpack', actorId: 'hero.demo' }),
    identified: false,
    curse: { curseId: 'curse.leaden-weight', revealed: curse.revealed },
  };
  return { run: { ...base, items: [swordItem] }, content: pack(sword, axe, leadenWeight) };
}

function withEquippedCursedSword(curse: { revealed: boolean }) {
  const base = createDemoRun();
  const swordItem: ItemInstance = {
    ...item(swordId, sword.id, { type: 'equipped', actorId: 'hero.demo', slot: 'main-hand' }),
    identified: false,
    curse: { curseId: 'curse.leaden-weight', revealed: curse.revealed },
  };
  const axeItem: ItemInstance = item(axeId, axe.id, { type: 'backpack', actorId: 'hero.demo' });
  const hero = {
    ...base.actors[0]!,
    equipment: { ...base.actors[0]!.equipment, 'main-hand': swordItem.itemId },
  };
  return {
    run: { ...base, actors: [hero], items: [swordItem, axeItem] },
    content: pack(sword, axe, leadenWeight),
  };
}

function heroId(): string {
  return 'hero.demo';
}

function itemOf(run: ReturnType<typeof createDemoRun>, itemId: string): ItemInstance {
  return run.items.find((candidate) => candidate.itemId === itemId)! as ItemInstance;
}

describe('sticky equipment and curse.revealed', () => {
  it('reveals the curse and emits curse.revealed when the item is equipped', () => {
    const { run, content } = withBackpackCursedSword({ revealed: false });
    const resolved = resolveCommand(
      run,
      {
        type: 'equip',
        commandId: 'command.equip',
        expectedRevision: 0,
        itemId: swordId,
        slot: 'main-hand',
      },
      { content },
    );
    expect(resolved.result).toMatchObject({ status: 'applied' });
    expect(resolved.events).toContainEqual(
      expect.objectContaining({
        type: 'curse.revealed',
        curseId: 'curse.leaden-weight',
        revealText: leadenWeight.revealText,
      }),
    );
    expect(itemOf(resolved.state, swordId).curse).toEqual({
      curseId: 'curse.leaden-weight',
      revealed: true,
    });
  });

  it('refuses to unequip a revealed cursed item through resolveCommand, and the resulting action.invalid event encodes cleanly', () => {
    const { run, content } = withBackpackCursedSword({ revealed: false });
    const equipped = resolveCommand(
      run,
      {
        type: 'equip',
        commandId: 'command.equip',
        expectedRevision: 0,
        itemId: swordId,
        slot: 'main-hand',
      },
      { content },
    );
    expect(equipped.result).toMatchObject({ status: 'applied' });
    expect(itemOf(equipped.state, swordId).curse!.revealed).toBe(true);

    const unequipped = resolveCommand(
      equipped.state,
      { type: 'unequip', commandId: 'command.unequip', expectedRevision: 1, slot: 'main-hand' },
      { content },
    );
    expect(unequipped.result).toMatchObject({ status: 'invalid', reason: 'item.cursed' });
    expect(unequipped.events).toContainEqual(
      expect.objectContaining({ type: 'action.invalid', reason: 'item.cursed' }),
    );
    expect(() => encodeActiveRun(unequipped.state)).not.toThrow();
  });

  it('refuses to unequip a revealed cursed item', () => {
    const { run } = withEquippedCursedSword({ revealed: true });
    expect(unequipItem({ run, actorId: heroId(), slot: 'main-hand' })).toEqual({
      ok: false,
      reason: 'item.cursed',
    });
  });

  it('refuses to displace a revealed cursed item when equipping over its slot', () => {
    const { run, content } = withEquippedCursedSword({ revealed: true });
    expect(
      equipmentPlan({ run, content, actorId: heroId(), itemId: axeId, slot: 'main-hand' }),
    ).toEqual({ ok: false, reason: 'item.cursed' });
  });

  it('still allows unequipping a cursed item whose curse is unrevealed', () => {
    const { run } = withEquippedCursedSword({ revealed: false });
    expect(unequipItem({ run, actorId: heroId(), slot: 'main-hand' }).ok).toBe(true);
  });

  it('reveals the curse when the item is identified, without equipping it', () => {
    const { run, content } = withBackpackCursedSword({ revealed: false });
    const identified = identifyItemCompletely({ run, content, itemId: swordId, eventId: 'e1' });
    expect(itemOf(identified.state, swordId).curse!.revealed).toBe(true);
    expect(itemOf(identified.state, swordId).location.type).toBe('backpack');
    expect(identified.events).toContainEqual(expect.objectContaining({ type: 'curse.revealed' }));
  });

  it('lets a backpack-revealed cursed item be dropped freely', () => {
    const { run } = withBackpackCursedSword({ revealed: true });
    expect(dropItem({ run, actorId: heroId(), itemId: swordId, quantity: 1 }).ok).toBe(true);
  });

  it('refuses to drop an equipped cursed item', () => {
    const { run } = withEquippedCursedSword({ revealed: true });
    expect(dropItem({ run, actorId: heroId(), itemId: swordId, quantity: 1 })).toEqual({
      ok: false,
      reason: 'item.unavailable',
    });
  });
});

describe('merchant refusal of a revealed cursed item', () => {
  let realContent: CompiledContentPack;
  let encounter: MerchantEncounterContentEntry;
  let realSword: ItemContentEntry;

  beforeAll(async () => {
    realContent = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    encounter = realContent.entries.find(
      (entry): entry is MerchantEncounterContentEntry =>
        entry.kind === 'encounter' && entry.model === 'merchant' && !entry.definition.permanent,
    )!;
    realSword = realContent.entries.find(
      (entry): entry is ItemContentEntry => entry.kind === 'item' && entry.id === 'item.iron-sword',
    )!;
  });

  function backpackInstance(curse: { revealed: boolean }): ItemInstance {
    return {
      ...item('item.sword.real.1', realSword.id, { type: 'backpack', actorId: 'hero.demo' }),
      identified: false,
      curse: { curseId: 'curse.leaden-weight', revealed: curse.revealed },
    };
  }

  it('refuses to buy a revealed cursed item', () => {
    expect(
      merchantAcceptsItem(backpackInstance({ revealed: true }), realSword, encounter, new Set()),
    ).toBe(false);
  });

  it('still buys an item whose curse is unrevealed', () => {
    expect(
      merchantAcceptsItem(backpackInstance({ revealed: false }), realSword, encounter, new Set()),
    ).toBe(true);
  });
});

describe('shipped curse drawbacks bite', () => {
  let realContent: CompiledContentPack;

  beforeAll(async () => {
    realContent = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
  });

  /** Derived hero stats with `curse` attached to an equipped sword, and with nothing attached. */
  function statsWithCurse(curseId: string | null) {
    const content = {
      ...createDemoContentPack(),
      entries: [
        ...createDemoContentPack().entries,
        sword,
        ...realContent.entries.filter((entry) => entry.kind === 'curse'),
      ],
    } as CompiledContentPack;
    const base = createDemoRun();
    const swordItem: ItemInstance = {
      ...item(swordId, sword.id, { type: 'equipped', actorId: 'hero.demo', slot: 'main-hand' }),
      identified: true,
      ...(curseId === null ? {} : { curse: { curseId, revealed: true } }),
    };
    const hero = {
      ...base.actors[0]!,
      equipment: { ...base.actors[0]!.equipment, 'main-hand': swordItem.itemId },
    };
    const run = { ...base, actors: [hero], items: [swordItem] };
    return deriveRunActorStats({ state: run, content, actor: hero });
  }

  it('gives curse.hungering-edge a drawback that reaches the hero', () => {
    const hungeringEdge = realContent.entries.find(
      (entry): entry is CurseContentEntry =>
        entry.kind === 'curse' && entry.id === 'curse.hungering-edge',
    )!;
    expect(Object.keys(hungeringEdge.drawbackModifiers)).not.toContain('maxHealth');
    expect(statsWithCurse('curse.hungering-edge').meleeAccuracy).toBe(
      statsWithCurse(null).meleeAccuracy - 2,
    );
  });
});
