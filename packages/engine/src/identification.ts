import type {
  CompiledContentPack,
  IdentificationPoolContentEntry,
  ItemContentEntry,
} from '@woven-deep/content';
import type { IdentificationState } from './item-model.js';
import type { ActiveRun, DomainEvent, OpaqueId, RngStreams } from './model.js';
import { rollDie } from './random.js';

export function allocateIdentificationMap(
  input: Readonly<{
    content: CompiledContentPack;
    rng: RngStreams;
  }>,
): Readonly<{ identification: IdentificationState; rng: RngStreams }> {
  const groups = new Map<string, ItemContentEntry[]>();
  for (const entry of input.content.entries) {
    if (
      entry.kind !== 'item' ||
      entry.identification.mode === 'known' ||
      !entry.identification.poolId
    )
      continue;
    const values = groups.get(entry.identification.poolId) ?? [];
    values.push(entry);
    groups.set(entry.identification.poolId, values);
  }
  let cursor = input.rng.effects;
  const pairs: Array<readonly [string, string]> = [];
  for (const poolId of [...groups.keys()].sort()) {
    const pool = input.content.entries.find(
      (entry): entry is IdentificationPoolContentEntry =>
        entry.kind === 'identification-pool' && entry.id === poolId,
    );
    if (!pool) throw new Error(`identification pool ${poolId} does not exist`);
    const items = groups
      .get(poolId)!
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const combinations = pool.verbs.flatMap((_verb, verbIndex) =>
      pool.nouns.map((_noun, nounIndex) => ({ verbIndex, nounIndex })),
    );
    if (combinations.length < items.length) {
      throw new Error(`identification pool ${poolId} cannot create enough unique names`);
    }
    for (let index = combinations.length - 1; index > 0; index -= 1) {
      const rolled = rollDie(cursor, index + 1);
      cursor = rolled.state;
      const swap = rolled.value - 1;
      [combinations[index], combinations[swap]] = [combinations[swap]!, combinations[index]!];
    }
    for (const [index, item] of items.entries()) {
      const visualRoll = rollDie(cursor, pool.visuals.length);
      cursor = visualRoll.state;
      const combination = combinations[index]!;
      pairs.push([
        item.id,
        `${pool.id}.v${combination.verbIndex}-n${combination.nounIndex}-x${visualRoll.value - 1}`,
      ]);
    }
  }
  pairs.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    identification: { appearanceByContentId: Object.fromEntries(pairs), knownAppearanceIds: [] },
    rng: { ...input.rng, effects: cursor },
  };
}

export function unidentifiedPresentation(
  input: Readonly<{
    content: CompiledContentPack;
    appearanceId: string;
  }>,
): Readonly<{ appearanceId: string; name: string; glyph: string; color: string }> {
  const match = /^(.*)\.v(\d+)-n(\d+)-x(\d+)$/.exec(input.appearanceId);
  if (!match) throw new Error(`invalid generated appearance ${input.appearanceId}`);
  const pool = input.content.entries.find(
    (entry): entry is IdentificationPoolContentEntry =>
      entry.kind === 'identification-pool' && entry.id === match[1],
  );
  const verb = pool?.verbs[Number(match[2])];
  const noun = pool?.nouns[Number(match[3])];
  const visual = pool?.visuals[Number(match[4])];
  if (!pool || !verb || !noun || !visual)
    throw new Error(`invalid generated appearance ${input.appearanceId}`);
  return {
    appearanceId: input.appearanceId,
    name: `${verb} ${noun}`,
    glyph: visual.glyph,
    color: visual.color,
  };
}

