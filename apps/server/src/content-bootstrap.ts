import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { ContentPackRepository } from './content-repository.js';

export async function bootstrapContent(
  contentDir: string,
  repository: ContentPackRepository,
): Promise<CompiledContentPack> {
  const pack = await compileStartupContent(contentDir);
  repository.put(pack);
  return pack;
}

export async function compileStartupContent(contentDir: string): Promise<CompiledContentPack> {
  return compileContentDirectory({
    rootDir: contentDir,
    registries: {
      ai: new Set(['ai.skittish']),
      effects: new Set(['effect.light-source']),
    },
  });
}
