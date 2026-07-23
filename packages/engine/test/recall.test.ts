import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack, ItemContentEntry, SpellContentEntry } from '@woven-deep/content';
import {
  createGameplayDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  generateTownFloor,
  isTownFloorActive,
  recallReturn,
  recallToTown,
  resolveCommand,
  TOWN_FLOOR_ID,
  validatePlayerAction,
  type ActiveRun,
  type ItemInstance,
} from '../src/index.js';

let pack: CompiledContentPack;

const RECALL_SPELL_ID = 'spell.test-recall';

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/** Synthetic self-cast recall spell: a target.self spell carrying only `effect.recall`, mirroring
 * what a real recall spell (shipped in a later content task) will carry. Exercises the run-level
 * recall behavior without depending on that content. */
function recallSpellDefinition(): SpellContentEntry {
  return {
    kind: 'spell',
    id: RECALL_SPELL_ID,
    name: 'Test Recall',
    tags: [],
    targetingId: 'target.self',
    range: 0,
    actionCost: 100,
    weaveCost: 0,
    effects: [{ effectId: 'effect.recall', parameters: {}, requiresLivingTarget: false }],
  };
}

function packWithRecall(): CompiledContentPack {
  return { ...pack, entries: [...pack.entries, recallSpellDefinition()] };
}

/** The gameplay demo run, granted caster aptitude and given a town floor alongside its dungeon
 * floor -- `createGameplayDemoRun` alone never generates a town, but recall's town-move needs one
 * present in `run.floors`. */
function runOnDungeonFloorWithTown(): { run: ActiveRun; recallPack: CompiledContentPack } {
  const recallPack = packWithRecall();
  const { run } = createGameplayDemoRun(pack);
  const town = generateTownFloor(pack).floor;
  return {
    run: {
      ...run,
      hero: { ...run.hero, classTags: ['loomcaller'] },
      // The save schema requires floors sorted by strictly increasing floorId.
      floors: [...run.floors, town].sort((left, right) =>
        left.floorId < right.floorId ? -1 : left.floorId > right.floorId ? 1 : 0,
      ),
    },
    recallPack,
  };
}

describe('recall', () => {
  it('anchors the current floor and emits hero.recalled without moving floors', () => {
    const { run, recallPack } = runOnDungeonFloorWithTown();
    const dungeonFloorId = run.activeFloorId;
    const cast = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.recall',
        expectedRevision: run.revision,
        spellId: RECALL_SPELL_ID,
        target: null,
      },
      { content: recallPack },
    );

    expect(cast.result.status).toBe('applied');
    expect(cast.state.returnAnchorFloorId).toBe(dungeonFloorId);
    expect(cast.state.activeFloorId).toBe(dungeonFloorId);
    const recalledEvent = cast.events.find((event) => event.type === 'hero.recalled');
    expect(recalledEvent).toMatchObject({
      type: 'hero.recalled',
      actorId: run.hero.actorId,
      anchorFloorId: dungeonFloorId,
    });
  });

  it('moves to town via recallToTown, clearing recentCommands', () => {
    const { run, recallPack } = runOnDungeonFloorWithTown();
    const dungeonFloorId = run.activeFloorId;
    const cast = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.recall',
        expectedRevision: run.revision,
        spellId: RECALL_SPELL_ID,
        target: null,
      },
      { content: recallPack },
    );
    expect(cast.state.recentCommands).toHaveLength(1);

    const inTown = recallToTown(cast.state, { content: recallPack }).state;
    expect(isTownFloorActive(inTown)).toBe(true);
    expect(inTown.activeFloorId).toBe(TOWN_FLOOR_ID);
    expect(inTown.returnAnchorFloorId).toBe(dungeonFloorId);
    expect(inTown.recentCommands).toHaveLength(0);
  });

  it('returns to the anchored floor via recallReturn, clearing the anchor', () => {
    const { run, recallPack } = runOnDungeonFloorWithTown();
    const dungeonFloorId = run.activeFloorId;
    const cast = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.recall',
        expectedRevision: run.revision,
        spellId: RECALL_SPELL_ID,
        target: null,
      },
      { content: recallPack },
    );
    const inTown = recallToTown(cast.state, { content: recallPack }).state;

    const back = recallReturn(inTown, { content: recallPack }).state;
    expect(back.activeFloorId).toBe(dungeonFloorId);
    expect(back.returnAnchorFloorId).toBeUndefined();
  });

  it('rejects a recall cast while already in town with recall.already-town', () => {
    const { run, recallPack } = runOnDungeonFloorWithTown();
    const cast = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.recall',
        expectedRevision: run.revision,
        spellId: RECALL_SPELL_ID,
        target: null,
      },
      { content: recallPack },
    );
    const inTown = recallToTown(cast.state, { content: recallPack }).state;
    const heroInTown = inTown.actors.find((actor) => actor.playerControlled)!;

    // Defense-in-depth: `resolveCommand`'s town-truce gate already rejects `cast` in town before
    // this ever runs (reason `town.truce`), so this exercises `validatePlayerAction` directly.
    const validation = validatePlayerAction({
      state: inTown,
      command: {
        type: 'cast',
        commandId: 'command.recall-in-town',
        expectedRevision: inTown.revision,
        spellId: RECALL_SPELL_ID,
        target: null,
      },
      context: { content: recallPack },
    });

    expect(validation).toMatchObject({ status: 'invalid', reason: 'recall.already-town' });
    expect(heroInTown.floorId).toBe(TOWN_FLOOR_ID);

    // And confirm the actual command path rejects it too, via town.truce.
    const inTownReject = resolveCommand(
      inTown,
      {
        type: 'cast',
        commandId: 'command.recall-in-town-2',
        expectedRevision: inTown.revision,
        spellId: RECALL_SPELL_ID,
        target: null,
      },
      { content: recallPack },
    );
    expect(inTownReject.result).toMatchObject({ status: 'invalid', reason: 'town.truce' });
  });

  it('round-trips a save with returnAnchorFloorId set and a retained recall cast', () => {
    const { run, recallPack } = runOnDungeonFloorWithTown();
    const cast = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.recall',
        expectedRevision: run.revision,
        spellId: RECALL_SPELL_ID,
        target: null,
      },
      { content: recallPack },
    );

    expect(cast.state.returnAnchorFloorId).toBeDefined();
    const roundTripped = decodeActiveRun(encodeActiveRun(cast.state));
    expect(roundTripped.returnAnchorFloorId).toBe(cast.state.returnAnchorFloorId);
  });
});

