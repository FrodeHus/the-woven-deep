import type { TileId } from './model.js';

export interface FloorKnowledge {
  readonly exploredWords: readonly number[];
  readonly rememberedTerrainWords: readonly number[];
}

interface RememberedTile {
  readonly index: number;
  readonly tile: TileId;
}

export const UNKNOWN_TERRAIN_NIBBLE = 15;

const UNSIGNED_32_BIT_MAX = 0xffff_ffff;
const TILE_ID_MAX = 6;

function assertCellCount(cellCount: number): void {
  if (!Number.isSafeInteger(cellCount) || cellCount < 0) {
    throw new RangeError('cell count must be a nonnegative safe integer');
  }
}

function assertUnsignedWord(word: number, label: string): void {
  if (!Number.isInteger(word) || word < 0 || word > UNSIGNED_32_BIT_MAX) {
    throw new TypeError(`${label} must be an unsigned 32-bit integer`);
  }
}

function assertStorageIndex(index: number, capacity: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= capacity) {
    throw new RangeError('knowledge index must be a nonnegative safe integer within the packed storage');
  }
}

function assertTileId(tile: number): asserts tile is TileId {
  if (!Number.isInteger(tile) || tile < 0 || tile > TILE_ID_MAX) {
    throw new TypeError('remembered tile must be a valid tile ID');
  }
}

function lowBitMask(bitCount: number): number {
  return bitCount === 32 ? UNSIGNED_32_BIT_MAX : (2 ** bitCount - 1) >>> 0;
}

export const exploredWordCount = (cellCount: number): number => {
  assertCellCount(cellCount);
  return Math.ceil(cellCount / 32);
};

export const rememberedWordCount = (cellCount: number): number => {
  assertCellCount(cellCount);
  return Math.ceil(cellCount / 8);
};

export function createUnknownKnowledge(cellCount: number): FloorKnowledge {
  const exploredWords = Array<number>(exploredWordCount(cellCount)).fill(0);
  const rememberedTerrainWords = Array<number>(rememberedWordCount(cellCount)).fill(UNSIGNED_32_BIT_MAX);
  const valuesInLastWord = cellCount % 8;

  if (valuesInLastWord !== 0) {
    rememberedTerrainWords[rememberedTerrainWords.length - 1] = lowBitMask(valuesInLastWord * 4);
  }

  return { exploredWords, rememberedTerrainWords };
}

export function isExplored(knowledge: FloorKnowledge, index: number): boolean {
  assertStorageIndex(index, knowledge.exploredWords.length * 32);
  const word = knowledge.exploredWords[Math.floor(index / 32)]!;
  assertUnsignedWord(word, 'explored word');
  return ((word >>> (index % 32)) & 1) === 1;
}

export function rememberedTile(knowledge: FloorKnowledge, index: number): TileId | undefined {
  assertStorageIndex(index, knowledge.rememberedTerrainWords.length * 8);
  const word = knowledge.rememberedTerrainWords[Math.floor(index / 8)]!;
  assertUnsignedWord(word, 'remembered terrain word');
  const terrainValue = (word >>> ((index % 8) * 4)) & 0xf;

  if (terrainValue === UNKNOWN_TERRAIN_NIBBLE) {
    return undefined;
  }
  assertTileId(terrainValue);
  return terrainValue;
}

export function rememberTiles(
  knowledge: FloorKnowledge,
  cellCount: number,
  tiles: readonly RememberedTile[],
): FloorKnowledge {
  validateKnowledgePacking(knowledge, cellCount);

  const indexes = new Set<number>();
  for (const entry of tiles) {
    if (!Number.isSafeInteger(entry.index) || entry.index < 0 || entry.index >= cellCount) {
      throw new RangeError('remembered tile index must be a nonnegative safe integer within the floor');
    }
    assertTileId(entry.tile);
    if (indexes.has(entry.index)) {
      throw new TypeError('remembered tile indexes must be unique');
    }
    indexes.add(entry.index);
  }

  const exploredWords = [...knowledge.exploredWords];
  const rememberedTerrainWords = [...knowledge.rememberedTerrainWords];

  for (const entry of tiles) {
    const exploredWordIndex = Math.floor(entry.index / 32);
    exploredWords[exploredWordIndex] = (exploredWords[exploredWordIndex]! | (1 << (entry.index % 32))) >>> 0;

    const terrainWordIndex = Math.floor(entry.index / 8);
    const shift = (entry.index % 8) * 4;
    const clearTerrainValue = ~(0xf << shift);
    rememberedTerrainWords[terrainWordIndex] = (
      (rememberedTerrainWords[terrainWordIndex]! & clearTerrainValue) | (entry.tile << shift)
    ) >>> 0;
  }

  return { exploredWords, rememberedTerrainWords };
}

export function validateKnowledgePacking(knowledge: FloorKnowledge, cellCount: number): void {
  const expectedExploredWords = exploredWordCount(cellCount);
  const expectedRememberedWords = rememberedWordCount(cellCount);

  if (knowledge.exploredWords.length !== expectedExploredWords) {
    throw new RangeError(`explored word length must be ${expectedExploredWords}`);
  }
  if (knowledge.rememberedTerrainWords.length !== expectedRememberedWords) {
    throw new RangeError(`remembered terrain word length must be ${expectedRememberedWords}`);
  }

  knowledge.exploredWords.forEach((word, index) => assertUnsignedWord(word, `explored word ${index}`));
  knowledge.rememberedTerrainWords.forEach((word, index) => assertUnsignedWord(word, `remembered terrain word ${index}`));

  const exploredBitsInLastWord = cellCount % 32;
  if (exploredBitsInLastWord !== 0) {
    const lastWord = knowledge.exploredWords[knowledge.exploredWords.length - 1]!;
    if ((lastWord & ~lowBitMask(exploredBitsInLastWord)) !== 0) {
      throw new TypeError('explored word padding must be zero');
    }
  }

  const terrainValuesInLastWord = cellCount % 8;
  if (terrainValuesInLastWord !== 0) {
    const lastWord = knowledge.rememberedTerrainWords[knowledge.rememberedTerrainWords.length - 1]!;
    if ((lastWord & ~lowBitMask(terrainValuesInLastWord * 4)) !== 0) {
      throw new TypeError('remembered terrain word padding must be zero');
    }
  }

  for (let index = 0; index < cellCount; index += 1) {
    const exploredWord = knowledge.exploredWords[Math.floor(index / 32)]!;
    const terrainWord = knowledge.rememberedTerrainWords[Math.floor(index / 8)]!;
    const explored = ((exploredWord >>> (index % 32)) & 1) === 1;
    const terrainValue = (terrainWord >>> ((index % 8) * 4)) & 0xf;

    if (terrainValue !== UNKNOWN_TERRAIN_NIBBLE) {
      assertTileId(terrainValue);
    }
    if (explored !== (terrainValue !== UNKNOWN_TERRAIN_NIBBLE)) {
      throw new TypeError(`explored and remembered terrain values disagree at index ${index}`);
    }
  }
}
