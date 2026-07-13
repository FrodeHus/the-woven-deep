import type { VaultContentEntry, VaultTerrainName } from '../model.js';
import type { ContentCompileIssue } from './error.js';

const potentiallyTraversable = new Set<VaultTerrainName>([
  'floor', 'closed-door', 'stair-up', 'stair-down',
]);

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function validateVaultEntry(entry: VaultContentEntry, file: string): ContentCompileIssue[] {
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
    if ([...symbol].length !== 1) {
      add(`$.entries.${entry.id}.legend.${symbol}`, `legend key ${symbol} must be one Unicode code point`);
    }
    if (!usedSymbols.has(symbol)) {
      add(`$.entries.${entry.id}.legend.${symbol}`, `legend symbol ${symbol} is unused`);
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
