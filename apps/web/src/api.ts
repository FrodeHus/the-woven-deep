import type { CompiledContentPack, ContentKind } from '@woven-deep/content';

export interface ContentSummary {
  readonly hash: string;
  readonly entries: number;
  readonly counts: Readonly<Record<ContentKind, number>>;
}

export async function loadContentSummary(fetcher: typeof fetch = fetch): Promise<ContentSummary> {
  const [healthResponse, packResponse] = await Promise.all([
    fetcher('/api/health'),
    fetcher('/api/content/guest'),
  ]);
  if (!healthResponse.ok || !packResponse.ok) throw new Error('The content service is unavailable.');
  const health = await healthResponse.json() as { contentHash: string; entries: number };
  const pack = await packResponse.json() as CompiledContentPack;
  if (pack.hash !== health.contentHash) throw new Error('The content service returned mismatched versions.');
  const counts = { monster: 0, item: 0 } satisfies Record<ContentKind, number>;
  for (const entry of pack.entries) counts[entry.kind] += 1;
  return { hash: pack.hash, entries: health.entries, counts };
}
