import { describe, expect, it } from 'vitest';
import { createDemoContentPack, createDemoRun, deriveRunActorStats, heroActor, type ActorState } from '../src/index.js';

/**
 * Isolates the hero-vs-non-hero modifier gating: with equipment, conditions, and hunger held
 * identical, only the run hero's stat modifiers may distinguish the two actors.
 */
describe('deriveRunActorStats hero gating', () => {
  const content = createDemoContentPack();
  const base = createDemoRun();
  const hero: ActorState = { ...heroActor(base), equipment: {}, conditions: [] };
  const stranger: ActorState = { ...hero, actorId: 'actor.stranger', playerControlled: false };
  const state = {
    ...base,
    actors: [hero, stranger],
    hero: { ...base.hero, statModifiers: { meleeAccuracy: 7 } },
    survival: { ...base.survival, hungerStage: 'sated' as const },
  };

  it('applies the hero stat modifiers only to the run hero', () => {
    const heroStats = deriveRunActorStats({ state, content, actor: hero });
    const strangerStats = deriveRunActorStats({ state, content, actor: stranger });
    expect(heroStats.meleeAccuracy).toBe(strangerStats.meleeAccuracy + 7);
  });

  it('leaves every other derived stat untouched by the hero gating', () => {
    const heroStats = deriveRunActorStats({ state, content, actor: hero });
    const strangerStats = deriveRunActorStats({ state, content, actor: stranger });
    for (const [name, value] of Object.entries(strangerStats)) {
      if (name === 'meleeAccuracy') continue;
      expect(heroStats[name as keyof typeof heroStats]).toBe(value);
    }
  });
});
