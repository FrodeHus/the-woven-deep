import { describe, expect, it } from 'vitest';
import {
  createDemoContentPack,
  createDemoRun,
  completeNormalActorTurn,
  eligibleOpportunityAttackers,
  relationshipBetween,
  resolveOpportunityAttacks,
  setRelationship,
  type ActorState,
} from '../src/index.js';
import type { CompiledContentPack, ConditionContentEntry } from '@woven-deep/content';

function actor(overrides: Partial<ActorState> & Pick<ActorState, 'actorId'>): ActorState {
  return { ...createDemoRun().actors[0]!, playerControlled: false, ...overrides };
}

function hostileDeparture() {
  const run = createDemoRun();
  const mover = { ...run.actors[0]!, x: 2, y: 2 };
  const attackers = [
    actor({ actorId: 'monster.b', disposition: 'hostile', x: 3, y: 3, awareActorIds: [mover.actorId] }),
    actor({ actorId: 'monster.a', disposition: 'hostile', x: 3, y: 2, awareActorIds: [mover.actorId] }),
  ];
  return {
    run: { ...run, actors: [mover, ...attackers] }, content: createDemoContentPack(),
    moverActorId: mover.actorId, from: { x: 2, y: 2 }, to: { x: 1, y: 2 }, eventId: 'event.move',
  };
}

function missedReaction(input: any) {
  return {
    actors: input.actors,
    combatState: input.combatState,
    events: [{
      type: 'attack.missed' as const, eventId: input.eventId, actorId: input.attackerId,
      targetActorId: input.targetActorId, naturalRoll: 1, total: 1, defense: 10,
    }],
  };
}

