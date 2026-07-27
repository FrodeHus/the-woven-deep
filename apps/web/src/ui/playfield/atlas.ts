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
  door: AtlasRect;
  gate: AtlasRect;
  torch: AtlasRect;
  torchWall: AtlasRect;
  pillar: AtlasRect;
  pillarBroken: AtlasRect;
}

export const ATLAS_URL = '/playfield/atlas-dungeon.json';

const IMAGE_BASE_URL = '/playfield/';

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
  const door = toRect(record.door, 'door');
  const gate = toRect(record.gate, 'gate');
  const torch = toRect(record.torch, 'torch');
  const torchWall = toRect(record.torchWall, 'torchWall');
  const pillar = toRect(record.pillar, 'pillar');
  const pillarBroken = toRect(record.pillarBroken, 'pillarBroken');

  return {
    imageUrl: `${IMAGE_BASE_URL}${image}`,
    blockDepthPx,
    floors,
    dirty,
    walls,
    rounded,
    weaveWalls,
    stairs,
    door,
    gate,
    torch,
    torchWall,
    pillar,
    pillarBroken,
  };
}
