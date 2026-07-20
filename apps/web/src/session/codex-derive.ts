import type { ClassContentEntry, CompiledContentPack } from '@woven-deep/content';
import type { StoredHallRecord } from '@woven-deep/engine';
import type { SessionSnapshot } from './guest-session.js';
import type { Sightings } from './codex-storage.js';
import { classEntries, itemEntries, monsterEntries, spellEntries } from './pack-queries.js';

export interface CodexCategory {
  readonly kind: 'class' | 'item' | 'spell' | 'monster';
  readonly entries: readonly CodexEntry[];
}

export interface CodexState {
  readonly categories: readonly CodexCategory[];
}

/**
 * A discovered entry discloses everything the content pack itself carries for that entry's kind;
 * an undiscovered entry carries NEITHER `contentId` NOR `name` -- structurally spoiler-free, not
 * merely conventionally hidden (a property test serializes the whole `CodexState` and greps for
 * every undiscovered id/name to hold this to account). `silhouetteGlyph` is the one thing an
 * undiscovered entry may show: for classes, the content pack's own `ClassContentEntry.silhouetteGlyph`
 * (already disclosed, unlocked or not, by the Calling step of chargen); for the other three kinds
 * (no silhouette field exists in their content shape), a fixed placeholder glyph.
 */
export type CodexEntry =
  | {
      readonly discovered: true;
      readonly contentId: string;
      readonly name: string;
      readonly glyph: string;
      readonly color: string;
      readonly description: string | null;
      readonly firstSeenRun: number | null;
    }
  | { readonly discovered: false; readonly silhouetteGlyph: string };

/** The fixed silhouette shown for an undiscovered item/spell/monster -- these three content kinds
 * carry no silhouette field of their own (only classes do), so this is an invented-but-disclosed
 * placeholder, not derived from anything that could leak identity. */
const GENERIC_SILHOUETTE_GLYPH = '?';

/** 1-based index of the earliest record satisfying `predicate`, or `null` if none does (an
 * active-run-only or sighting-only discovery, per the discovery rules). `records` is already in
 * the Hall's own append order (earliest first) -- see `RunRecordRepository.records()`. */
function firstSeenRun(
  records: readonly StoredHallRecord[],
  predicate: (record: StoredHallRecord) => boolean,
): number | null {
  const index = records.findIndex(predicate);
  return index === -1 ? null : index + 1;
}

