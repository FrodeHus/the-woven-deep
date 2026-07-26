import type { CompiledContentPack, NpcFactionContentEntry } from '@woven-deep/content';
import { heroActor } from './actor-model.js';
import { changeReputation } from './commerce.js';
import type { DialogueConsequenceCommand } from './commands-model.js';
import { entryById } from './content-index.js';
import type { ActiveRun, DomainEvent, GameCommand, InvalidActionReason } from './model.js';
import type { MerchantPopulation } from './merchant-model.js';
import { relationshipBetween } from './reactions.js';
import { merchantFaction, merchantPerceived } from './trade.js';

export function isDialogueCommand(command: GameCommand): command is DialogueConsequenceCommand {
  return command.type === 'dialogue-consequence';
}

type DialogueValidation =
  | Readonly<{
      ok: true;
      population: MerchantPopulation;
      faction: NpcFactionContentEntry;
      amount: number;
    }>
  | Readonly<{ ok: false; reason: InvalidActionReason }>;

/** Closed preflight; a successful validation carries no mutation and consumes no randomness. */
export function validateDialogueCommand(
  input: Readonly<{
    state: ActiveRun;
    command: DialogueConsequenceCommand;
    content: CompiledContentPack;
  }>,
): DialogueValidation {
  const { state, command, content } = input;
  const hero = heroActor(state);
  const population = state.populations.find(
    (candidate): candidate is MerchantPopulation =>
      candidate.model === 'merchant' && candidate.actorId === command.npcActorId,
  );
  const actor = state.actors.find((candidate) => candidate.actorId === command.npcActorId);
  if (!population || !actor || actor.populationId !== population.populationId || actor.health <= 0)
    return { ok: false, reason: 'dialogue.unavailable' };
  if (
    population.floorId !== state.activeFloorId ||
    actor.floorId !== hero.floorId ||
    Math.max(Math.abs(actor.x - hero.x), Math.abs(actor.y - hero.y)) !== 1 ||
    relationshipBetween(state, hero.actorId, actor.actorId) === 'hostile' ||
    !merchantPerceived(state, content, hero, actor)
  )
    return { ok: false, reason: 'dialogue.out-of-range' };
  // Re-derive the consequence from content (anti-cheat): npc -> dialogueId -> dialogue -> topic -> consequence.
  const npc = entryById(content, population.npcId);
  const dialogueId = npc && npc.kind === 'npc' ? npc.dialogueId : undefined;
  const dialogue = dialogueId ? entryById(content, dialogueId) : undefined;
  const topic =
    dialogue && dialogue.kind === 'dialogue'
      ? dialogue.topics.find((candidate) => candidate.id === command.topicId)
      : undefined;
  if (!topic || topic.consequence?.kind !== 'reputation')
    return { ok: false, reason: 'dialogue.invalid-topic' };
  if ((population.dialogueConsequencesApplied ?? []).includes(command.topicId))
    return { ok: false, reason: 'dialogue.invalid-topic' };
  const faction = merchantFaction(content, topic.consequence.factionId);
  return { ok: true, population, faction, amount: topic.consequence.amount };
}

/** Applies a validated dialogue command; the caller (reducer) advances the revision only. */
export function applyDialogueConsequence(
  input: Readonly<{
    state: ActiveRun;
    command: DialogueConsequenceCommand;
    content: CompiledContentPack;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const validation = validateDialogueCommand(input);
  if (!validation.ok)
    throw new Error('internal invariant: applyDialogueConsequence on an invalid command');
  const changed = changeReputation({
    run: input.state,
    faction: validation.faction,
    delta: validation.amount,
    reason: 'dialogue',
    eventId: input.command.commandId,
  });
  const populations = changed.state.populations.map((population) =>
    population.populationId === validation.population.populationId
      ? {
          ...population,
          dialogueConsequencesApplied: [
            ...((population as MerchantPopulation).dialogueConsequencesApplied ?? []),
            input.command.topicId,
          ],
        }
      : population,
  );
  return { state: { ...changed.state, populations }, events: [changed.event] };
}
