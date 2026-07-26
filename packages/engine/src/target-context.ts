import type { CompiledContentPack } from '@woven-deep/content';
import type { heroActor } from './actor-model.js';
import type { ActiveRun } from './model.js';
import { floorPerception } from './run-perception.js';

/**
 * Split out of `actions.ts` so `action-dispatch.ts` can call it without importing `actions.ts`
 * itself (which imports `action-dispatch.ts`'s `isDispatchableActionType`) -- that back-edge is
 * what used to make the two files, and everything `action-dispatch.ts` calls into
 * (`combat-profile.ts`, `merchant-behavior.ts`, `stats.ts`, `swarm-behavior.ts`), a runtime
 * circular dependency cluster. `actions.ts` re-exports this so its own existing usage is
 * unchanged.
 */
export function targetContext(
  state: ActiveRun,
  actor: ReturnType<typeof heroActor>,
  content: CompiledContentPack,
) {
  const perception = floorPerception({ state, content, actorId: actor.actorId });
  return {
    floor: perception.floor,
    knowledge: perception.knowledge,
    visibilityWords: perception.visibilityWords,
    illumination: perception.illumination,
  };
}
