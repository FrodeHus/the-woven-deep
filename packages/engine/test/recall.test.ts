import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack, SpellContentEntry } from '@woven-deep/content';
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
