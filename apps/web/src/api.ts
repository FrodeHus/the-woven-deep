import {
  CONTENT_KIND_IDS, validateCompiledContentPack, type CompiledContentPack, type ContentKind,
} from '@woven-deep/content';

export interface ContentSummary {
  readonly hash: string;
  readonly entries: number;
  readonly counts: Readonly<Record<ContentKind, number>>;
}

async function fetchContentPack(fetcher: typeof fetch): Promise<CompiledContentPack> {
  const response = await fetcher('/api/content/guest');
  if (!response.ok) throw new Error('The content service is unavailable.');
  return validateCompiledContentPack(await response.json());
}

export async function loadContentSummary(fetcher: typeof fetch = fetch): Promise<ContentSummary> {
  const [healthResponse, pack] = await Promise.all([
    fetcher('/api/health'),
    fetchContentPack(fetcher),
  ]);
  if (!healthResponse.ok) throw new Error('The content service is unavailable.');
  const health = await healthResponse.json() as { contentHash: string; entries: number };
  if (pack.hash !== health.contentHash) throw new Error('The content service returned mismatched versions.');
  const counts = Object.fromEntries(
    CONTENT_KIND_IDS.map((kind) => [kind, 0]),
  ) as Record<ContentKind, number>;
  for (const entry of pack.entries) counts[entry.kind] += 1;
  return { hash: pack.hash, entries: health.entries, counts };
}

export async function loadContentPack(fetcher: typeof fetch = fetch): Promise<CompiledContentPack> {
  return fetchContentPack(fetcher);
}
