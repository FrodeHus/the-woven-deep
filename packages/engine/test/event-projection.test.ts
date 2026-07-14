import { describe, expect, it } from 'vitest';
import type { MonsterContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack, createDemoRun, projectDomainEvents, stableJson,
  type DomainEvent,
  type PopulationDomainEvent,
} from '../src/index.js';

function exhaustPopulationEvent(event: PopulationDomainEvent): string {
  switch (event.type) {
    case 'population.created': case 'population.encountered': case 'population.placement-skipped':
    case 'actor.intent-changed': case 'group.awareness-shared': case 'group.leader-created':
    case 'group.leader-defeated': case 'group.outcome-applied': case 'swarm.members-created':
    case 'swarm.cap-reached': case 'swarm.source-destroyed': case 'boss.encountered':
    case 'boss.phase-changed': case 'boss.recovered': case 'boss.defeated': case 'boss.reward-created':
    case 'champion.encountered': case 'champion.defeated': case 'champion.heirloom-created':
    case 'echo.encountered': case 'echo.defeated': case 'echo.loot-created': return event.type;
    default: { const exhaustive: never = event; return exhaustive; }
  }
}

function monsterDefinition(): MonsterContentEntry {
  return {
    kind: 'monster', id: 'monster.hidden', name: 'Hidden monster', glyph: 'm', color: '#aa4444', tags: [],
    minDepth: 1, maxDepth: 20, attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
    health: 10, speed: 100, accuracy: 1, defense: 8, perception: 8,
    damage: { count: 1, sides: 1, bonus: 0 }, armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
    runAppearanceChance: 1, rarity: 'common',
  };
}

function fixture() {
  const base = createDemoRun();
  const attacker = { ...base.actors[0]!, actorId: 'monster.hidden', contentId: 'monster.hidden',
    playerControlled: false, disposition: 'hostile' as const, x: 3, y: 1 };
  const floor = { ...base.floors[0]!, ambient: { color: [0, 0, 0] as const, strength: 0 } };
  const content = { ...createDemoContentPack(), entries: [...createDemoContentPack().entries, monsterDefinition()] };
  const events: DomainEvent[] = [{
    type: 'attack.hit', eventId: 'command.wait', actorId: attacker.actorId, targetActorId: base.hero.actorId,
    naturalRoll: 20, total: 21, defense: 8, critical: true, rolledDice: 1, rolledDamage: 3,
    effectiveDamage: 3, damageType: 'physical',
  }, {
    type: 'actor.damaged', eventId: 'command.wait', actorId: base.hero.actorId,
    sourceActorId: attacker.actorId, amount: 3, health: 17,
  }];
  return { state: { ...base, floors: [floor], actors: [base.actors[0]!, attacker] }, content, events };
}

