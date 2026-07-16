import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';
import type { IndividualPopulation } from './population-model.js';
import { compareCodeUnits } from './stable-json.js';

/**
 * Individual-model populations have no leader/spawn/phase logic of their own — a dead member is
 * simply reconciled out of `livingMemberIds` and into `formerMemberIds`, mirroring the death-sync
 * step every other population model performs (group's `applyGroupLeaderOutcomes`, swarm's
 * `syncDeaths`, boss's `synchronizeDeath`). No event is emitted for a plain member death, matching
 * those conventions — group-model member deaths also stay silent unless a leader dies.
 */
export function reconcileIndividualDeaths(input: Readonly<{
  state: ActiveRun; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  let populations = input.state.populations;
  let changed = false;
  for (const population of [...input.state.populations].sort((left, right) => compareCodeUnits(left.populationId, right.populationId))) {
    if (population.model !== 'individual') continue;
    const newlyDead = population.livingMemberIds.filter((actorId) => (
      (input.state.actors.find((actor) => actor.actorId === actorId)?.health ?? 0) <= 0
    )).sort(compareCodeUnits);
    if (newlyDead.length === 0) continue;
    changed = true;
    const updated: IndividualPopulation = {
      ...population,
      livingMemberIds: population.livingMemberIds.filter((actorId) => !newlyDead.includes(actorId)),
      formerMemberIds: [...new Set([...population.formerMemberIds, ...newlyDead])].sort(compareCodeUnits),
    };
    populations = populations.map((candidate) => candidate.populationId === updated.populationId ? updated : candidate);
  }
  if (!changed) return { state: input.state, events: [] };
  return { state: { ...input.state, populations }, events: [] };
}
