import type { CompiledContentPack } from '@woven-deep/content';
import type { HeroState } from './model.js';

/** The class entry whose classTags are all carried by the hero, or undefined. */
function heroClass(content: CompiledContentPack, hero: HeroState) {
  return content.entries.find(
    (entry) =>
      entry.kind === 'class' &&
      entry.classTags.length > 0 &&
      entry.classTags.every((tag) => hero.classTags.includes(tag)),
  );
}

/** Whether the hero's class may cast from memory and learn from tomes. Non-casters default false. */
export function heroCasterAptitude(content: CompiledContentPack, hero: HeroState): boolean {
  const cls = heroClass(content, hero);
  return cls?.kind === 'class' ? cls.casterAptitude : false;
}
