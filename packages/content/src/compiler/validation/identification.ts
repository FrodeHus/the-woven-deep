import type {
  ContentEntry,
  IdentificationPoolContentEntry,
  ItemContentEntry,
} from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { issue, type LocatedContentEntry } from './shared.js';

function identificationIssues(
  items: readonly LocatedContentEntry[],
  pools: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const usersByPool = new Map<string, Array<{ item: ItemContentEntry; file: string }>>();
  for (const located of pools) {
    const pool = located.entry as IdentificationPoolContentEntry;
    const path = `$.entries.${pool.id}`;
    if (new Set(pool.verbs).size !== pool.verbs.length) {
      issues.push(issue(located.file, `${path}.verbs`, 'identification pool verbs must be unique'));
    }
    if (new Set(pool.nouns).size !== pool.nouns.length) {
      issues.push(issue(located.file, `${path}.nouns`, 'identification pool nouns must be unique'));
    }
    if (new Set(pool.visuals.map((visual) => visual.id)).size !== pool.visuals.length) {
      issues.push(
        issue(located.file, `${path}.visuals`, 'identification pool visual IDs must be unique'),
      );
    }
  }
  for (const located of items) {
    const item = located.entry as ItemContentEntry;
    const path = `$.entries.${item.id}.identification`;
    if (item.identification.mode === 'known') {
      if (item.identification.poolId !== null) {
        issues.push(
          issue(
            located.file,
            `${path}.poolId`,
            'known items cannot declare an identification pool',
          ),
        );
      }
      continue;
    }
    if (item.identification.poolId === null) {
      issues.push(
        issue(located.file, `${path}.poolId`, 'unidentified items require an identification pool'),
      );
      continue;
    }
    const pool = byId.get(item.identification.poolId);
    if (!pool) {
      issues.push(
        issue(
          located.file,
          `${path}.poolId`,
          `unknown identification pool ${item.identification.poolId}`,
        ),
      );
      continue;
    }
    if (pool.kind !== 'identification-pool') {
      issues.push(
        issue(
          located.file,
          `${path}.poolId`,
          `identification pool reference ${item.identification.poolId} resolves to ${pool.kind}`,
        ),
      );
      continue;
    }
    if (pool.category !== item.category) {
      issues.push(
        issue(
          located.file,
          `${path}.poolId`,
          `identification pool ${pool.id} is for ${pool.category}, not ${item.category}`,
        ),
      );
    }
    const users = usersByPool.get(pool.id) ?? [];
    users.push({ item, file: located.file });
    usersByPool.set(pool.id, users);
  }
  for (const [poolId, users] of usersByPool) {
    const pool = byId.get(poolId) as IdentificationPoolContentEntry;
    if (pool.verbs.length * pool.nouns.length >= users.length) continue;
    for (const { item, file } of users) {
      issues.push(
        issue(
          file,
          `$.entries.${item.id}.identification.poolId`,
          `identification pool ${poolId} can create ${pool.verbs.length * pool.nouns.length} unique names for ${users.length} items`,
        ),
      );
    }
  }
  return issues;
}

export function identificationEntriesIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const itemEntries = locatedEntries.filter(({ entry }) => entry.kind === 'item');
  const poolEntries = locatedEntries.filter(({ entry }) => entry.kind === 'identification-pool');
  return identificationIssues(itemEntries, poolEntries, byId);
}
