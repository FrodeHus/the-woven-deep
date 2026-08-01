import type { CompiledContentPack } from '@woven-deep/content';
import type { HauntView, OpaqueId } from '@woven-deep/engine';

/**
 * Host-rendered prose for a haunt's spoken lines, exactly like `provenanceLine`'s pattern: the
 * engine emits ids and facts (`HauntView`), never sentences. Every line here reads projected
 * record data only -- these are the player's own Hall records, already visible on the Hall
 * screen.
 */

function displayName(haunt: HauntView): string {
  return haunt.role === 'champion'
    ? `${haunt.heroName}, the Deep's Champion`
    : `Echo of ${haunt.heroName}`;
}

/** `a bone-gnawer` for a resolvable monster, `the dark` for null or a content-drifted id. */
export function killerPhrase(pack: CompiledContentPack, killerContentId: OpaqueId | null): string {
  if (killerContentId === null) return 'the dark';
  const entry = pack.entries.find((candidate) => candidate.id === killerContentId);
  // A record can outlive the monster that wrote it. "The dark" is the honest degradation: the
  // record still speaks, it just no longer names a thing this pack knows.
  return entry === undefined || entry.kind !== 'monster'
    ? 'the dark'
    : `a ${entry.name.toLowerCase()}`;
}

/** The line a haunt speaks on first sight. Host-rendered prose from record data only. */
export function hauntEncounterLine(haunt: HauntView, pack: CompiledContentPack): string {
  const name = displayName(haunt);
  if (haunt.causeDepth === null) return `${name}. The Deep remembers.`;
  return `${name} — fell to ${killerPhrase(pack, haunt.killerContentId)} at depth ${haunt.causeDepth}. The Deep remembers.`;
}

/** The line an appeased haunt leaves behind. */
export function hauntFarewellLine(haunt: HauntView): string {
  return `${displayName(haunt)} is at peace. The Deep releases what it held.`;
}
