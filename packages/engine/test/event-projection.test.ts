import { describe, expect, it } from 'vitest';
import type { MonsterContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack, createDemoRun, projectDomainEvents, stableJson,
  type DomainEvent,
} from '../src/index.js';

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
});
