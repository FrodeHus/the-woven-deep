import type {
  ClassContentEntry, CompiledContentPack, ItemContentEntry, MonsterContentEntry, SpellContentEntry,
} from '@woven-deep/content';
import type { GameplayProjection, StoredHallRecord } from '@woven-deep/engine';
import type { SessionSnapshot } from './guest-session.js';
import type { SessionStorageLike } from './storage.js';

/** Where the session's accumulated sighting cache lives -- `sessionStorage`, beside the run save
 * and the portrait glyph (`storage.ts`'s `SAVE_KEY`/`PORTRAIT_KEY`), never engine state: the codex
 * derives from what the guest has genuinely perceived this session, not a first-class,
 * cross-session discovery ledger (that is milestone 6 profile work, per the spec's amendment). */
export const SIGHTINGS_KEY = 'woven-deep.guest-codex';

/** Deduplicated, sorted content ids the session has perceived: `monsterIds` from visible actors
 * (Task 8's engine change, `GameplayProjection.actors[].contentId`), `itemIds` from IDENTIFIED
 * items only (an unidentified item's projection carries no `contentId` at all -- see
 * `projectItem`, `packages/engine/src/identification.ts` -- so there is nothing to leak here). */
export interface Sightings {
  readonly monsterIds: readonly string[];
  readonly itemIds: readonly string[];
}

