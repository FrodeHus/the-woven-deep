export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlayfieldAtlas {
  imageUrl: string;
  blockDepthPx: number;
  floors: AtlasRect[];
  dirty: AtlasRect[];
  walls: AtlasRect[];
  rounded: AtlasRect[];
  weaveWalls: AtlasRect[];
  stairs: AtlasRect;
  stairsUp: AtlasRect;
  door: AtlasRect;
  gate: AtlasRect;
  /** Open-door archway. OPTIONAL: absent in the current measured sheet, so an open door falls back
   * to a glyph until the art ships. Parsed only when present. */
  archOpen?: AtlasRect;
  torch: AtlasRect;
  torchWall: AtlasRect;
  pillar: AtlasRect;
  pillarBroken: AtlasRect;
  townFloors: AtlasRect[];
  townWalls: AtlasRect[];
  houseDoor: AtlasRect;
  entranceSurround: AtlasRect;
  /** Crate art a dungeon chest renders as. OPTIONAL: a sheet without it falls back to the chest
   * glyph. Parsed only when present. */
  waresCrate?: AtlasRect;
}

export const ATLAS_URL = '/playfield/atlas-unified.json';
export const ACTOR_ATLAS_URL = '/playfield/atlas-actors.json';
export const ITEM_ATLAS_URL = '/playfield/atlas-items.json';

const IMAGE_BASE_URL = '/playfield/';

/** A contentId-keyed sprite sheet: the hero/NPC/monster actors (`atlas-actors.json`) or the floor/
 * pack items (`atlas-items.json`). Each key is a content id (or a `GENERIC-*`/`GOLD-*` fallback slot
 * the renderer maps categories onto); the value is the measured crop on `imageUrl`. */
export interface SpriteAtlas {
  imageUrl: string;
  sprites: Readonly<Record<string, AtlasRect>>;
}

function fail(field: string): never {
  throw new Error(`playfield atlas malformed: ${field}`);
}

function toRect(value: unknown, field: string): AtlasRect {
  if (!Array.isArray(value) || value.length !== 4) {
    fail(field);
  }
  const [x, y, w, h] = value as unknown[];
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof w !== 'number' ||
    typeof h !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h)
  ) {
    fail(field);
  }
  return { x, y, w, h };
}

function toRectList(value: unknown, field: string): AtlasRect[] {
  if (!Array.isArray(value)) {
    fail(field);
  }
  return value.map((entry, index) => toRect(entry, `${field}[${index}]`));
}

function toFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(field);
  }
  return value;
}

function toNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(field);
  }
  return value;
}

export function parseAtlas(json: unknown): PlayfieldAtlas {
  if (typeof json !== 'object' || json === null) {
    fail('root');
  }
  const record = json as Record<string, unknown>;

  const image = toNonEmptyString(record.image, 'image');
  const blockDepthPx = toFiniteNumber(record.blockDepthPx, 'blockDepthPx');
  const floors = toRectList(record.floors, 'floors');
  const dirty = toRectList(record.dirty, 'dirty');
  const walls = toRectList(record.walls, 'walls');
  const rounded = toRectList(record.rounded, 'rounded');
  const weaveWalls = toRectList(record.weaveWalls, 'weaveWalls');
  const stairs = toRect(record.stairs, 'stairs');
  const stairsUp = toRect(record.stairsUp, 'stairsUp');
  const door = toRect(record.door, 'door');
  const gate = toRect(record.gate, 'gate');
  // Optional: present in future sheets that ship open-door art; absent today.
  const archOpen = record.archOpen === undefined ? undefined : toRect(record.archOpen, 'archOpen');
  const torch = toRect(record.torch, 'torch');
  const torchWall = toRect(record.torchWall, 'torchWall');
  const pillar = toRect(record.pillar, 'pillar');
  const pillarBroken = toRect(record.pillarBroken, 'pillarBroken');
  const townFloors = toRectList(record.townFloors, 'townFloors');
  const townWalls = toRectList(record.townWalls, 'townWalls');
  const houseDoor = toRect(record.houseDoor, 'houseDoor');
  const entranceSurround = toRect(record.entranceSurround, 'entranceSurround');
  // Optional: a sheet without crate art leaves the chest on its glyph.
  const waresCrate =
    record.waresCrate === undefined ? undefined : toRect(record.waresCrate, 'waresCrate');

  return {
    imageUrl: `${IMAGE_BASE_URL}${image}`,
    blockDepthPx,
    floors,
    dirty,
    walls,
    rounded,
    weaveWalls,
    stairs,
    stairsUp,
    door,
    gate,
    ...(archOpen === undefined ? {} : { archOpen }),
    torch,
    torchWall,
    pillar,
    pillarBroken,
    townFloors,
    townWalls,
    houseDoor,
    entranceSurround,
    ...(waresCrate === undefined ? {} : { waresCrate }),
  };
}

/** Parse a contentId-keyed sprite atlas (`recordKey` is `'actors'` or `'items'`). Fail-loud like
 * `parseAtlas`: a non-object root, a missing/empty `image`, a missing record, or any malformed rect
 * throws rather than silently yielding an empty sheet. */
function parseSpriteAtlas(json: unknown, recordKey: string): SpriteAtlas {
  if (typeof json !== 'object' || json === null) {
    fail('root');
  }
  const record = json as Record<string, unknown>;
  const image = toNonEmptyString(record.image, 'image');
  const raw = record[recordKey];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(recordKey);
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    fail(recordKey);
  }
  const sprites: Record<string, AtlasRect> = {};
  for (const [contentId, value] of entries) {
    sprites[contentId] = toRect(value, `${recordKey}.${contentId}`);
  }
  return { imageUrl: `${IMAGE_BASE_URL}${image}`, sprites };
}

export function parseActorAtlas(json: unknown): SpriteAtlas {
  return parseSpriteAtlas(json, 'actors');
}

export function parseItemAtlas(json: unknown): SpriteAtlas {
  return parseSpriteAtlas(json, 'items');
}
