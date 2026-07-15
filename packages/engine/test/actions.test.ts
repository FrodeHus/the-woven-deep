import { describe, expect, it } from 'vitest';
import {
  createDemoContentPack,
  createDemoRun,
  encodeActiveRun,
  resolveCommand,
  validatePlayerAction,
  type ActorState,
  type ResolutionContext,
} from '../src/index.js';

const context: ResolutionContext = { content: createDemoContentPack() };

function withAdjacentActor(disposition: ActorState['disposition']) {
  const run = createDemoRun();
  const target = {
    ...run.actors[0]!, actorId: 'npc.traveler', contentId: 'npc.traveler', playerControlled: false,
    x: 2, y: 1, disposition, energy: 0,
  };
  return { ...run, actors: [...run.actors, target].sort((left, right) => left.actorId < right.actorId ? -1 : 1) };
}

describe('player action validation', () => {
  it('returns complete authoritative movement and wait actions', () => {
    const state = createDemoRun();
    expect(validatePlayerAction({
      state, command: { type: 'move', commandId: 'command.move', expectedRevision: 0, direction: 'southeast' }, context,
    })).toEqual({ type: 'move', actorId: 'hero.demo', to: { x: 2, y: 2 }, cost: 100 });
    expect(validatePlayerAction({
      state, command: { type: 'wait', commandId: 'command.wait', expectedRevision: 0 }, context,
    })).toEqual({ type: 'wait', actorId: 'hero.demo', cost: 100 });
  });

  it('returns action.unavailable for commands whose subsystem is not registered', () => {
    expect(validatePlayerAction({
      state: createDemoRun(),
      command: { type: 'attack', commandId: 'command.attack', expectedRevision: 0, targetActorId: 'monster.absent' },
      context,
    })).toEqual({ status: 'invalid', reason: 'action.unavailable' });
  });

  it('never resolves trade commands through the world-step action path', () => {
    expect(validatePlayerAction({
      state: createDemoRun(),
      command: { type: 'trade-open', commandId: 'command.trade-open', expectedRevision: 0, merchantActorId: 'actor.absent' },
      context,
    })).toEqual({ status: 'invalid', reason: 'action.unavailable' });
    expect(validatePlayerAction({
      state: createDemoRun(),
      command: { type: 'trade-close', commandId: 'command.trade-close', expectedRevision: 0, merchantPopulationId: 'population.absent' },
      context,
    })).toEqual({ status: 'invalid', reason: 'action.unavailable' });
  });

  it('rejects actions while the hero is incapacitated', () => {
    const state = createDemoRun();
    const hero = state.actors[0]!;
    const incapacitated = {
      ...state,
      actors: [{ ...hero, conditions: [{
        conditionId: 'condition.incapacitated', sourceActorId: null,
        appliedAt: 0, expiresAt: null, stacks: 1,
      }] }],
    };
    expect(validatePlayerAction({
      state: incapacitated,
      command: { type: 'wait', commandId: 'command.stunned', expectedRevision: 0 }, context,
    })).toEqual({ status: 'invalid', reason: 'action.unavailable' });
    const resolution = resolveCommand(
      incapacitated,
      { type: 'wait', commandId: 'command.stunned', expectedRevision: 0 },
      context,
    );
    expect(() => encodeActiveRun(resolution.state)).not.toThrow();
  });

  it('deduplicates unavailable commands and rejects conflicting reuse before content lookup', () => {
    const command = { type: 'attack', commandId: 'command.repeat-attack', expectedRevision: 0, targetActorId: 'monster.a' } as const;
    const first = resolveCommand(createDemoRun(), command, context);
    const mismatched = { content: { ...createDemoContentPack(), hash: 'b'.repeat(64) } };
    const duplicate = resolveCommand(first.state, command, mismatched);
    expect(duplicate.result).toBe(first.result);
    expect(duplicate.events).toBe(first.events);
    const conflict = resolveCommand(first.state, { ...command, targetActorId: 'monster.b' }, mismatched);
    expect(conflict.result).toMatchObject({ status: 'rejected', reason: 'command_id_conflict' });
    const stale = resolveCommand(first.state, {
      type: 'wait', commandId: 'command.stale-before-pack', expectedRevision: 99,
    }, mismatched);
    expect(stale.result).toMatchObject({ status: 'rejected', reason: 'stale_revision' });
  });

  it('does not record or mutate a decision-required command', () => {
    const run = withAdjacentActor('neutral');
    const before = encodeActiveRun(run);
    const resolution = resolveCommand(
      run,
      { type: 'move', commandId: 'command.neutral', expectedRevision: run.revision, direction: 'east' },
      context,
    );
    expect(resolution.result).toEqual({
      status: 'decision_required', commandId: 'command.neutral', revision: 0, turn: 0,
      decision: { type: 'confirm-aggression', targetActorId: 'npc.traveler' },
    });
    expect(encodeActiveRun(resolution.state)).toBe(before);
    expect(resolution.events).toEqual([]);
    expect(resolution.state.recentCommands).toEqual([]);
  });

  it('treats an explicit adjacent attack as confirmed aggression and saves it', () => {
    const run = withAdjacentActor('neutral');
    const resolution = resolveCommand(
      run,
      { type: 'attack', commandId: 'command.attack-neutral', expectedRevision: 0, targetActorId: 'npc.traveler' },
      context,
    );
    expect(resolution.result).toMatchObject({ status: 'applied' });
    expect(resolution.events[0]).toMatchObject({
      type: 'relationship.changed', actorId: 'hero.demo', targetActorId: 'npc.traveler', relationship: 'hostile',
    });
    expect(() => encodeActiveRun(resolution.state)).not.toThrow();
  });

  it('keeps bump confirmation and explicit attack behavior for neutral NPC targets', () => {
    const run = withAdjacentActor('neutral');
    const bump = validatePlayerAction({
      state: run,
      command: { type: 'move', commandId: 'command.bump-npc', expectedRevision: 0, direction: 'east' },
      context,
    });
    expect(bump).toMatchObject({
      status: 'decision_required',
      decision: { type: 'confirm-aggression', targetActorId: 'npc.traveler' },
    });
    const explicit = validatePlayerAction({
      state: run,
      command: { type: 'attack', commandId: 'command.attack-npc', expectedRevision: 0, targetActorId: 'npc.traveler' },
      context,
    });
    expect(explicit).toEqual({
      type: 'bump-attack', actorId: 'hero.demo', targetActorId: 'npc.traveler', cost: 100,
    });
  });

  it('turns hostile bump movement into an attack without moving', () => {
    const run = withAdjacentActor('hostile');
    const resolution = resolveCommand(
      run,
      { type: 'move', commandId: 'command.hostile', expectedRevision: 0, direction: 'east' },
      context,
    );
    expect(resolution.result).toMatchObject({ status: 'applied' });
    expect(resolution.events.some((event) => event.type === 'combat.observed')).toBe(true);
    expect(resolution.state.actors.find((actor) => actor.actorId === run.hero.actorId)).toMatchObject({ x: 1, y: 1 });
    expect(() => encodeActiveRun(resolution.state)).not.toThrow();
  });

  it('moves through an open door cover cell and remains saveable', () => {
    const run = createDemoRun();
    const floor = run.floors[0]!;
    const throughDoor = {
      ...run,
      floors: [{ ...floor, tiles: floor.tiles.map((tile, index) => index === 9 ? 2 : tile) }],
      features: [{
        featureId: 'door.open', type: 'door' as const, floorId: floor.floorId, x: 2, y: 1,
        contentId: null, coverTileId: 2 as const, state: 'open' as const,
      }],
    };
    const resolution = resolveCommand(
      throughDoor,
      { type: 'move', commandId: 'command.open-door', expectedRevision: 0, direction: 'east' },
      context,
    );
    expect(resolution.result.status).toBe('applied');
    expect(() => encodeActiveRun(resolution.state)).not.toThrow();
  });

  it('rejects a mismatched content pack without publishing or mutation', () => {
    const run = createDemoRun();
    const mismatched = { content: { ...createDemoContentPack(), hash: 'b'.repeat(64) } };
    expect(() => resolveCommand(
      run,
      { type: 'wait', commandId: 'command.bad-pack', expectedRevision: 0 },
      mismatched,
    )).toThrow(/invariant.*content hash/i);
    expect(run.recentCommands).toEqual([]);
  });
});
