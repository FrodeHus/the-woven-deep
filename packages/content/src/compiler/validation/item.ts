import type { ContentEntry, ItemContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { effectIssues, issue, type LocatedContentEntry } from './shared.js';

function equipmentIssues(file: string, item: ItemContentEntry): ContentCompileIssue[] {
  const equipment = item.equipment;
  if (!equipment) return [];
  const path = `$.entries.${item.id}.equipment`;
  const slots = new Set(equipment.slots);
  const reserved = new Set(equipment.reservedSlots);
  const issues: ContentCompileIssue[] = [];
  if (equipment.handedness === 'one-handed' && !slots.has('main-hand') && !slots.has('off-hand')) {
    issues.push(issue(file, `${path}.handedness`, 'one-handed equipment must fit a hand slot'));
  }
  if (equipment.handedness === 'one-handed' && reserved.size > 0) {
    issues.push(
      issue(file, `${path}.reservedSlots`, 'one-handed equipment cannot reserve another slot'),
    );
  }
  if (equipment.handedness === 'two-handed') {
    if (!slots.has('main-hand'))
      issues.push(issue(file, `${path}.slots`, 'two-handed equipment must use the main-hand slot'));
    if (!reserved.has('off-hand'))
      issues.push(
        issue(file, `${path}.reservedSlots`, 'two-handed equipment must reserve the off-hand slot'),
      );
  }
  if (
    equipment.handedness === 'none' &&
    ([...slots].some((slot) => slot.endsWith('hand')) || reserved.size > 0)
  ) {
    issues.push(
      issue(file, `${path}.handedness`, 'non-handed equipment cannot use or reserve hand slots'),
    );
  }
  for (const slot of slots) {
    if (reserved.has(slot))
      issues.push(
        issue(file, `${path}.reservedSlots`, `slot ${slot} cannot be both equipped and reserved`),
      );
  }
  return issues;
}

function itemCompatibilityIssues(
  file: string,
  item: ItemContentEntry,
  allItems: readonly ItemContentEntry[],
): ContentCompileIssue[] {
  const path = `$.entries.${item.id}`;
  const issues: ContentCompileIssue[] = [];
  if (item.category === 'weapon' && (!item.equipment || !item.combat?.damage)) {
    issues.push(
      issue(file, `${path}.category`, 'weapon items require equipment and combat damage'),
    );
  }
  if (
    (item.category === 'armor' || item.category === 'shield') &&
    (!item.equipment || !item.combat || item.combat.damage !== null)
  ) {
    issues.push(
      issue(
        file,
        `${path}.category`,
        `${item.category} items require equipment and non-damaging combat values`,
      ),
    );
  }
  if (item.category === 'light' && item.light === null) {
    issues.push(issue(file, `${path}.category`, 'light items require light values'));
  }
  if (item.category === 'ammunition' && (item.equipment !== null || item.light !== null)) {
    issues.push(issue(file, `${path}.category`, 'ammunition cannot be equipped or emit light'));
  }
  const ammunitionTag = item.combat?.ammunitionTag;
  if (
    ammunitionTag &&
    !allItems.some(
      (candidate) => candidate.category === 'ammunition' && candidate.tags.includes(ammunitionTag),
    )
  ) {
    issues.push(
      issue(
        file,
        `${path}.combat.ammunitionTag`,
        `ammunition tag ${ammunitionTag} has no matching ammunition item`,
      ),
    );
  }
  if (item.light) {
    let previous = item.light.fuelCapacity + 1;
    item.light.warningThresholds.forEach((threshold, index) => {
      if (threshold >= previous || threshold > item.light!.fuelCapacity) {
        issues.push(
          issue(
            file,
            `${path}.light.warningThresholds.${index}`,
            'light warning thresholds must be unique, descending, and no greater than fuelCapacity',
          ),
        );
      }
      previous = threshold;
    });
  }
  return issues;
}

export function itemIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const allItems = locatedEntries
    .filter(({ entry }) => entry.kind === 'item')
    .map(({ entry }) => entry as ItemContentEntry);
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'item') continue;
    issues.push(
      ...equipmentIssues(file, entry),
      ...itemCompatibilityIssues(file, entry, allItems),
      ...effectIssues(file, entry.id, entry.effects, byId),
    );
  }
  return issues;
}
