import type {
  ClassContentEntry, CompiledContentPack, ItemContentEntry, MonsterContentEntry, SpellContentEntry,
} from '@woven-deep/content';
import type { GameplayProjection, StoredHallRecord } from '@woven-deep/engine';
import { actorsOf, groundItemsOf, heroOf, tradeOf } from './projection-view.js';
import type { SessionSnapshot } from './guest-session.js';
import type { SessionStorageLike } from './storage.js';

/** Where the session's accumulated sighting cache lives -- `sessionStorage`, beside the run save
 * and the portrait glyph (`storage.ts`'s `SAVE_KEY`/`PORTRAIT_KEY`), never engine state: the codex
 * derives from what the guest has genuinely perceived this session, not a first-class,
 * cross-session discovery ledger (that is milestone 6 profile work, per the spec's amendment). */
export const SIGHTINGS_KEY = 'woven-deep.guest-codex';

/** A landmark of interest captured on first perception -- a stair tile, a merchant met, or the
 * town house door -- persisted so it survives even once the source cell/actor/slot is no longer
 * in the live projection (a merchant who has since departed, a stair cell scrolled off the
 * camera). Deduplicated by `(floorId, kind, x, y)`: the FIRST capture of a given landmark wins
 * (see `dedupeLandmarks`), so a merchant's disclosed name is frozen at the moment it was first
 * met, never overwritten by a later, different presentation. */