describe('relationships and reactions', () => {
  it('stores relationship overrides as a sorted symmetric pair', () => {
    const initial = {
      ...createDemoRun(),
      actors: [
        actor({ actorId: 'hero.demo', playerControlled: true, disposition: 'friendly' }),
        actor({ actorId: 'npc.neutral', disposition: 'neutral', x: 2 }),
      ],
    };
    const changed = setRelationship(initial, 'npc.neutral', 'hero.demo', 'hostile');
    expect(changed.relationships).toEqual([{
      leftActorId: 'hero.demo', rightActorId: 'npc.neutral', relationship: 'hostile',
    }]);
    expect(relationshipBetween(changed, 'hero.demo', 'npc.neutral')).toBe('hostile');
    expect(relationshipBetween(changed, 'npc.neutral', 'hero.demo')).toBe('hostile');
    expect(initial.relationships).toEqual([]);
  });

  it('defaults symmetrically to hostile, then neutral, then friendly', () => {
    const base = createDemoRun();
    const friendly = actor({ actorId: 'npc.friendly', disposition: 'friendly' });
    const neutral = actor({ actorId: 'npc.neutral', disposition: 'neutral' });
    const hostile = actor({ actorId: 'monster.hostile', disposition: 'hostile' });
    const run = { ...base, actors: [base.actors[0]!, friendly, neutral, hostile] };
    expect(relationshipBetween(run, 'hero.demo', 'monster.hostile')).toBe('hostile');
    expect(relationshipBetween(run, 'hero.demo', 'npc.neutral')).toBe('neutral');
    expect(relationshipBetween(run, 'hero.demo', 'npc.friendly')).toBe('friendly');
  });

  it('defaults hostile-versus-neutral pairs to neutral so monsters ignore merchants', () => {
    const base = createDemoRun();
    const neutral = actor({ actorId: 'npc.merchant', disposition: 'neutral', x: 2 });
    const hostile = actor({ actorId: 'monster.hostile', disposition: 'hostile', x: 3 });
    const run = { ...base, actors: [base.actors[0]!, neutral, hostile] };
    expect(relationshipBetween(run, 'monster.hostile', 'npc.merchant')).toBe('neutral');
    expect(relationshipBetween(run, 'npc.merchant', 'monster.hostile')).toBe('neutral');
    // An explicit override still wins over the disposition default.
    const provoked = setRelationship(run, 'monster.hostile', 'npc.merchant', 'hostile');
    expect(relationshipBetween(provoked, 'monster.hostile', 'npc.merchant')).toBe('hostile');
  });

  it('creates no opportunity reaction for a neutral merchant fleeing past a monster', () => {
    const base = createDemoRun();
    const merchant = actor({ actorId: 'npc.merchant', disposition: 'neutral', x: 2, y: 2 });
    const monster = actor({
      actorId: 'monster.hostile', disposition: 'hostile', x: 3, y: 2,
      awareActorIds: ['npc.merchant'], reactionReady: true,
    });
    const run = { ...base, actors: [base.actors[0]!, merchant, monster] };
    expect(eligibleOpportunityAttackers({
      run, content: createDemoContentPack(), moverActorId: 'npc.merchant',
      from: { x: 2, y: 2 }, to: { x: 1, y: 2 },
    })).toEqual([]);
  });

  it('makes a provoked merchant movement reaction-eligible through the hostile override', () => {
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, x: 3, y: 2, awareActorIds: ['npc.merchant'] };
    const merchant = actor({ actorId: 'npc.merchant', disposition: 'neutral', x: 2, y: 2 });
    const run = setRelationship({ ...base, actors: [hero, merchant] }, hero.actorId, 'npc.merchant', 'hostile');
    expect(eligibleOpportunityAttackers({
      run, content: createDemoContentPack(), moverActorId: 'npc.merchant',
      from: { x: 2, y: 2 }, to: { x: 1, y: 2 },
    }).map((attacker) => attacker.actorId)).toEqual([hero.actorId]);
  });

  it('never creates an opportunity reaction between neutral actors', () => {
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, x: 2, y: 2 };
    const neutral = actor({
      actorId: 'npc.neutral', disposition: 'neutral', x: 3, y: 2,
      awareActorIds: [hero.actorId], reactionReady: true,
    });
    const run = { ...base, actors: [hero, neutral] };
    expect(eligibleOpportunityAttackers({
      run, content: createDemoContentPack(), moverActorId: hero.actorId,
      from: { x: 2, y: 2 }, to: { x: 1, y: 2 },
    })).toEqual([]);
  });

  it('resolves aware hostile reactions by stable actor ID before movement', () => {
    const result = resolveOpportunityAttacks({ ...hostileDeparture(), resolveAttack: missedReaction });
    expect(result.events.filter((event) => event.type === 'reaction.triggered').map((event: any) => event.actorId))
      .toEqual(['monster.a', 'monster.b']);
    expect(result.movementAllowed).toBe(true);
    expect(result.state.actors.filter((candidate) => candidate.actorId.startsWith('monster.'))
      .every((candidate) => !candidate.reactionReady)).toBe(true);
  });

  it('cancels movement after a blocking condition but resolves captured living attackers', () => {
    const root: ConditionContentEntry = {
      kind: 'condition', id: 'condition.rooted', name: 'Rooted', description: 'Cannot move',
      tags: [], color: '#668844', duration: { mode: 'timed', default: 10, maximum: 10 },
      stacking: { mode: 'refresh', maximumStacks: 1 }, modifiersPerStack: {},
      traits: ['condition-trait.prevents-movement' as any],
    };
    const base = hostileDeparture();
    const content: CompiledContentPack = { ...base.content, entries: [...base.content.entries, root] };
    let attacks = 0;
    const result = resolveOpportunityAttacks({
      ...base, content,
      resolveAttack: (input: any) => {
        attacks += 1;
        const actors = attacks === 1 ? input.actors.map((candidate: ActorState) => (
          candidate.actorId === input.targetActorId ? { ...candidate, conditions: [{
            conditionId: root.id, sourceActorId: input.attackerId,
            appliedAt: 0, expiresAt: 10, stacks: 1,
          }] } : candidate
        )) : input.actors;
        return { ...missedReaction(input), actors };
      },
    });
    expect(attacks).toBe(2);
    expect(result.events.filter((event) => event.type === 'reaction.triggered')).toHaveLength(2);
    expect(result.movementAllowed).toBe(false);
  });

  it('recovers a spent reaction only after a normal scheduled turn', () => {
    const before = actor({ actorId: 'monster.a', reactionReady: false });
    expect(completeNormalActorTurn(before)).toEqual({ ...before, reactionReady: true });
    expect(before.reactionReady).toBe(false);
  });
});
