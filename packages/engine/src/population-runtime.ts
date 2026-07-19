import type {
  CompiledContentPack, EncounterContentEntry, EncounterModel,
} from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import type { ActiveRun, OpaqueId } from './model.js';
import type { PopulationInstance } from './population-model.js';
import { compareCodeUnits } from './stable-json.js';

export function sortedPopulations(
  populations: readonly PopulationInstance[],
): readonly PopulationInstance[] {
  return [...populations].sort((left, right) => compareCodeUnits(left.populationId, right.populationId));
}

export function replacePopulationList(
  populations: readonly PopulationInstance[],
  replacement: PopulationInstance,
): readonly PopulationInstance[] {
  return populations.map((candidate) => candidate.populationId === replacement.populationId ? replacement : candidate);
}

export function replacePopulation(state: ActiveRun, replacement: PopulationInstance): ActiveRun {
  return { ...state, populations: replacePopulationList(state.populations, replacement) };
}

export function requireEncounter<M extends EncounterModel>(
  content: CompiledContentPack,
  encounterId: OpaqueId,
  model: M,
): Extract<EncounterContentEntry, { model: M }> {
  const entry = content.entries.find((candidate) => candidate.id === encounterId);
  if (!entry || entry.kind !== 'encounter' || entry.model !== model) {
    throw new Error(`internal invariant: ${model} encounter ${encounterId} does not exist`);
  }
  return entry as Extract<EncounterContentEntry, { model: M }>;
}

export function deadLivingMembers(
  population: Readonly<{ livingMemberIds: readonly OpaqueId[] }>,
  actors: readonly ActorState[],
): readonly OpaqueId[] {
  return population.livingMemberIds.filter(
    (id) => (actors.find((actor) => actor.actorId === id)?.health ?? 0) <= 0);
}

export function synchronizeDeath<P extends Readonly<{
  livingMemberIds: readonly OpaqueId[]; formerMemberIds: readonly OpaqueId[];
}>>(population: P, deadMemberIds: readonly OpaqueId[]): P {
  const dead = deadMemberIds.filter((id) => population.livingMemberIds.includes(id));
  if (dead.length === 0) return population;
  return { ...population,
    livingMemberIds: population.livingMemberIds.filter((id) => !dead.includes(id)),
    formerMemberIds: [...new Set([...population.formerMemberIds, ...dead])].sort(compareCodeUnits) };
}
