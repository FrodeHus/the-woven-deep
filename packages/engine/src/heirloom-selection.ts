import type {
  CompiledContentPack,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
} from '@woven-deep/content';
import { requireItem as itemDefinition } from './content-index.js';
import { artifactItemIds, guaranteedUniqueItemIds } from './commerce.js';
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

/** Counts the instance's positive enchantment modifier values. */
function qualityRank(instance: ItemInstance): number {
  return Object.values(instance.enchantment?.modifiers ?? {}).filter((value) => value > 0).length;
}

function candidateWeight(
  template: FallenChampionTemplateContentEntry,
  definition: ItemContentEntry,
  instance: ItemInstance,
): number {
  const weight =
    template.heirloomSelection.rarityWeights[definition.rarity] +
    template.heirloomSelection.qualityRankBonus * qualityRank(instance);
  if (!Number.isSafeInteger(weight) || weight <= 0) {
    throw new RangeError(
      `heirloom weight for ${instance.itemId} must be a positive safe integer, got ${weight}`,
    );
  }
  return weight;
}

/**
 * Selects the fallen hero's heirloom with a single weighted roll on the `run-records` stream over
 * the dead hero's equipped item instances. A stack contributes one candidate and records one unit;
 * a two-handed item is one candidate. With no eligible equipment the template's fallback relic is
 * recorded without consuming randomness. Never rerolls and never guarantees a minimum rarity.
 *
 * Artifacts are excluded from candidacy entirely — a held artifact takes the record through
 * `selectRecordHeirloom`'s priority path instead, so it can never also win this ordinary roll.
 */
export function selectHeirloom(
  input: Readonly<{
    run: ActiveRun; // conclusion non-null (dead hero)
    content: CompiledContentPack;
    template: FallenChampionTemplateContentEntry;
    recordId: OpaqueId;
  }>,
): Readonly<{ snapshot: RecordedHeirloomSnapshot; nextRunRecordsState: Uint32State }> {
  const { run, content, template, recordId } = input;
  if (run.conclusion === null) throw new Error('heirloom selection requires a concluded run');
  const uniques = guaranteedUniqueItemIds(content);
  const artifacts = artifactItemIds(content);
  const candidates: readonly HeirloomCandidate[] = run.items
    .filter(
      (item) => item.location.type === 'equipped' && item.location.actorId === run.hero.actorId,
    )
    .sort((left, right) => compareCodeUnits(left.itemId, right.itemId))
    .flatMap((instance) => {
      const definition = itemDefinition(content, instance.contentId);
      const excluded =
        !definition.heirloomEligible ||
        definition.equipment === null ||
        definition.tags.some((tag) => EXCLUDED_TAGS.includes(tag)) ||
        uniques.has(definition.id) ||
        artifacts.has(definition.id);
      return excluded
        ? []
        : [{ instance, definition, weight: candidateWeight(template, definition, instance) }];
    });
  if (candidates.length === 0) {
    const fallback = itemDefinition(content, template.fallbackItemId);
    return {
      snapshot: {
        contentId: fallback.id,
        sourceItemId: null,
        enchantment: null,
        condition: 100,
        charges: null,
        fuel: null,
        curse: null,
        qualityRank: 0,
        displayName: fallback.name,
        glyph: fallback.glyph,
        color: fallback.color,
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
    snapshot: instanceSnapshot(chosen.instance, chosen.definition, recordId),
    nextRunRecordsState: roll.state,
  };
}

function instanceSnapshot(
  instance: ItemInstance,
  definition: ItemContentEntry,
  recordId: OpaqueId,
): RecordedHeirloomSnapshot {
  return {
    contentId: instance.contentId,
    sourceItemId: instance.itemId,
    enchantment: instance.enchantment,
    condition: instance.condition,
    charges: instance.charges,
    fuel: instance.fuel,
    curse: instance.curse ?? null,
    qualityRank: qualityRank(instance),
    displayName: definition.name,
    glyph: definition.glyph,
    color: definition.color,
    originatingHallRecordId: recordId,
  };
}

/** True while the item rests on the hero — equipped or in the backpack, the two places an
 * artifact can travel with a run. Wider than the ordinary heirloom filter on purpose. */
function heldByHero(item: ItemInstance, run: ActiveRun): boolean {
  return (
    (item.location.type === 'equipped' || item.location.type === 'backpack') &&
    item.location.actorId === run.hero.actorId
  );
}

/**
 * Content IDs of the artifacts the hero is carrying out of the run, equipped or in the backpack,
 * sorted and deduplicated. Finalization builds both the heirloom priority and the artifact ledger
 * deltas from this one list, so the record and the ledger can never disagree about what was held.
 */
export function heldArtifactIds(run: ActiveRun, content: CompiledContentPack): readonly OpaqueId[] {
  const artifacts = artifactItemIds(content);
  const held = run.items
    .filter((item) => heldByHero(item, run) && artifacts.has(item.contentId))
    .map((item) => item.contentId);
  return [...new Set(held)].sort(compareCodeUnits);
}

/**
 * The heirloom a Hall record actually carries. An artifact the hero held outranks every ordinary
 * candidate: one is picked among the held artifacts alone with equal weights on the `run-records`
 * stream (no roll at all when exactly one is held) and the record's heirloom is built from that
 * instance. With no artifact held this delegates to `selectHeirloom` unchanged. Exactly one of the
 * two paths ever consumes randomness, so a record costs at most one `run-records` draw either way.
 */
export function selectRecordHeirloom(
  input: Readonly<{
    run: ActiveRun; // conclusion non-null
    content: CompiledContentPack;
    template: FallenChampionTemplateContentEntry;
    recordId: OpaqueId;
    heldArtifactIds: readonly OpaqueId[];
  }>,
): Readonly<{ snapshot: RecordedHeirloomSnapshot; nextRunRecordsState: Uint32State }> {
  const { run, content, template, recordId } = input;
  if (run.conclusion === null) throw new Error('heirloom selection requires a concluded run');
  if (input.heldArtifactIds.length === 0) {
    return selectHeirloom({ run, content, template, recordId });
  }
  const held = new Set(input.heldArtifactIds);
  const candidates = run.items
    .filter((item) => heldByHero(item, run) && held.has(item.contentId))
    .sort((left, right) => compareCodeUnits(left.itemId, right.itemId));
  const first = candidates[0];
  if (first === undefined) {
    throw new Error('internal invariant: held artifact ids name no item instance on the hero');
  }
  if (candidates.length === 1) {
    return {
      snapshot: instanceSnapshot(first, itemDefinition(content, first.contentId), recordId),
      nextRunRecordsState: run.rng['run-records'],
    };
  }
  const roll = rollDie(run.rng['run-records'], candidates.length);
  const chosen = candidates[roll.value - 1] ?? candidates[candidates.length - 1]!;
  return {
    snapshot: instanceSnapshot(chosen, itemDefinition(content, chosen.contentId), recordId),
    nextRunRecordsState: roll.state,
  };
}