const EMBER_BOLT_SPELL_ID = 'spell.ember-bolt';
const TOME_CONTENT_ID = 'item.test-tome-retained-invalid';

/** Synthetic tome item entry, mirroring the pattern in tome-learn.test.ts: an item.spell.learn +
 * effect.item.consume pair, since a real shipped tome does not exist yet. */
function retainedInvalidTomeDefinition(): ItemContentEntry {
  return {
    kind: 'item',
    id: TOME_CONTENT_ID,
    name: 'Test Tome (retained-invalid)',
    glyph: '?',
    color: '#ffffff',
    tags: [],
    category: 'misc',
    stackLimit: 1,
    price: 1,
    rarity: 'common',
    heirloomEligible: false,
    minDepth: 0,
    maxDepth: 20,
    actionCost: 100,
    equipment: null,
    combat: null,
    light: null,
    identification: { mode: 'known', poolId: null },
    effects: [
      {
        effectId: 'effect.spell.learn',
        parameters: { spellId: EMBER_BOLT_SPELL_ID },
        requiresLivingTarget: false,
      },
      {
        effectId: 'effect.item.consume',
        parameters: { quantity: 1 },
        requiresLivingTarget: false,
      },
    ],
  };
}

function tomeInstanceFor(actorId: string): ItemInstance {
  return {
    // Sorts after every other item in the demo run's items array (including the vault-slot
    // synthetic item), since itemId must be unique and strictly increasing across the run.
    itemId: 'item.zzz-tome-retained-invalid',
    contentId: TOME_CONTENT_ID,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId },
  };
}

/** A run on the gameplay demo's dungeon floor, with the hero's weave and classTags overridden so
 * a `cast` command can be driven into either invalid-cast reason on demand. */
function runWithHeroWeaveAndAptitude(options: {
  weave: number;
  caster: boolean;
  knownSpellIds?: readonly string[];
}): { run: ActiveRun } {
  const { run } = createGameplayDemoRun(pack);
  const heroActor = run.actors.find((actor) => actor.playerControlled)!;
  return {
    run: {
      ...run,
      hero: {
        ...run.hero,
        classTags: options.caster ? ['loomcaller'] : [],
        ...(options.knownSpellIds ? { knownSpellIds: options.knownSpellIds } : {}),
      },
      actors: run.actors.map((actor) =>
        actor.actorId === heroActor.actorId
          ? { ...actor, weave: Math.min(options.weave, actor.maxWeave) }
          : actor,
      ),
    },
  };
}

