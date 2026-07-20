import type { ContentEntry, EncounterContentEntry, LootTableContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { checkedTotalWithin } from '../../population-limits.js';
import {
  boundedProduct,
  MAX_LOOT_CHOICE_QUANTITY,
  MAX_LOOT_CREATED_UNITS,
  MAX_LOOT_TABLE_ROLLS,
  MAX_LOOT_WEIGHT_TOTAL,
} from '../../loot-limits.js';
import { compareCodeUnits, issue, type LocatedContentEntry } from './shared.js';

export function lootIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const tables = locatedEntries.filter(
    ({ entry }) => entry.kind === 'loot-table',
  ) as readonly (LocatedContentEntry & { entry: LootTableContentEntry })[];
  const bossUniqueIds = new Set(
    locatedEntries
      .filter(({ entry }) => entry.kind === 'encounter' && entry.model === 'boss')
      .map(
        ({ entry }) => (entry as EncounterContentEntry & { model: 'boss' }).definition.uniqueItemId,
      ),
  );
  const graph = new Map<string, string[]>();
  for (const { entry, file } of tables) {
    const edges: string[] = [];
    if (entry.rolls > MAX_LOOT_TABLE_ROLLS) {
      issues.push(
        issue(
          file,
          `$.entries.${entry.id}.rolls`,
          `loot table rolls exceed runtime-safe limit ${MAX_LOOT_TABLE_ROLLS}`,
        ),
      );
    }
    if (
      !checkedTotalWithin(
        entry.choices.map((choice) => choice.weight),
        MAX_LOOT_WEIGHT_TOTAL,
      )
    ) {
      issues.push(
        issue(
          file,
          `$.entries.${entry.id}.choices`,
          'loot choice weight total exceeds rollDie maximum 2^32',
        ),
      );
    }
    entry.choices.forEach((choice, index) => {
      const path = `$.entries.${entry.id}.choices.${index}`;
      if ((choice.contentId === null) === (choice.lootTableId === null)) {
        issues.push(
          issue(file, path, 'loot choice must reference exactly one content item or loot table'),
        );
      }
      if (choice.minimumQuantity > choice.maximumQuantity) {
        issues.push(
          issue(
            file,
            `${path}.maximumQuantity`,
            'maximum quantity must be at least minimum quantity',
          ),
        );
      }
      if (
        choice.minDepth !== undefined &&
        choice.maxDepth !== undefined &&
        choice.minDepth > choice.maxDepth
      ) {
        issues.push(
          issue(file, `${path}.maxDepth`, 'loot choice maxDepth must be at least minDepth'),
        );
      }
      if (choice.maximumQuantity > MAX_LOOT_CHOICE_QUANTITY) {
        issues.push(
          issue(
            file,
            `${path}.maximumQuantity`,
            `loot choice quantity exceeds runtime-safe limit ${MAX_LOOT_CHOICE_QUANTITY}`,
          ),
        );
      }
      if (choice.contentId !== null && !byId.has(choice.contentId)) {
        issues.push(
          issue(file, `${path}.contentId`, `unknown content reference ${choice.contentId}`),
        );
      } else if (choice.contentId !== null && byId.get(choice.contentId)?.kind !== 'item') {
        issues.push(
          issue(
            file,
            `${path}.contentId`,
            `content reference ${choice.contentId} resolves to ${byId.get(choice.contentId)!.kind}; expected item`,
          ),
        );
      }
      const itemTarget = choice.contentId === null ? undefined : byId.get(choice.contentId);
      if (itemTarget?.kind === 'item' && choice.maximumQuantity > itemTarget.stackLimit) {
        issues.push(
          issue(
            file,
            `${path}.maximumQuantity`,
            `loot choice quantity exceeds item stack limit ${itemTarget.stackLimit}`,
          ),
        );
      }
      if (choice.contentId !== null && bossUniqueIds.has(choice.contentId)) {
        issues.push(
          issue(
            file,
            `${path}.contentId`,
            `guaranteed boss-unique item ${choice.contentId} cannot appear in ordinary loot`,
          ),
        );
      }
      if (choice.lootTableId !== null) {
        edges.push(choice.lootTableId);
        if (byId.get(choice.lootTableId)?.kind !== 'loot-table') {
          issues.push(
            issue(
              file,
              `${path}.lootTableId`,
              `unknown loot-table reference ${choice.lootTableId}`,
            ),
          );
        }
      }
    });
    graph.set(entry.id, edges);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: readonly string[]): void => {
    if (visiting.has(id)) {
      const located = tables.find(({ entry }) => entry.id === id)!;
      issues.push(
        issue(
          located.file,
          `$.entries.${id}.choices`,
          `loot-table cycle detected: ${[...trail, id].join(' -> ')}`,
        ),
      );
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) visit(next, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...graph.keys()].sort(compareCodeUnits)) visit(id, []);
  const worstMemo = new Map<string, number>();
  const worstUnits = (id: string, trail = new Set<string>()): number => {
    const memoized = worstMemo.get(id);
    if (memoized !== undefined) return memoized;
    if (trail.has(id)) return MAX_LOOT_CREATED_UNITS + 1;
    const table = tables.find(({ entry }) => entry.id === id)?.entry;
    if (!table) return MAX_LOOT_CREATED_UNITS + 1;
    const nextTrail = new Set(trail);
    nextTrail.add(id);
    let worstChoice = 0;
    for (const choice of table.choices) {
      const child = choice.lootTableId === null ? 1 : worstUnits(choice.lootTableId, nextTrail);
      worstChoice = Math.max(
        worstChoice,
        boundedProduct(choice.maximumQuantity, child, MAX_LOOT_CREATED_UNITS),
      );
    }
    const result = boundedProduct(table.rolls, worstChoice, MAX_LOOT_CREATED_UNITS);
    worstMemo.set(id, result);
    return result;
  };
  for (const { entry, file } of tables)
    if (worstUnits(entry.id) > MAX_LOOT_CREATED_UNITS) {
      issues.push(
        issue(
          file,
          `$.entries.${entry.id}`,
          `loot table worst-case created units exceed runtime-safe limit ${MAX_LOOT_CREATED_UNITS}`,
        ),
      );
    }
  return issues;
}
