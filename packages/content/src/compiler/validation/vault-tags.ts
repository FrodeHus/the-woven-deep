import type { LocatedContentEntry } from './shared.js';

export function buildVaultTags(locatedEntries: readonly LocatedContentEntry[]): ReadonlySet<string> {
  const vaultTags = new Set<string>();
  for (const { entry } of locatedEntries) {
    if (entry.kind !== 'vault') continue;
    entry.tags.forEach((tag) => vaultTags.add(tag));
    Object.values(entry.legend).forEach((legend) => legend.slot?.tags.forEach((tag) => vaultTags.add(tag)));
  }
  return vaultTags;
}