describe('retained invalid cast/use-item commands round-trip (save-corruption regression)', () => {
  it('retains an invalid cast.insufficient-weave and round-trips it', () => {
    const { run } = runWithHeroWeaveAndAptitude({
      weave: 0,
      caster: true,
      knownSpellIds: [EMBER_BOLT_SPELL_ID],
    });
    const cast = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.cast-insufficient-weave',
        expectedRevision: run.revision,
        spellId: EMBER_BOLT_SPELL_ID,
        target: null,
      },
      { content: pack },
    );

    expect(cast.result).toMatchObject({ status: 'invalid', reason: 'cast.insufficient-weave' });
    expect(cast.state.recentCommands).toHaveLength(1);
    expect(() => decodeActiveRun(encodeActiveRun(cast.state))).not.toThrow();
    const roundTripped = decodeActiveRun(encodeActiveRun(cast.state));
    expect(roundTripped.recentCommands).toHaveLength(1);
  });

  it('retains an invalid cast.no-aptitude and round-trips it', () => {
    const { run } = runWithHeroWeaveAndAptitude({ weave: 999, caster: false });
    const cast = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.cast-no-aptitude',
        expectedRevision: run.revision,
        spellId: EMBER_BOLT_SPELL_ID,
        target: null,
      },
      { content: pack },
    );

    expect(cast.result).toMatchObject({ status: 'invalid', reason: 'cast.no-aptitude' });
    expect(cast.state.recentCommands).toHaveLength(1);
    expect(() => decodeActiveRun(encodeActiveRun(cast.state))).not.toThrow();
    const roundTripped = decodeActiveRun(encodeActiveRun(cast.state));
    expect(roundTripped.recentCommands).toHaveLength(1);
  });

  it('retains an invalid use-item learn.no-aptitude and round-trips it', () => {
    const { run } = createGameplayDemoRun(pack);
    const heroActor = run.actors.find((actor) => actor.playerControlled)!;
    const tomePack: CompiledContentPack = {
      ...pack,
      entries: [...pack.entries, retainedInvalidTomeDefinition()],
    };
    const runWithTome: ActiveRun = {
      ...run,
      hero: { ...run.hero, classTags: [] },
      items: [...run.items, tomeInstanceFor(heroActor.actorId)],
    };

    const result = resolveCommand(
      runWithTome,
      {
        type: 'use-item',
        commandId: 'command.learn-no-aptitude-retained',
        expectedRevision: runWithTome.revision,
        itemId: 'item.zzz-tome-retained-invalid',
        target: null,
      },
      { content: tomePack },
    );

    expect(result.result).toMatchObject({ status: 'invalid', reason: 'learn.no-aptitude' });
    expect(result.state.recentCommands).toHaveLength(1);
    expect(() => decodeActiveRun(encodeActiveRun(result.state))).not.toThrow();
    const roundTripped = decodeActiveRun(encodeActiveRun(result.state));
    expect(roundTripped.recentCommands).toHaveLength(1);
  });

  it('retains an invalid use-item learn.already-known and round-trips it', () => {
    const { run } = createGameplayDemoRun(pack);
    const heroActor = run.actors.find((actor) => actor.playerControlled)!;
    const tomePack: CompiledContentPack = {
      ...pack,
      entries: [...pack.entries, retainedInvalidTomeDefinition()],
    };
    const runWithTome: ActiveRun = {
      ...run,
      hero: { ...run.hero, classTags: ['loomcaller'], knownSpellIds: [EMBER_BOLT_SPELL_ID] },
      items: [...run.items, tomeInstanceFor(heroActor.actorId)],
    };

    const result = resolveCommand(
      runWithTome,
      {
        type: 'use-item',
        commandId: 'command.learn-already-known-retained',
        expectedRevision: runWithTome.revision,
        itemId: 'item.zzz-tome-retained-invalid',
        target: null,
      },
      { content: tomePack },
    );

    expect(result.result).toMatchObject({ status: 'invalid', reason: 'learn.already-known' });
    expect(result.state.recentCommands).toHaveLength(1);
    expect(() => decodeActiveRun(encodeActiveRun(result.state))).not.toThrow();
    const roundTripped = decodeActiveRun(encodeActiveRun(result.state));
    expect(roundTripped.recentCommands).toHaveLength(1);
  });
});