function byId<T extends { readonly id: string }>(entries: readonly T[]): readonly T[] {
  return [...entries].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function deriveMonsterCategory(
  pack: CompiledContentPack,
  records: readonly StoredHallRecord[],
  sightings: Sightings,
): CodexCategory {
  const entries = byId(monsterEntries(pack));
  const sighted = new Set(sightings.monsterIds);
  const killed = new Set(
    records.flatMap((record) =>
      record.cause.killerContentId === null ? [] : [record.cause.killerContentId],
    ),
  );
  return {
    kind: 'monster',
    entries: entries.map((entry): CodexEntry => {
      if (!sighted.has(entry.id) && !killed.has(entry.id))
        return { discovered: false, silhouetteGlyph: GENERIC_SILHOUETTE_GLYPH };
      return {
        discovered: true,
        contentId: entry.id,
        name: entry.name,
        glyph: entry.glyph,
        color: entry.color,
        description: null,
        firstSeenRun: firstSeenRun(records, (record) => record.cause.killerContentId === entry.id),
      };
    }),
  };
}

function deriveItemCategory(
  pack: CompiledContentPack,
  records: readonly StoredHallRecord[],
  sightings: Sightings,
): CodexCategory {
  const entries = byId(itemEntries(pack));
  const sighted = new Set(sightings.itemIds);
  const equipped = new Set(records.flatMap((record) => record.build.equippedItemContentIds));
  return {
    kind: 'item',
    entries: entries.map((entry): CodexEntry => {
      if (!sighted.has(entry.id) && !equipped.has(entry.id))
        return { discovered: false, silhouetteGlyph: GENERIC_SILHOUETTE_GLYPH };
      return {
        discovered: true,
        contentId: entry.id,
        name: entry.name,
        glyph: entry.glyph,
        color: entry.color,
        description: null,
        firstSeenRun: firstSeenRun(records, (record) =>
          record.build.equippedItemContentIds.includes(entry.id),
        ),
      };
    }),
  };
}

/** No cast-tracking source exists yet for spells (no class abilities/cast log land until a later
 * milestone) -- per the design amendment, a category whose discovery sources don't exist yet
 * renders fully undiscovered rather than inventing one. */
function deriveSpellCategory(pack: CompiledContentPack): CodexCategory {
  const entries = byId(spellEntries(pack));
  return {
    kind: 'spell',
    entries: entries.map((): CodexEntry => ({
      discovered: false,
      silhouetteGlyph: GENERIC_SILHOUETTE_GLYPH,
    })),
  };
}

/** Every bundled `ClassContentEntry`, sorted by id -- exported so `CodexOverlay` can zip its own
 * pack lookup against `CodexState`'s spoiler-free class category (by shared index) to find a
 * locked class's `unlockHint`, which `CodexEntry`'s undiscovered variant does not itself carry. */
export function sortedClassEntries(pack: CompiledContentPack): readonly ClassContentEntry[] {
  return byId(classEntries(pack));
}

/** Neither `ClassContentEntry` nor any of its "run" callers project a `color` field for classes (the
 * chargen screen never draws one) -- this is a fixed, disclosed placeholder, not an invented
 * per-class flavor. */
const CLASS_ENTRY_COLOR = '#c9c9c9';

/**
 * A class is discovered by tag-subset matching, NOT by a stored class id -- neither the active run
 * nor a `StoredHallRecord` records one (only `classTags[]`; see the design amendment). A class is
 * discovered when EVERY one of its own `classTags` is present in the active hero's `classTags`
 * (`snapshot.heroClassTags`) or in some past record's `classTags` -- the bundled content's tags are
 * distinctive per class (asserted by `codex.test.ts`'s uniqueness fixture), so this subset test
 * never actually matches more than the one intended class today.
 */
/** True if `tags` contains every one of `entry`'s own `classTags` -- the shared subset test both
 * `classDiscovered` and `deriveClassCategory` apply against a hero's or a record's `classTags`. */
function classCoversEntry(entry: ClassContentEntry, tags: readonly string[]): boolean {
  return entry.classTags.every((tag) => tags.includes(tag));
}

function classDiscovered(
  entry: ClassContentEntry,
  records: readonly StoredHallRecord[],
  heroClassTags: readonly string[] | null,
): boolean {
  if (heroClassTags !== null && classCoversEntry(entry, heroClassTags)) return true;
  return records.some((record) => classCoversEntry(entry, record.classTags));
}

function deriveClassCategory(
  pack: CompiledContentPack,
  records: readonly StoredHallRecord[],
  snapshot: SessionSnapshot | null,
): CodexCategory {
  const entries = sortedClassEntries(pack);
  const heroClassTags = snapshot?.heroClassTags ?? null;
  return {
    kind: 'class',
    entries: entries.map((entry): CodexEntry => {
      if (!classDiscovered(entry, records, heroClassTags)) {
        return { discovered: false, silhouetteGlyph: entry.silhouetteGlyph };
      }
      return {
        discovered: true,
        contentId: entry.id,
        name: entry.name,
        glyph: entry.silhouetteGlyph,
        color: CLASS_ENTRY_COLOR,
        description: entry.description,
        firstSeenRun: firstSeenRun(records, (record) => classCoversEntry(entry, record.classTags)),
      };
    }),
  };
}

/**
 * Combines the two host-side discovery sources -- genuine record/active-run facts, and the session
 * sighting cache -- into one read-only codex, one category per content kind, in the spec's own
 * listed order (classes, items, spells, monsters). Pure: no storage access, no React. `snapshot` is
 * `null` at the title screen (codex is a `global`-scope overlay, reachable with no live run) -- the
 * "active hero's class" discovery source is then simply unavailable, exactly like every other
 * active-run-only source when there is no active run.
 */
export function deriveCodexState(
  input: Readonly<{
    records: readonly StoredHallRecord[];
    snapshot: SessionSnapshot | null;
    sightings: Sightings;
    pack: CompiledContentPack;
  }>,
): CodexState {
  return {
    categories: [
      deriveClassCategory(input.pack, input.records, input.snapshot),
      deriveItemCategory(input.pack, input.records, input.sightings),
      deriveSpellCategory(input.pack),
      deriveMonsterCategory(input.pack, input.records, input.sightings),
    ],
  };
}