describe('public event projection', () => {
  it('redacts an unseen attacker while preserving an audible direction', () => {
    const input = fixture();
    expect(projectDomainEvents({ ...input, heroId: input.state.hero.actorId })).toEqual([
      { type: 'sound.heard', category: 'combat', direction: 'east', distanceBand: 'near' },
      { type: 'hero.damaged', amount: 3, damageType: 'physical' },
    ]);
  });

  it('does not expose hidden identifiers, coordinates, or rolls', () => {
    const input = fixture();
    const json = stableJson(projectDomainEvents({ ...input, heroId: input.state.hero.actorId }));
    expect(json).not.toContain('monster.hidden');
    expect(json).not.toContain('naturalRoll');
    expect(json).not.toContain('rolledDamage');
    expect(json).not.toContain('"x"');
  });

  it('describes unseen movement with eight-way direction and coarse distance only', () => {
    const input = fixture();
    const events: DomainEvent[] = [{ type: 'actor.moved', eventId: 'command.wait', actorId: 'monster.hidden',
      from: { x: 2, y: 2 }, to: { x: 3, y: 2 } }];
    expect(projectDomainEvents({ ...input, events, heroId: input.state.hero.actorId })).toEqual([
      { type: 'sound.heard', category: 'movement', direction: 'southeast', distanceBand: 'near' },
    ]);
  });

  it('projects broad intent only for a currently visible actor', () => {
    const input = fixture();
    const event: DomainEvent = { type: 'actor.intent-changed', eventId: 'event.intent', actorId: 'monster.hidden',
      intent: 'approach', presentation: 'intent.approach', targetCategory: 'hero' };
    expect(projectDomainEvents({ ...input, events: [event], heroId: input.state.hero.actorId })).toEqual([]);
    const visible = { ...input, state: { ...input.state, floors: [{ ...input.state.floors[0]!,
      ambient: { color: [255, 255, 255] as const, strength: 255 } }] } };
    expect(projectDomainEvents({ ...visible, events: [event], heroId: visible.state.hero.actorId })).toEqual([event]);
  });

  it('redacts every population lifecycle event to observable qualitative presentation', () => {
    const input = fixture();
    const visible = { ...input, state: { ...input.state, floors: [{ ...input.state.floors[0]!,
      ambient: { color: [255, 255, 255] as const, strength: 255 } }] } };
    const actorId = 'monster.hidden';
    const eventId = 'event.population';
    const events: DomainEvent[] = [
      { type: 'population.created', eventId, populationId: 'population.secret', encounterId: 'encounter.secret',
        floorId: visible.state.activeFloorId, model: 'group', actorIds: [actorId, 'actor.unseen'] },
      { type: 'population.encountered', eventId, populationId: 'population.secret', encounterId: 'encounter.secret', actorId },
      { type: 'population.placement-skipped', eventId, encounterId: 'encounter.unseen',
        floorId: visible.state.activeFloorId, reason: 'no-valid-placement' },
      { type: 'group.awareness-shared', eventId, populationId: 'population.secret', actorId,
        targetActorId: visible.state.hero.actorId, floorId: visible.state.activeFloorId, x: 9, y: 9,
        observedAt: 99, observerActorId: 'actor.observer-secret' },
      { type: 'group.leader-created', eventId, populationId: 'population.secret', actorId, roleId: 'role.secret' },
      { type: 'group.leader-defeated', eventId, populationId: 'population.secret', actorId },
      { type: 'group.outcome-applied', eventId, populationId: 'population.secret', actorId,
        response: 'panic', individualRewards: false, collapsedMemberCount: 7 },
      { type: 'swarm.members-created', eventId, populationId: 'population.secret', sourceActorId: actorId,
        actorIds: ['actor.future-secret'], quantity: 4 },
      { type: 'swarm.cap-reached', eventId, populationId: 'population.secret', sourceActorId: actorId, level: 'floor' },
      { type: 'swarm.source-destroyed', eventId, populationId: 'population.secret', sourceActorId: actorId, response: 'decay' },
      { type: 'boss.encountered', eventId, populationId: 'population.secret', actorId, encounterId: 'encounter.secret' },
      { type: 'boss.phase-changed', eventId, populationId: 'population.secret', actorId,
        encounterId: 'encounter.secret', phaseId: 'enraged' },
      { type: 'boss.recovered', eventId, populationId: 'population.secret', actorId,
        encounterId: 'encounter.secret', amount: 22, health: 88 },
      { type: 'boss.defeated', eventId, populationId: 'population.secret', actorId, encounterId: 'encounter.secret' },
      { type: 'boss.reward-created', eventId, populationId: 'population.secret', actorId,
        encounterId: 'encounter.secret', uniqueItemId: 'item.unopened-secret', itemIds: ['item.roll-secret'] },
      { type: 'champion.encountered', eventId, populationId: 'population.secret', actorId,
        hallRecordId: 'hall.secret', rank: 1 },
      { type: 'champion.defeated', eventId, populationId: 'population.secret', actorId,
        hallRecordId: 'hall.secret', rank: 1 },
      { type: 'champion.heirloom-created', eventId, populationId: 'population.secret', actorId,
        hallRecordId: 'hall.secret', rank: 1, itemId: 'item.secret', contentId: 'item.content-secret',
        originatingHallRecordId: 'hall.secret', displayName: 'Observed heirloom', glyph: ')', color: '#ffffff', fallback: false },
      { type: 'echo.encountered', eventId, populationId: 'population.secret', actorId, hallRecordId: 'hall.secret', rank: 2 },
      { type: 'echo.defeated', eventId, populationId: 'population.secret', actorId, hallRecordId: 'hall.secret', rank: 2 },
      { type: 'echo.loot-created', eventId, populationId: 'population.secret', actorId,
        hallRecordId: 'hall.secret', rank: 2, itemIds: ['item.echo-secret'] },
    ];
    const output = projectDomainEvents({ ...visible, events, heroId: visible.state.hero.actorId });
    expect(events.map(exhaustPopulationEvent)).toHaveLength(21);
    expect(output.map((event) => event.type)).toEqual(Array(19).fill('population.notice'));
    const json = stableJson(output);
    for (const secret of ['population.secret', 'encounter.secret', 'actor.unseen', 'actor.future-secret',
      'observerActorId', 'observedAt', 'collapsedMemberCount', 'individualRewards', 'uniqueItemId',
      'item.roll-secret', 'hall.secret', 'amount', 'health']) expect(json).not.toContain(secret);
    expect(json).toContain('Observed heirloom');
  });

  it('never publishes combat rolls even when both participants are visible', () => {
    const input = fixture();
    const visible = { ...input, state: { ...input.state, floors: [{ ...input.state.floors[0]!,
      ambient: { color: [255, 255, 255] as const, strength: 255 } }] } };
    const output = projectDomainEvents({ ...visible, events: [visible.events[0]!], heroId: visible.state.hero.actorId });
    expect(output).toEqual([{ type: 'combat.observed', eventId: 'command.wait', outcome: 'hit',
      attackerActorId: 'monster.hidden', targetActorId: visible.state.hero.actorId, attackerName: 'Hidden monster' }]);
    expect(stableJson(output)).not.toMatch(/naturalRoll|rolledDice|rolledDamage|defense/);
  });

  it('uses both prior and next observation without revealing the hidden endpoint', () => {
    const input = fixture();
    const state = { ...input.state, hero: { ...input.state.hero, sightRadius: 1 },
      floors: [{ ...input.state.floors[0]!, ambient: { color: [255, 255, 255] as const, strength: 255 } }] };
    const events: DomainEvent[] = [{ type: 'actor.moved', eventId: 'event.leave', actorId: 'monster.hidden',
      from: { x: 2, y: 1 }, to: { x: 3, y: 1 } }];
    expect(projectDomainEvents({ state, content: input.content, events, heroId: state.hero.actorId })).toEqual([{
      type: 'actor.movement-observed', eventId: 'event.leave', actorId: 'monster.hidden',
      direction: 'east', visibility: 'left',
    }]);
  });
});
