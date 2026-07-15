import type { CompiledContentPack, FallenChampionTemplateContentEntry, ItemContentEntry } from '@woven-deep/content';
import { guaranteedUniqueItemIds } from './commerce.js';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, OpaqueId, Uint32State } from './model.js';
import type { RecordedHeirloomSnapshot } from './population-model.js';
import { rollDie } from './random.js';
import { compareCodeUnits } from './stable-json.js';

const EXCLUDED_TAGS: readonly string[] = ['heirloom', 'quest', 'objective', 'nontransferable'];

interface HeirloomCandidate {
  readonly instance: ItemInstance;
  readonly definition: ItemContentEntry;
  readonly weight: number;
}

function itemDefinition(content: CompiledContentPack, contentId: OpaqueId): ItemContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item') throw new Error(`internal invariant: item definition ${contentId} does not exist`);
  return entry;
}

/** Counts the instance's positive enchantment modifier values. */
function qualityRank(instance: ItemInstance): number {
  return Object.values(instance.enchantment?.modifiers ?? {}).filter((value) => value > 0).length;
}

function candidateWeight(template: FallenChampionTemplateContentEntry, definition: ItemContentEntry,
  instance: ItemInstance): number {
  const weight = template.heirloomSelection.rarityWeights[definition.rarity]
    + template.heirloomSelection.qualityRankBonus * qualityRank(instance);
  if (!Number.isSafeInteger(weight) || weight <= 0) {
    throw new RangeError(`heirloom weight for ${instance.itemId} must be a positive safe integer, got ${weight}`);
  }
  return weight;
}

/**
 * Selects the fallen hero's heirloom with a single weighted roll on the `run-records` stream over
 * the dead hero's equipped item instances. A stack contributes one candidate and records one unit;
 * a two-handed item is one candidate. With no eligible equipment the template's fallback relic is
 * recorded without consuming randomness. Never rerolls and never guarantees a minimum rarity.
 */
export function selectHeirloom(input: Readonly<{
  run: ActiveRun;                 // conclusion non-null (dead hero)
  content: CompiledContentPack;
  template: FallenChampionTemplateContentEntry;
  recordId: OpaqueId;
}>): Readonly<{ snapshot: RecordedHeirloomSnapshot; nextRunRecordsState: Uint32State }> {
  const { run, content, template, recordId } = input;
  if (run.conclusion === null) throw new Error('heirloom selection requires a concluded run');
  const uniques = guaranteedUniqueItemIds(content);
  const candidates: readonly HeirloomCandidate[] = run.items
    .filter((item) => item.location.type === 'equipped' && item.location.actorId === run.hero.actorId)
    .sort((left, right) => compareCodeUnits(left.itemId, right.itemId))
    .flatMap((instance) => {
      const definition = itemDefinition(content, instance.contentId);
      const excluded = !definition.heirloomEligible || definition.equipment === null
        || definition.tags.some((tag) => EXCLUDED_TAGS.includes(tag)) || uniques.has(definition.id);
      return excluded ? [] : [{ instance, definition, weight: candidateWeight(template, definition, instance) }];
    });
  if (candidates.length === 0) {
    const fallback = itemDefinition(content, template.fallbackItemId);
    return {
      snapshot: {
        contentId: fallback.id, sourceItemId: null, enchantment: null, condition: 100, charges: null,
        fuel: null, qualityRank: 0, displayName: fallback.name, glyph: fallback.glyph, color: fallback.color,
        originatingHallRecordId: recordId,
      },
      nextRunRecordsState: run.rng['run-records'],
    };
  }
  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  const roll = rollDie(run.rng['run-records'], totalWeight);
  let cumulative = 0;
  let chosen = candidates[candidates.length - 1]!;
  for (const candidate of candidates) {
    cumulative += candidate.weight;
    if (roll.value <= cumulative) {
      chosen = candidate;
      break;
    }
  }
  return {
    snapshot: {
      contentId: chosen.instance.contentId, sourceItemId: chosen.instance.itemId,
      enchantment: chosen.instance.enchantment, condition: chosen.instance.condition,
      charges: chosen.instance.charges, fuel: chosen.instance.fuel, qualityRank: qualityRank(chosen.instance),
      displayName: chosen.definition.name, glyph: chosen.definition.glyph, color: chosen.definition.color,
      originatingHallRecordId: recordId,
    },
    nextRunRecordsState: roll.state,
  };
}