export interface Landmark {
  readonly floorId: string;
  readonly kind: 'merchant' | 'stair-up' | 'stair-down' | 'house';
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/** Deduplicated, sorted content ids the session has perceived: `monsterIds` from visible actors
 * (Task 8's engine change, `GameplayProjection.actors[].contentId`), `itemIds` from IDENTIFIED
 * items only (an unidentified item's projection carries no `contentId` at all -- see
 * `projectItem`, `packages/engine/src/identification.ts` -- so there is nothing to leak here).
 * `landmarks` rides the same blob (Task 10) -- see `Landmark` above. */
export interface Sightings {
  readonly monsterIds: readonly string[];
  readonly itemIds: readonly string[];
  readonly landmarks: readonly Landmark[];
}

const EMPTY_SIGHTINGS: Sightings = { monsterIds: [], itemIds: [], landmarks: [] };

const LANDMARK_KINDS = ['merchant', 'stair-up', 'stair-down', 'house'] as const;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isLandmark(value: unknown): value is Landmark {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return typeof candidate.floorId === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.x === 'number'
    && typeof candidate.y === 'number'
    && typeof candidate.kind === 'string'
    && (LANDMARK_KINDS as readonly string[]).includes(candidate.kind);
}

function isLandmarkArray(value: unknown): value is readonly Landmark[] {
  return Array.isArray(value) && value.every(isLandmark);
}

/** `landmarks` is forward-tolerant: an OLD blob written before this field existed simply omits
 * it -- that is a fresh-to-this-feature session, not corruption, so it loads as `[]`. A PRESENT
 * but malformed `landmarks` is corruption like any other shape failure. */
function isSightings(value: unknown): value is Omit<Sightings, 'landmarks'> & { readonly landmarks?: readonly Landmark[] } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (!isStringArray(candidate.monsterIds) || !isStringArray(candidate.itemIds)) return false;
  return candidate.landmarks === undefined || isLandmarkArray(candidate.landmarks);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

/** Stable dedup key for a landmark -- `(floorId, kind, x, y)`, per the brief. */
function landmarkKey(landmark: Readonly<Pick<Landmark, 'floorId' | 'kind' | 'x' | 'y'>>): string {
  return `${landmark.floorId}|${landmark.kind}|${landmark.x}|${landmark.y}`;
}

/** Dedupes by `landmarkKey`, keeping the FIRST occurrence of each key (see `Landmark`'s doc
 * comment) -- never re-sorted, since insertion order IS the "captured earliest" order this
 * module's callers rely on. */
function dedupeLandmarks(landmarks: readonly Landmark[]): readonly Landmark[] {
  const seen = new Map<string, Landmark>();
  for (const landmark of landmarks) {
    const key = landmarkKey(landmark);
    if (!seen.has(key)) seen.set(key, landmark);
  }
  return [...seen.values()];
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
  return {
    sightings: {
      monsterIds: sortedUnique(parsed.monsterIds),
      itemIds: sortedUnique(parsed.itemIds),
      landmarks: dedupeLandmarks(parsed.landmarks ?? []),
    },
    corrupted: false,
  };
}

/** Persists the sighting cache. Throws exactly like `SessionStorageLike.set` itself (quota/
 * unavailable) -- `GuestSession` is the one caller, and it classifies/surfaces that failure through
 * the same storage-notice path `persist()` (the run save) already uses. */
export function saveSightings(storage: SessionStorageLike, sightings: Sightings): void {
  storage.set(SIGHTINGS_KEY, JSON.stringify(sightings));
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

/** Stair tile ids (`packages/engine/src/terrain.ts`'s `TILE_DEFINITIONS`) -- both stairs share
 * the same `terrain.stair` token, so `tileId` (not `token`) is the only field distinguishing up
 * from down. Duplicated here (rather than imported) to keep this module free of an engine terrain
 * import for two literals; `MapJournalOverlay.tsx` keeps its own copy for the same reason. */
const STAIR_UP_TILE_ID = 4;
const STAIR_DOWN_TILE_ID = 5;

/** The narrow slice of a projected cell landmark capture reads. */
interface SightedCell {
  readonly knowledge: 'unknown' | 'remembered' | 'visible';
  readonly tileId?: number;
  readonly x: number;
  readonly y: number;
}

/** The narrow slice of a projected floor landmark capture reads. */
interface SightedFloor {
  readonly floorId: string;
  readonly town: boolean;
  readonly cells: readonly SightedCell[];
}

/** The narrow slice of a projected actor landmark capture reads -- `factionName` is the merchant
 * signal (only ever present via `visibleMerchantState`, `projection.ts`, regardless of whether the
 * floor is town or a dungeon), `name` is the actor's own disclosed presentation name (already
 * `populationPresentation?.name` by the time it reaches the projection -- reading it here, instead
 * of re-deriving it from a population lookup, is exactly what "solves the populationPresentation
 * lookup gap host-side" means). */
interface LandmarkActor {
  readonly x: number;
  readonly y: number;
  readonly name?: string;
  readonly factionName?: string;
}

/** The narrow slice of a projected town placement slot landmark capture reads. */
interface SightedSlot {
  readonly tags: readonly string[];
  readonly x: number;
  readonly y: number;
}

/**
 * The landmarks freshly perceivable in one projection -- NOT yet deduped/merged with `prev` (that
 * is `accumulateLandmarks`'s job). Stairs from any non-unknown cell carrying a stair tileId; the
 * house from the town's `house-door`-tagged slot (slots are only ever populated on the town floor,
 * `projection.ts`'s `slots` doc comment); merchants from any visible actor carrying a
 * `factionName`, uniformly in town or a dungeon.
 */
function capturedLandmarks(floor: SightedFloor, actors: readonly LandmarkActor[], slots: readonly SightedSlot[]): readonly Landmark[] {
  const captured: Landmark[] = [];

  for (const cell of floor.cells) {
    if (cell.knowledge === 'unknown') continue;
    if (cell.tileId === STAIR_UP_TILE_ID) {
      captured.push({ floorId: floor.floorId, kind: 'stair-up', name: 'Stairs up', x: cell.x, y: cell.y });
    } else if (cell.tileId === STAIR_DOWN_TILE_ID) {
      captured.push({ floorId: floor.floorId, kind: 'stair-down', name: 'Stairs down', x: cell.x, y: cell.y });
    }
  }

  if (floor.town) {
    for (const slot of slots) {
      if (slot.tags.includes('house-door')) {
        captured.push({ floorId: floor.floorId, kind: 'house', name: 'The house', x: slot.x, y: slot.y });
      }
    }
  }

  for (const actor of actors) {
    if (typeof actor.factionName !== 'string') continue;
    // In town, this capture is unreachable from the CURRENT session's journal: actors are pinned
    // to their slot in town (an engine invariant), so `MapJournalOverlay`'s merge always has a
    // live, slot-based merchant landmark at this exact (x,y), and the live entry always wins. It
    // is still captured here for a future cross-run codex (Milestone 6) that outlives the current
    // session's live projection.
    captured.push({
      floorId: floor.floorId, kind: 'merchant', name: actor.name ?? actor.factionName, x: actor.x, y: actor.y,
    });
  }

  return captured;
}

/**
 * Folds one projection's worth of freshly-perceived landmarks into `prev` -- pure, monotone (never
 * removes or renames an already-captured landmark, since `dedupeLandmarks` keeps the first
 * occurrence of each `(floorId, kind, x, y)` key), deduplicated. This is the "live becomes
 * persisted" half the brief describes: `MapJournalOverlay`'s `landmarksFor` stays the fresh,
 * per-render derivation (the live half); this is the accumulating, storage-backed half.
 */
export function accumulateLandmarks(prev: readonly Landmark[], projection: GameplayProjection): readonly Landmark[] {
  return dedupeLandmarks([...prev, ...capturedLandmarks(projection.floor, actorsOf(projection), projection.slots)]);
}

/**
 * Folds one projection's worth of freshly-perceived content ids (and landmarks -- Task 10's
 * `accumulateLandmarks`) into `prev` -- pure, monotone (never removes an id or a landmark),
 * deduplicated, and sorted. The content-id half reads three projection surfaces, all already
 * engine-projected for reasons unrelated to the codex: visible actors (Task 8's own addition), the
 * hero's backpack/equipment, ground items, and (when trading) the merchant's stock -- "identified
 * owned/ground/stock items", per the design amendment.
 */
export function accumulateSightings(prev: Sightings, projection: GameplayProjection): Sightings {
  const actors = actorsOf(projection);
  const monsterIds = sortedUnique([
    ...prev.monsterIds,
    ...actors.flatMap((actor) => (actor.contentId === null ? [] : [actor.contentId])),
  ]);

  const hero = heroOf(projection);
  const equipped = Object.values(hero.equipment).flatMap((item) => (item ? [item] : []));
  const groundItems = groundItemsOf(projection);
  const stockItems = (tradeOf(projection)?.stock ?? []).map((offer) => offer.item);

  const itemIds = sortedUnique([
    ...prev.itemIds,
    ...itemContentIds(hero.backpack),
    ...itemContentIds(equipped),
    ...itemContentIds(groundItems),
    ...itemContentIds(stockItems),
  ]);

  const landmarks = accumulateLandmarks(prev.landmarks, projection);

  return { monsterIds, itemIds, landmarks };
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
