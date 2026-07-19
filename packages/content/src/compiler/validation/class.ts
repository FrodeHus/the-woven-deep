import type { ClassContentEntry, ContentEntry, EquipmentSlot } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { backpackItemIssues, issue, type LocatedContentEntry } from './shared.js';

function classIssues(
  located: LocatedContentEntry & { entry: ClassContentEntry },
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const { entry: cls, file } = located;
  const path = `$.entries.${cls.id}`;
  const issues: ContentCompileIssue[] = [];
  if (cls.playable && cls.kits.length < 2) {
    issues.push(issue(file, `${path}.kits`, 'a playable class requires at least 2 kits'));
  }
  cls.kits.forEach((kit, kitIndex) => {
    const kitPath = `${path}.kits.${kitIndex}`;
    const occupants: { index: number; slot: EquipmentSlot; occupiedSlots: readonly EquipmentSlot[] }[] = [];
    kit.equipped.forEach((equipped, index) => {
      const equippedPath = `${kitPath}.equipped.${index}`;
      const target = byId.get(equipped.contentId);
      if (!target) {
        issues.push(issue(file, `${equippedPath}.contentId`, `unknown item reference ${equipped.contentId}`));
        return;
      }
      if (target.kind !== 'item') {
        issues.push(issue(file, `${equippedPath}.contentId`, `item reference ${equipped.contentId} resolves to ${target.kind}`));
        return;
      }
      if (!target.equipment) {
        issues.push(issue(file, `${equippedPath}.slot`, `item ${equipped.contentId} cannot be equipped in any slot`));
        return;
      }
      if (!target.equipment.slots.includes(equipped.slot)) {
        issues.push(issue(file, `${equippedPath}.slot`,
          `item ${equipped.contentId} cannot be equipped in slot ${equipped.slot}`));
        return;
      }
      if (equipped.enabled !== undefined && !target.light) {
        issues.push(issue(file, `${equippedPath}.enabled`,
          `kit ${kit.kitId} sets enabled on non-light item ${equipped.contentId}`));
      }
      occupants.push({
        index,
        slot: equipped.slot,
        occupiedSlots: [equipped.slot, ...target.equipment.reservedSlots],
      });
    });
    for (let left = 0; left < occupants.length; left += 1) {
      for (let right = left + 1; right < occupants.length; right += 1) {
        const a = occupants[left]!;
        const b = occupants[right]!;
        const collision = a.occupiedSlots.find((slot) => b.occupiedSlots.includes(slot));
        if (collision) {
          issues.push(issue(file, `${kitPath}.equipped.${b.index}.slot`,
            `kit ${kit.kitId} reserved slot ${collision} conflicts between equipped.${a.index} and equipped.${b.index}`));
        }
      }
    }
    issues.push(...backpackItemIssues(file, `${kitPath}.backpack`, kit.backpack, byId));
  });
  return issues;
}

export function classEntriesIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    if (entry.kind === 'class') issues.push(...classIssues({ entry, file }, byId));
  }
  return issues;
}
