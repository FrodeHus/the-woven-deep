import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { ContentPackRepository } from './content-repository.js';

export async function bootstrapContent(
  contentDir: string,
  repository: ContentPackRepository,
): Promise<CompiledContentPack> {
  const pack = await compileContentDirectory({
    rootDir: contentDir,
    registries: {
      ai: new Set(['ai.skittish']),
      effects: new Set(['effect.light-source']),
    },
  });
  repository.put(pack);
  return pack;
}
