import type { ContentEntry, VaultContentEntry, VaultTerrainName } from '../model.js';
import type { ContentCompileIssue } from './error.js';
import { referencedKindIssue } from './content-validation.js';

const potentiallyTraversable = new Set<VaultTerrainName>([
  'floor', 'closed-door', 'stair-up', 'stair-down',
]);

export const TOWN_VAULT_REQUIRED_SLOT_IDS = [
  'dungeon-entrance', 'house-door', 'merchant-provisioner', 'merchant-arms', 'merchant-curios',
] as const;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function validateVaultEntry(
  entry: VaultContentEntry,
  file: string,
  byId: ReadonlyMap<string, ContentEntry> = new Map(),
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const add = (path: string, message: string): void => {
    issues.push({ file, path, message });
  };
  const rows = entry.layout.map((row) => [...row]);
  const expectedWidth = rows[0]?.length ?? 0;

  if (rows.some((row) => row.length !== expectedWidth)) {
    add(`$.entries.${entry.id}.layout`, 'layout rows must have equal code-point width');
  }

  const usedSymbols = new Set<string>();
  const slotLocations = new Map<string, Array<readonly [number, number]>>();
  const fixtureLocations = new Map<string, Array<readonly [number, number]>>();
  const entrances: Array<readonly [number, number]> = [];
  let declaredEntranceCount = 0;

  for (const [y, row] of rows.entries()) {
    const sourceRow = entry.layout[y]!;
    if (/\s$/u.test(sourceRow)) {
      add(`$.entries.${entry.id}.layout.${y}`, 'trailing whitespace is ambiguous');
    }
    for (const [x, symbol] of row.entries()) {
      usedSymbols.add(symbol);
      const path = `$.entries.${entry.id}.layout.${y}.${x}`;
      if (symbol === '\t') add(path, 'tab character is not allowed');
      else if (/\p{Cc}/u.test(symbol)) add(path, 'control character is not allowed');
      if (/\p{Cf}/u.test(symbol)) add(path, 'control-format character is not allowed');

      const legend = entry.legend[symbol];
      if (!legend) {
        add(path, `layout symbol ${symbol} has no legend entry`);
        continue;
      }
      if (legend.entrance) {
        declaredEntranceCount += 1;
        if (potentiallyTraversable.has(legend.terrain)) entrances.push([x, y]);
        else add(path, `entrance terrain ${legend.terrain} is not potentially traversable`);
      }
      if (legend.slot) {
        const locations = slotLocations.get(legend.slot.id) ?? [];
        locations.push([x, y]);
        slotLocations.set(legend.slot.id, locations);
      }
      if (legend.light) {
        const locations = fixtureLocations.get(legend.light.idSuffix) ?? [];
        locations.push([x, y]);
        fixtureLocations.set(legend.light.idSuffix, locations);
      }
    }
  }

  for (const symbol of Object.keys(entry.legend).sort(compareText)) {
    const legend = entry.legend[symbol]!;
    if ([...symbol].length !== 1) {
      add(`$.entries.${entry.id}.legend.${symbol}`, `legend key ${symbol} must be one Unicode code point`);
    }
    if (!usedSymbols.has(symbol)) {
      add(`$.entries.${entry.id}.legend.${symbol}`, `legend symbol ${symbol} is unused`);
    }
    if (legend.terrain === 'void' && legend.light !== null) {
      add(
        `$.entries.${entry.id}.legend.${symbol}.light`,
        `void terrain cannot contain light ${legend.light.idSuffix}; use non-void terrain or remove the light`,
      );
    }
    if (legend.terrain === 'void' && legend.slot !== null) {
      add(
        `$.entries.${entry.id}.legend.${symbol}.slot`,
        `void terrain cannot contain placement slot ${legend.slot.id}; use non-void terrain or remove the slot`,
      );
    }
    if (legend.slot !== null) {
      const { slot } = legend;
      const slotPath = `$.entries.${entry.id}.legend.${symbol}.slot`;
      if (slot.kind === 'item') {
        const setCount = Number(slot.lootTableId !== null) + Number(slot.contentId !== null);
        if (setCount !== 1) {
          add(slotPath, `item slot ${slot.id} must set exactly one of lootTableId or contentId`);
        } else if (slot.lootTableId !== null) {
          issues.push(...referencedKindIssue(file, `${slotPath}.lootTableId`, slot.lootTableId, 'loot-table', byId));
        } else if (slot.contentId !== null) {
          issues.push(...referencedKindIssue(file, `${slotPath}.contentId`, slot.contentId, 'item', byId));
        }
      } else if (slot.lootTableId !== null || slot.contentId !== null) {
        add(slotPath, `${slot.kind} slot ${slot.id} may not set item loot fields`);
      }
    }
  }

  if (declaredEntranceCount === 0) {
    add(`$.entries.${entry.id}.legend`, 'vault must declare at least one entrance');
  }

  for (const [slotId, locations] of [...slotLocations].sort(([left], [right]) => compareText(left, right))) {
    if (locations.length > 1) {
      add(`$.entries.${entry.id}.legend`, `duplicate slot ${slotId}`);
    }
  }
  for (const [suffix, locations] of [...fixtureLocations].sort(([left], [right]) => compareText(left, right))) {
    if (locations.length > 1) {
      add(`$.entries.${entry.id}.legend`, `duplicate fixture suffix ${suffix}`);
    }
  }

  if (entry.tags.includes('town')) {
    const requiredSlotIds = new Set<string>();
    for (const [slotId, locations] of slotLocations) {
      const [slotX, slotY] = locations[0]!;
      const slot = entry.legend[rows[slotY]?.[slotX] ?? '']?.slot;
      if (slot?.required) requiredSlotIds.add(slotId);
    }
    const expectedSlotIds = TOWN_VAULT_REQUIRED_SLOT_IDS;
    const missingSlotIds = expectedSlotIds.filter((id) => !requiredSlotIds.has(id));
    const extraSlotIds = [...requiredSlotIds].filter((id) => !(expectedSlotIds as readonly string[]).includes(id));
    if (missingSlotIds.length > 0 || extraSlotIds.length > 0) {
      add(`$.entries.${entry.id}.requiredSlotIds`,
        `a town vault must declare exactly the required slots ${expectedSlotIds.join(', ')}; `
        + `missing ${missingSlotIds.join(', ') || 'none'}, extra ${extraSlotIds.join(', ') || 'none'}`);
    }
    if (fixtureLocations.size === 0) {
      add(`$.entries.${entry.id}.legend`, 'a town vault must declare at least one light fixture');
    }
    const entranceLocations = slotLocations.get('dungeon-entrance');
    if (entranceLocations) {
      const [entranceX, entranceY] = entranceLocations[0]!;
      const entranceTerrain = entry.legend[rows[entranceY]?.[entranceX] ?? '']?.terrain;
      if (entranceTerrain !== 'stair-down') {
        add(`$.entries.${entry.id}.legend`, 'the dungeon-entrance slot of a town vault must sit on stair-down terrain');
      }
    }
  }

  const reachable = new Set<string>();
  const queue = [...entrances];
  let cursor = 0;
  for (const [x, y] of entrances) reachable.add(`${x},${y}`);
  const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  while (cursor < queue.length) {
    const [x, y] = queue[cursor++]!;
    for (const [dx, dy] of neighbors) {
      const nextX = x + dx;
      const nextY = y + dy;
      const key = `${nextX},${nextY}`;
      if (reachable.has(key)) continue;
      const symbol = rows[nextY]?.[nextX];
      if (symbol === undefined) continue;
      const terrain = entry.legend[symbol]?.terrain;
      if (!terrain || !potentiallyTraversable.has(terrain)) continue;
      reachable.add(key);
      queue.push([nextX, nextY]);
    }
  }

  for (const [slotId, locations] of [...slotLocations].sort(([left], [right]) => compareText(left, right))) {
    const slot = locations[0] ? entry.legend[rows[locations[0][1]]?.[locations[0][0]] ?? '']?.slot : null;
    if (slot?.required && locations.every(([x, y]) => !reachable.has(`${x},${y}`))) {
      add(`$.entries.${entry.id}.legend`, `required slot ${slotId} is unreachable`);
    }
  }

  return issues.sort((left, right) =>
    compareText(left.path, right.path) || compareText(left.message, right.message));
}
