// This module is deliberately import-free: `run-conclusion` (part of the model core's existing
// import cycle) reads these predicates, so pulling in `model.js` here -- even as a type -- would
// close a fresh circular dependency. The structural views below describe exactly the fields the
// predicates touch; the concrete `ActiveRun`, `PopulationInstance`, and `ActorState` satisfy them.

/** The refused branch's boss: the weakened Heart, activated when the hero turns away. */
export const HEART_BOSS_ENCOUNTER_ID = 'encounter.heart-boss';

interface PopulationView {
  readonly model: string;
  readonly encounterId: string;
  readonly actorId?: string;
}

interface ActorView {
  readonly actorId: string;
  readonly health: number;
}

interface HeartBossView {
  readonly populations: readonly PopulationView[];
  readonly actors: readonly ActorView[];
}

function heartBossActor(state: HeartBossView): ActorView | undefined {
  const population = state.populations.find(
    (candidate) => candidate.model === 'boss' && candidate.encounterId === HEART_BOSS_ENCOUNTER_ID,
  );
  if (!population || population.actorId === undefined) return undefined;
  const actorId = population.actorId;
  return state.actors.find((actor) => actor.actorId === actorId);
}

/** True while the weakened Heart boss population exists on the run, alive or defeated. */
export function isHeartBossPresent(state: HeartBossView): boolean {
  return state.populations.some(
    (candidate) => candidate.model === 'boss' && candidate.encounterId === HEART_BOSS_ENCOUNTER_ID,
  );
}

/**
 * True while the weakened Heart boss is present and alive. Derived purely from run state -- a live
 * actor belonging to the heart-boss encounter -- so no dedicated save flag is required. Gates the
 * forced `became-heart` death override and rejects further Chamber choices during the fight.
 */
export function isHeartBossActive(state: HeartBossView): boolean {
  const boss = heartBossActor(state);
  return boss !== undefined && boss.health > 0;
}

/** True once the heart-boss actor has been reduced to zero health; the trigger for `refused`. */
export function isHeartBossDefeated(state: HeartBossView): boolean {
  const boss = heartBossActor(state);
  return boss !== undefined && boss.health <= 0;
}
