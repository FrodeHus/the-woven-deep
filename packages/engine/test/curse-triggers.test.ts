import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, CurseContentEntry, ItemContentEntry } from '@woven-deep/content';
import {
  applyCurseTriggers,
  createDemoContentPack,
  createDemoRun,
  type ActiveRun,
  type DomainEvent,
  type ItemInstance,
} from '../src/index.js';

const HERO_ID = 'hero.demo';

function itemDefinition(id: string, slot: 'main-hand' | 'body'): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    glyph: '/',
    color: '#ffffff',
    tags: [],
    category: slot === 'main-hand' ? 'weapon' : 'armor',
    stackLimit: 1,
    price: 10,
    rarity: 'common',
    minDepth: 0,
    maxDepth: 20,
    actionCost: 100,
    equipment: { slots: [slot], handedness: 'one-handed', reservedSlots: [] },
    combat: null,
    light: null,
    artifact: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
  };
}

const sword = itemDefinition('item.cursed-sword', 'main-hand');
const mail = itemDefinition('item.cursed-mail', 'body');

function damageCurse(
  id: string,
  on: 'on-kill' | 'on-hurt-below-half' | 'on-floor-enter',
): CurseContentEntry {
  return curse(id, {
    on,
    chanceBps: 10000,
    effect: {
      effectId: 'effect.damage',
      requiresLivingTarget: true,
      parameters: { damageType: 'arcane', dice: { count: 1, sides: 3, bonus: 0 } },
    },
  });
}

function curse(id: string, trigger: CurseContentEntry['trigger']): CurseContentEntry {
  return {
    kind: 'curse',
    id,
    name: id,
    tags: ['curse'],
    revealText: `${id} reveals itself.`,
    drawbackModifiers: {},
    trigger,
  };
}

function pack(...curses: CurseContentEntry[]): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, sword, mail, ...curses] };
}

function equipped(
  entries: readonly Readonly<{
    itemId: string;
    contentId: string;
    slot: 'main-hand' | 'body';
    curseId: string;
    revealed: boolean;
  }>[],
  overrides: Partial<ActiveRun> = {},
): ActiveRun {
  const base = createDemoRun();
  const items: ItemInstance[] = entries.map((entry) => ({
    itemId: entry.itemId,
    contentId: entry.contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: false,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'equipped', actorId: HERO_ID, slot: entry.slot },
    curse: { curseId: entry.curseId, revealed: entry.revealed },
  }));
  const equipment = { ...base.actors[0]!.equipment };
  for (const entry of entries) equipment[entry.slot] = entry.itemId;
  return { ...base, actors: [{ ...base.actors[0]!, equipment }], items, ...overrides };
}

function withEquippedCursedSword(
  input: Readonly<{ curseId: string; revealed: boolean }>,
): ActiveRun {
  return equipped([
    {
      itemId: 'item.cursed-sword.1',
      contentId: sword.id,
      slot: 'main-hand',
      curseId: input.curseId,
      revealed: input.revealed,
    },
  ]);
}

function withBackpackCursedSword(
  input: Readonly<{ curseId: string; revealed: boolean }>,
): ActiveRun {
  const base = createDemoRun();
  const item: ItemInstance = {
    itemId: 'item.cursed-sword.1',
    contentId: sword.id,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: false,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: HERO_ID },
    curse: { curseId: input.curseId, revealed: input.revealed },
  };
  return { ...base, items: [item] };
}

function diedEvent(killerActorId: string): DomainEvent {
  return {
    type: 'actor.died',
    eventId: 'e.died',
    actorId: 'actor.rat',
    contentId: 'monster.rat',
    killerActorId,
  };
}

function damagedEvent(input: Readonly<{ amount: number; health: number }>): DomainEvent {
  return {
    type: 'actor.damaged',
    eventId: 'e.damaged',
    actorId: HERO_ID,
    sourceActorId: 'actor.rat',
    amount: input.amount,
    health: input.health,
  };
}

function floorEnteredEvent(): DomainEvent {
  return {
    type: 'floor.entered',
    eventId: 'e.entered',
    floorId: 'floor.demo',
    depth: 1,
    firstEntry: true,
  };
}

const onKill = damageCurse('curse.hungering-edge', 'on-kill');
const secondOnKill = damageCurse('curse.second-edge', 'on-kill');
const onHurt = damageCurse('curse.hollow-step', 'on-hurt-below-half');
const onFloorEnter = damageCurse('curse.gnawing-want', 'on-floor-enter');
const inert = curse('curse.leaden-weight', null);
const unlikely = curse('curse.faint-whisper', {
  on: 'on-kill',
  chanceBps: 1,
  effect: {
    effectId: 'effect.damage',
    requiresLivingTarget: true,
    parameters: { damageType: 'arcane', dice: { count: 1, sides: 3, bonus: 0 } },
  },
});

const content = pack(onKill, secondOnKill, onHurt, onFloorEnter, inert, unlikely);

function fired(state: ActiveRun, event: DomainEvent): boolean {
  return applyCurseTriggers({ state, content, events: [event], eventId: 'c1' }).events.length > 0;
}