const EMPTY_SIGHTINGS: Sightings = { monsterIds: [], itemIds: [] };

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSightings(value: unknown): value is Sightings {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return isStringArray(candidate.monsterIds) && isStringArray(candidate.itemIds);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

/**
 * Loads the sighting cache from `storage`, tolerating a missing or corrupted blob -- mirrors
 * `loadSettings`'s contract (`settings.ts`) exactly: `corrupted: true` only for a JSON-parse or
 * shape failure (a missing key is a fresh session, not corruption), and the fallback is always the
 * empty cache. Callers (here, `GuestSession`) turn `corrupted` into the standard storage notice;
 * this module itself never touches React or notices.
 */
export function loadSightings(storage: SessionStorageLike): Readonly<{ sightings: Sightings; corrupted: boolean }> {
  const raw = storage.get(SIGHTINGS_KEY);
  if (raw === null) return { sightings: EMPTY_SIGHTINGS, corrupted: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { sightings: EMPTY_SIGHTINGS, corrupted: true };
  }
  if (!isSightings(parsed)) return { sightings: EMPTY_SIGHTINGS, corrupted: true };
  return { sightings: { monsterIds: sortedUnique(parsed.monsterIds), itemIds: sortedUnique(parsed.itemIds) }, corrupted: false };
}

/** Persists the sighting cache. Throws exactly like `SessionStorageLike.set` itself (quota/
 * unavailable) -- `GuestSession` is the one caller, and it classifies/surfaces that failure through
 * the same storage-notice path `persist()` (the run save) already uses. */
export function saveSightings(storage: SessionStorageLike, sightings: Sightings): void {
  storage.set(SIGHTINGS_KEY, JSON.stringify(sightings));
}

/** The narrow slice of a projected actor this module reads -- `contentId` is `null` for the hero
 * (never present in `projection.actors` at all) and for fallen-champion/echo actors (Task 8's
 * engine doc comment, `projection.ts`), both deliberately excluded from monster sightings. */
interface SightedActor {
  readonly contentId: string | null;
}

/** The narrow slice of a projected item this module reads. `contentId` is only ever present on an
 * IDENTIFIED item's projection (`projectItem`, `packages/engine/src/identification.ts`) -- an
 * unidentified item's projected shape omits it entirely, so its absence alone is the identification
 * gate; there is no separate `identified` check to make here. */
interface SightedItem {
  readonly contentId?: string;
}

function itemContentIds(items: readonly SightedItem[]): readonly string[] {
  return items.flatMap((item) => (item.contentId === undefined ? [] : [item.contentId]));
}

/**
 * Folds one projection's worth of freshly-perceived content ids into `prev` -- pure, monotone
 * (never removes an id), deduplicated, and sorted. Reads exactly three projection surfaces, all
 * already engine-projected for reasons unrelated to the codex: visible actors (Task 8's own
 * addition), the hero's backpack/equipment, ground items, and (when trading) the merchant's stock
 * -- "identified owned/ground/stock items", per the design amendment.
 */
export function accumulateSightings(prev: Sightings, projection: GameplayProjection): Sightings {
  const actors = projection.actors as unknown as readonly SightedActor[];
  const monsterIds = sortedUnique([
    ...prev.monsterIds,
    ...actors.flatMap((actor) => (actor.contentId === null ? [] : [actor.contentId])),
  ]);

  const hero = projection.hero as unknown as Readonly<{
    backpack: readonly SightedItem[];
    equipment: Readonly<Record<string, SightedItem | null>>;
  }>;
  const equipped = Object.values(hero.equipment).flatMap((item) => (item ? [item] : []));
  const groundItems = projection.groundItems as unknown as readonly SightedItem[];
  const stockItems = (projection.trade?.stock ?? []).map((offer) => offer.item as unknown as SightedItem);

  const itemIds = sortedUnique([
    ...prev.itemIds,
    ...itemContentIds(hero.backpack),
    ...itemContentIds(equipped),
    ...itemContentIds(groundItems),
    ...itemContentIds(stockItems),
  ]);

  return { monsterIds, itemIds };
}

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
 * (already disclosed, unlocked or not, by the chargen screen -- see `chargen-steps.tsx`'s
 * `ClassStep`); for the other three kinds (no silhouette field exists in their content shape), a
 * fixed placeholder glyph.
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
function firstSeenRun(records: readonly StoredHallRecord[], predicate: (record: StoredHallRecord) => boolean): number | null {
  const index = records.findIndex(predicate);
  return index === -1 ? null : index + 1;
}

function byId<T extends { readonly id: string }>(entries: readonly T[]): readonly T[] {
  return [...entries].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function deriveMonsterCategory(
  pack: CompiledContentPack, records: readonly StoredHallRecord[], sightings: Sightings,
): CodexCategory {
  const entries = byId(pack.entries.filter((entry): entry is MonsterContentEntry => entry.kind === 'monster'));
  const sighted = new Set(sightings.monsterIds);
  const killed = new Set(records.flatMap((record) => (record.cause.killerContentId === null ? [] : [record.cause.killerContentId])));
  return {
    kind: 'monster',
    entries: entries.map((entry): CodexEntry => {
      if (!sighted.has(entry.id) && !killed.has(entry.id)) return { discovered: false, silhouetteGlyph: GENERIC_SILHOUETTE_GLYPH };
      return {
        discovered: true, contentId: entry.id, name: entry.name, glyph: entry.glyph, color: entry.color,
        description: null, firstSeenRun: firstSeenRun(records, (record) => record.cause.killerContentId === entry.id),
      };
    }),
  };
}

function deriveItemCategory(
  pack: CompiledContentPack, records: readonly StoredHallRecord[], sightings: Sightings,
): CodexCategory {
  const entries = byId(pack.entries.filter((entry): entry is ItemContentEntry => entry.kind === 'item'));
  const sighted = new Set(sightings.itemIds);
  const equipped = new Set(records.flatMap((record) => record.build.equippedItemContentIds));
  return {
    kind: 'item',
    entries: entries.map((entry): CodexEntry => {
      if (!sighted.has(entry.id) && !equipped.has(entry.id)) return { discovered: false, silhouetteGlyph: GENERIC_SILHOUETTE_GLYPH };
      return {
        discovered: true, contentId: entry.id, name: entry.name, glyph: entry.glyph, color: entry.color,
        description: null,
        firstSeenRun: firstSeenRun(records, (record) => record.build.equippedItemContentIds.includes(entry.id)),
      };
    }),
  };
}

/** No cast-tracking source exists yet for spells (no class abilities/cast log land until a later
 * milestone) -- per the design amendment, a category whose discovery sources don't exist yet
 * renders fully undiscovered rather than inventing one. */
function deriveSpellCategory(pack: CompiledContentPack): CodexCategory {
  const entries = byId(pack.entries.filter((entry): entry is SpellContentEntry => entry.kind === 'spell'));
  return { kind: 'spell', entries: entries.map((): CodexEntry => ({ discovered: false, silhouetteGlyph: GENERIC_SILHOUETTE_GLYPH })) };
}

/** Every bundled `ClassContentEntry`, sorted by id -- exported so `CodexOverlay` can zip its own
 * pack lookup against `CodexState`'s spoiler-free class category (by shared index) to find a
 * locked class's `unlockHint`, which `CodexEntry`'s undiscovered variant does not itself carry. */
export function sortedClassEntries(pack: CompiledContentPack): readonly ClassContentEntry[] {
  return byId(pack.entries.filter((entry): entry is ClassContentEntry => entry.kind === 'class'));
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
function classDiscovered(
  entry: ClassContentEntry, records: readonly StoredHallRecord[], heroClassTags: readonly string[] | null,
): boolean {
  const coversEntry = (tags: readonly string[]): boolean => entry.classTags.every((tag) => tags.includes(tag));
  if (heroClassTags !== null && coversEntry(heroClassTags)) return true;
  return records.some((record) => coversEntry(record.classTags));
}

function deriveClassCategory(
  pack: CompiledContentPack, records: readonly StoredHallRecord[], snapshot: SessionSnapshot | null,
): CodexCategory {
  const entries = sortedClassEntries(pack);
  const heroClassTags = snapshot?.heroClassTags ?? null;
  return {
    kind: 'class',
    entries: entries.map((entry): CodexEntry => {
      if (!classDiscovered(entry, records, heroClassTags)) {
        return { discovered: false, silhouetteGlyph: entry.silhouetteGlyph };
      }
      const coversEntry = (tags: readonly string[]): boolean => entry.classTags.every((tag) => tags.includes(tag));
      return {
        discovered: true, contentId: entry.id, name: entry.name, glyph: entry.silhouetteGlyph, color: CLASS_ENTRY_COLOR,
        description: entry.description, firstSeenRun: firstSeenRun(records, (record) => coversEntry(record.classTags)),
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
export function deriveCodexState(input: Readonly<{
  records: readonly StoredHallRecord[];
  snapshot: SessionSnapshot | null;
  sightings: Sightings;
  pack: CompiledContentPack;
}>): CodexState {
  return {
    categories: [
      deriveClassCategory(input.pack, input.records, input.snapshot),
      deriveItemCategory(input.pack, input.records, input.sightings),
      deriveSpellCategory(input.pack),
      deriveMonsterCategory(input.pack, input.records, input.sightings),
    ],
  };
}
