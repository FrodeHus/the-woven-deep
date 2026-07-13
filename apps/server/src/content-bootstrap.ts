import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { ContentPackRepository } from './content-repository.js';

export async function bootstrapContent(
  contentDir: string,
  repository: ContentPackRepository,
  signal?: AbortSignal,
): Promise<CompiledContentPack> {
  const pack = await compileStartupContent(contentDir, signal);
  repository.put(pack);
  return pack;
}

export async function compileStartupContent(
  contentDir: string,
  signal?: AbortSignal,
): Promise<CompiledContentPack> {
  return compileContentDirectory({
    rootDir: contentDir,
    ...(signal ? { signal } : {}),
  });
}