describe('applyCurseTriggers', () => {
  it('fires on-kill only for a kill the hero made', () => {
    const state = withEquippedCursedSword({ curseId: onKill.id, revealed: true });
    const heroKill = applyCurseTriggers({
      state,
      content,
      events: [diedEvent(HERO_ID)],
      eventId: 'c1',
    });
    const monsterKill = applyCurseTriggers({
      state,
      content,
      events: [diedEvent('actor.rat')],
      eventId: 'c1',
    });
    expect(heroKill.events.length).toBeGreaterThan(0);
    expect(monsterKill.events).toEqual([]);
    expect(monsterKill.state.rng.effects).toEqual(state.rng.effects);
  });

  it('fires on-hurt-below-half exactly on the crossing', () => {
    const state = withEquippedCursedSword({ curseId: onHurt.id, revealed: true });
    // maxHealth is 20: 20 -> 9 crosses; 20 -> 10 (exactly half) does not; 9 -> 8 is already below.
    expect(fired(state, damagedEvent({ amount: 11, health: 9 }))).toBe(true);
    expect(fired(state, damagedEvent({ amount: 10, health: 10 }))).toBe(false);
    expect(fired(state, damagedEvent({ amount: 1, health: 8 }))).toBe(false);
  });

  it('ignores an on-hurt-below-half crossing suffered by another actor', () => {
    const state = withEquippedCursedSword({ curseId: onHurt.id, revealed: true });
    const monsterHurt: DomainEvent = {
      type: 'actor.damaged',
      eventId: 'e.damaged',
      actorId: 'actor.rat',
      sourceActorId: HERO_ID,
      amount: 11,
      health: 1,
    };
    expect(fired(state, monsterHurt)).toBe(false);
  });

  it('fires at most once per command even with several matching events', () => {
    const state = withEquippedCursedSword({ curseId: onKill.id, revealed: true });
    const once = applyCurseTriggers({
      state,
      content,
      events: [diedEvent(HERO_ID), diedEvent(HERO_ID)],
      eventId: 'c1',
    });
    expect(once.events.filter((event) => event.type === 'attack.hit')).toHaveLength(1);
  });

  it('fires two distinct equipped curses from one event', () => {
    const state = equipped([
      {
        itemId: 'item.cursed-sword.1',
        contentId: sword.id,
        slot: 'main-hand',
        curseId: onKill.id,
        revealed: true,
      },
      {
        itemId: 'item.cursed-mail.1',
        contentId: mail.id,
        slot: 'body',
        curseId: secondOnKill.id,
        revealed: true,
      },
    ]);
    const result = applyCurseTriggers({
      state,
      content,
      events: [diedEvent(HERO_ID)],
      eventId: 'c1',
    });
    expect(result.events.filter((event) => event.type === 'attack.hit')).toHaveLength(2);
  });

  it('never fires a curse on an unequipped item, and consumes no randomness', () => {
    const state = withBackpackCursedSword({ curseId: onKill.id, revealed: true });
    const result = applyCurseTriggers({
      state,
      content,
      events: [diedEvent(HERO_ID)],
      eventId: 'c1',
    });
    expect(result.events).toEqual([]);
    expect(result.state.rng.effects).toEqual(state.rng.effects);
  });

  it('ignores a curse whose trigger is null and consumes no randomness', () => {
    const state = withEquippedCursedSword({ curseId: inert.id, revealed: true });
    const result = applyCurseTriggers({
      state,
      content,
      events: [diedEvent(HERO_ID)],
      eventId: 'c1',
    });
    expect(result.events).toEqual([]);
    expect(result.state.rng.effects).toEqual(state.rng.effects);
  });

  it('reveals an unrevealed equipped curse when its trigger fires', () => {
    const state = withEquippedCursedSword({ curseId: onFloorEnter.id, revealed: false });
    const result = applyCurseTriggers({
      state,
      content,
      events: [floorEnteredEvent()],
      eventId: 'c1',
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'curse.revealed', curseId: onFloorEnter.id }),
    );
    expect(result.state.items[0]!.curse).toEqual({ curseId: onFloorEnter.id, revealed: true });
  });

  it('spends the chance roll even when the curse does not fire', () => {
    const state = withEquippedCursedSword({ curseId: unlikely.id, revealed: true });
    const result = applyCurseTriggers({
      state,
      content,
      events: [diedEvent(HERO_ID)],
      eventId: 'c1',
    });
    expect(result.events).toEqual([]);
    expect(result.state.rng.effects).not.toEqual(state.rng.effects);
  });

  it('draws only from the effects stream', () => {
    const state = withEquippedCursedSword({ curseId: onKill.id, revealed: true });
    const result = applyCurseTriggers({
      state,
      content,
      events: [diedEvent(HERO_ID)],
      eventId: 'c1',
    });
    expect(result.state.rng.effects).not.toEqual(state.rng.effects);
    expect(result.state.rng.loot).toEqual(state.rng.loot);
    expect(result.state.rng['loot-placement']).toEqual(state.rng['loot-placement']);
    expect(result.state.rng.combat).toEqual(state.rng.combat);
  });

  it('never triggers on a concluded run or a dead hero', () => {
    const base = withEquippedCursedSword({ curseId: onKill.id, revealed: true });
    const concluded: ActiveRun = {
      ...base,
      conclusion: {
        completionType: 'died',
        cause: { killerContentId: null, depth: 1, turn: 3, worldTime: 3 },
        concludedAtRevision: 1,
        finalized: false,
      },
    };
    const dead: ActiveRun = {
      ...base,
      actors: [{ ...base.actors[0]!, health: 0 }],
    };
    for (const state of [concluded, dead]) {
      const result = applyCurseTriggers({
        state,
        content,
        events: [diedEvent(HERO_ID)],
        eventId: 'c1',
      });
      expect(result.events).toEqual([]);
      expect(result.state.rng.effects).toEqual(state.rng.effects);
    }
  });

  it('is a no-op with no matching events', () => {
    const state = withEquippedCursedSword({ curseId: onKill.id, revealed: true });
    const result = applyCurseTriggers({
      state,
      content,
      events: [damagedEvent({ amount: 1, health: 19 })],
      eventId: 'c1',
    });
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });
});