export function identifyAppearance(
  input: Readonly<{
    run: ActiveRun;
    contentId: OpaqueId;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const appearanceId = input.run.identification.appearanceByContentId[input.contentId];
  if (!appearanceId || input.run.identification.knownAppearanceIds.includes(appearanceId)) {
    return { state: input.run, events: [] };
  }
  const knownAppearanceIds = [...input.run.identification.knownAppearanceIds, appearanceId].sort();
  return {
    state: { ...input.run, identification: { ...input.run.identification, knownAppearanceIds } },
    events: [
      {
        type: 'identification.appearance-revealed',
        eventId: input.eventId,
        appearanceId,
        contentId: input.contentId,
      },
    ],
  };
}

export function identifyItem(
  input: Readonly<{
    run: ActiveRun;
    itemId: OpaqueId;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const item = input.run.items.find((candidate) => candidate.itemId === input.itemId);
  if (!item) throw new Error(`internal invariant: item ${input.itemId} does not exist`);
  if (item.identified) return { state: input.run, events: [] };
  return {
    state: {
      ...input.run,
      items: input.run.items.map((candidate) =>
        candidate.itemId === item.itemId ? { ...candidate, identified: true } : candidate,
      ),
    },
    events: [{ type: 'item.identified', eventId: input.eventId, itemId: item.itemId }],
  };
}

/**
 * Applies every identification transition an item still needs: shuffled definitions reveal the
 * shared appearance first, then the instance is marked identified. Both underlying transitions
 * are no-op safe, so an already identified item returns the same state with no events.
 */
export function identifyItemCompletely(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    itemId: OpaqueId;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const item = input.run.items.find((candidate) => candidate.itemId === input.itemId);
  if (!item) throw new Error(`internal invariant: item ${input.itemId} does not exist`);
  const entry = input.content.entries.find((candidate) => candidate.id === item.contentId);
  if (!entry || entry.kind !== 'item') {
    throw new Error(`internal invariant: item definition ${item.contentId} does not exist`);
  }
  const appearance =
    entry.identification.mode === 'shuffled'
      ? identifyAppearance({ run: input.run, contentId: item.contentId, eventId: input.eventId })
      : { state: input.run, events: [] as const };
  const identified = identifyItem({
    run: appearance.state,
    itemId: input.itemId,
    eventId: input.eventId,
  });
  return { state: identified.state, events: [...appearance.events, ...identified.events] };
}

export function projectItem(
  input: Readonly<{
    run: Pick<ActiveRun, 'items' | 'identification'>;
    content: CompiledContentPack;
    itemId: OpaqueId;
  }>,
): Readonly<Record<string, unknown>> {
  const item = input.run.items.find((candidate) => candidate.itemId === input.itemId);
  if (!item) throw new Error(`internal invariant: item ${input.itemId} does not exist`);
  const entry = input.content.entries.find((candidate) => candidate.id === item.contentId);
  if (!entry || entry.kind !== 'item')
    throw new Error(`internal invariant: item definition ${item.contentId} does not exist`);
  const appearanceId = input.run.identification.appearanceByContentId[item.contentId];
  const appearanceKnown =
    appearanceId && input.run.identification.knownAppearanceIds.includes(appearanceId);
  const appearanceHidden =
    entry.identification.mode === 'shuffled'
      ? !appearanceKnown
      : entry.identification.mode === 'instance' && !item.identified;
  if (appearanceId && appearanceHidden) {
    return {
      itemId: item.itemId,
      ...unidentifiedPresentation({ content: input.content, appearanceId }),
      category: entry.category,
      quantity: item.quantity,
      identified: false,
    };
  }
  const projected: Record<string, unknown> = {
    itemId: item.itemId,
    contentId: entry.id,
    name: item.heirloom?.displayName ?? entry.name,
    ...(item.heirloom
      ? {
          glyph: item.heirloom.glyph,
          color: item.heirloom.color,
          provenance: { originatingHallRecordId: item.heirloom.originatingHallRecordId },
        }
      : { glyph: entry.glyph, color: entry.color }),
    category: entry.category,
    quantity: item.quantity,
    identified: item.identified,
    effects: entry.effects,
  };
  if (item.enchantment && item.identified) projected.enchantment = item.enchantment;
  else if (item.enchantment || (entry.identification.mode === 'instance' && !item.identified)) {
    projected.unknownProperties = true;
  }
  return projected;
}
