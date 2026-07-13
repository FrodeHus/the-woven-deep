import { isExplored, rememberedTile, validateKnowledgePacking } from './knowledge.js';
import type { IlluminationField, RgbColor } from './light-model.js';
import { computeIllumination } from './lighting.js';
import { assertOpaqueId, type OpaqueId, type TileId } from './model.js';
import type { PerceptionFloor, PerceptionHero } from './perception.js';
import { tileDefinition } from './terrain.js';
import { computeFieldOfView, isVisible } from './visibility.js';

export type KnowledgeState = 'unknown' | 'remembered' | 'visible';

export interface ObservableCell {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly knowledge: KnowledgeState;
  readonly tileId?: TileId;
  readonly glyph?: string;
  readonly token?: string;
  readonly intensity: number;
  readonly tint?: RgbColor;
  readonly previewIntensity?: number;
  readonly fixture?: Readonly<{
    lightId: OpaqueId;
    glyph: string;
    token: OpaqueId;
  }>;
}

export interface ObservableFloorProjection {
  readonly floorId: OpaqueId;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly ObservableCell[];
}

export interface LightPreview {
  readonly color: RgbColor;
  readonly radius: number;
  readonly strength: number;
  readonly falloff: 'linear';
}

export interface ProjectFloorInput {
  readonly floor: PerceptionFloor;
  readonly hero: PerceptionHero;
  readonly visibilityWords: readonly number[];
  readonly illumination: IlluminationField;
  readonly preview?: LightPreview;
}

interface FixturePresentation {
  readonly lightId: OpaqueId;
  readonly glyph: string;
  readonly token: OpaqueId;
}

const UNSIGNED_32_BIT_MAX = 0xffff_ffff;

function assertByte(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 255) {
    throw new RangeError(`${label} must be an integer from 0 through 255`);
  }
}

function validateColor(value: unknown, label: string): asserts value is RgbColor {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} must contain exactly three channels`);
  for (let channel = 0; channel < 3; channel += 1) assertByte(value[channel], `${label} channel ${channel}`);
}

function validateChannel(channel: readonly number[], cellCount: number, label: string): void {
  if (!Array.isArray(channel) || channel.length !== cellCount) {
    throw new RangeError(`${label} length must be ${cellCount}`);
  }
  for (let index = 0; index < cellCount; index += 1) assertByte(channel[index], `${label} ${index}`);
}

function validateVisibility(words: readonly number[], cellCount: number): void {
  const expectedLength = Math.ceil(cellCount / 32);
  if (!Array.isArray(words) || words.length !== expectedLength) {
    throw new RangeError(`visibility word length must be ${expectedLength}`);
  }
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!Number.isInteger(word) || (word as number) < 0 || (word as number) > UNSIGNED_32_BIT_MAX) {
      throw new TypeError(`visibility word ${index} must be an unsigned 32-bit integer`);
    }
  }
  const usedBits = cellCount % 32;
  if (usedBits !== 0 && ((words[words.length - 1]! >>> usedBits) !== 0)) {
    throw new TypeError('visibility word padding must be zero');
  }
}

function validateDerivedFields(input: ProjectFloorInput, expectedVisibility: readonly number[], cellCount: number): void {
  validateVisibility(input.visibilityWords, cellCount);
  for (let index = 0; index < expectedVisibility.length; index += 1) {
    if (input.visibilityWords[index] !== expectedVisibility[index]) {
      throw new TypeError('visibility words must match the hero field of view');
    }
  }
  validateChannel(input.illumination.red, cellCount, 'red');
  validateChannel(input.illumination.green, cellCount, 'green');
  validateChannel(input.illumination.blue, cellCount, 'blue');
  validateChannel(input.illumination.intensity, cellCount, 'intensity');
  for (let index = 0; index < cellCount; index += 1) {
    const expectedIntensity = Math.max(
      input.illumination.red[index]!,
      input.illumination.green[index]!,
      input.illumination.blue[index]!,
    );
    if (input.illumination.intensity[index] !== expectedIntensity) {
      throw new TypeError(`intensity ${index} must equal the maximum RGB channel`);
    }
  }
}

function validateRefreshedKnowledge(input: ProjectFloorInput, cellCount: number): void {
  for (let index = 0; index < cellCount; index += 1) {
    const currentlyVisible = isVisible(input.visibilityWords, index) && input.illumination.intensity[index]! > 0;
    if (!currentlyVisible) continue;
    if (!isExplored(input.floor.knowledge, index)
      || rememberedTile(input.floor.knowledge, index) !== input.floor.tiles[index]) {
      throw new TypeError(`visible cell ${index} must agree with refreshed knowledge`);
    }
  }
}

function collectFixtures(floor: PerceptionFloor): ReadonlyMap<number, FixturePresentation> {
  const presented = floor.lights
    .filter((light) => light.location.type === 'fixed' && light.presentation !== null)
    .slice()
    .sort((left, right) => left.lightId < right.lightId ? -1 : left.lightId > right.lightId ? 1 : 0);
  const fixtures = new Map<number, FixturePresentation>();

  for (const light of presented) {
    assertOpaqueId(light.lightId, 'fixture lightId');
    if (light.location.type !== 'fixed' || light.presentation === null) continue;
    const { x, y } = light.location;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
      || x < 0 || x >= floor.width || y < 0 || y >= floor.height) {
      throw new RangeError(`fixture ${light.lightId} location must be within the floor`);
    }
    if (typeof light.presentation.glyph !== 'string' || [...light.presentation.glyph].length !== 1) {
      throw new TypeError(`fixture ${light.lightId} glyph must be one Unicode glyph`);
    }
    assertOpaqueId(light.presentation.token, `fixture ${light.lightId} token`);
    const index = y * floor.width + x;
    if (fixtures.has(index)) throw new TypeError(`presented fixtures collide at cell ${index}`);
    fixtures.set(index, {
      lightId: light.lightId,
      glyph: light.presentation.glyph,
      token: light.presentation.token,
    });
  }
  return fixtures;
}

function computePreview(input: ProjectFloorInput): readonly number[] | undefined {
  if (input.preview === undefined) return undefined;
  validateColor(input.preview.color, 'preview color');
  const cellCount = input.floor.width * input.floor.height;
  const previewTiles: TileId[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const currentlyVisible = isVisible(input.visibilityWords, index) && input.illumination.intensity[index]! > 0;
    if (currentlyVisible) {
      previewTiles.push(input.floor.tiles[index]!);
      continue;
    }
    if (isExplored(input.floor.knowledge, index)) {
      const tileId = rememberedTile(input.floor.knowledge, index);
      if (tileId === undefined) throw new TypeError(`explored cell ${index} must have remembered terrain`);
      previewTiles.push(tileId);
      continue;
    }
    previewTiles.push(0);
  }
  const field = computeIllumination({
    width: input.floor.width,
    height: input.floor.height,
    tiles: previewTiles,
    ambient: { color: [0, 0, 0], strength: 0 },
    lights: [{
      lightId: 'preview.light',
      location: { type: 'fixed', x: input.hero.x, y: input.hero.y },
      color: input.preview.color,
      radius: input.preview.radius,
      strength: input.preview.strength,
      enabled: true,
      falloff: input.preview.falloff,
      vaultPlacementId: null,
      presentation: null,
    }],
    actors: new Map(),
  });
  return field.intensity;
}

export function projectFloor(input: ProjectFloorInput): ObservableFloorProjection {
  assertOpaqueId(input.floor.floorId, 'floorId');
  assertOpaqueId(input.hero.heroId, 'heroId');
  const cellCount = input.floor.width * input.floor.height;

  const expectedVisibility = computeFieldOfView({
    width: input.floor.width,
    height: input.floor.height,
    tiles: input.floor.tiles,
    origin: { x: input.hero.x, y: input.hero.y },
    radius: input.hero.sightRadius,
  });
  validateKnowledgePacking(input.floor.knowledge, cellCount);
  // RGB channels are the trusted refreshKnowledge output; projection can verify
  // their structure and derived intensities but cannot resolve actor lights itself.
  validateDerivedFields(input, expectedVisibility, cellCount);
  validateRefreshedKnowledge(input, cellCount);
  const fixtures = collectFixtures(input.floor);
  const previewIntensity = computePreview(input);
  const cells: ObservableCell[] = [];

  for (let index = 0; index < cellCount; index += 1) {
    const x = index % input.floor.width;
    const y = Math.floor(index / input.floor.width);
    const currentlyVisible = isVisible(input.visibilityWords, index) && input.illumination.intensity[index]! > 0;
    const explored = isExplored(input.floor.knowledge, index);

    if (!currentlyVisible && !explored) {
      cells.push({ index, x, y, knowledge: 'unknown', intensity: 0 });
      continue;
    }

    if (!currentlyVisible) {
      const tileId = rememberedTile(input.floor.knowledge, index)!;
      const terrain = tileDefinition(tileId);
      const cell: ObservableCell = {
        index, x, y, knowledge: 'remembered', tileId,
        glyph: terrain.glyph, token: terrain.token, intensity: 24,
      };
      const preview = previewIntensity?.[index];
      cells.push(preview !== undefined && preview > 0 ? { ...cell, previewIntensity: preview } : cell);
      continue;
    }

    const tileId = input.floor.tiles[index]!;
    const terrain = tileDefinition(tileId);
    const tint: RgbColor = [
      input.illumination.red[index]!,
      input.illumination.green[index]!,
      input.illumination.blue[index]!,
    ];
    const cell: ObservableCell = {
      index, x, y, knowledge: 'visible', tileId,
      glyph: terrain.glyph, token: terrain.token,
      intensity: input.illumination.intensity[index]!, tint,
    };
    const preview = previewIntensity?.[index];
    const withPreview: ObservableCell = preview !== undefined && preview > 0
      ? { ...cell, previewIntensity: preview }
      : cell;
    const fixture = fixtures.get(index);
    cells.push(fixture === undefined ? withPreview : {
      ...withPreview,
      fixture: { lightId: fixture.lightId, glyph: fixture.glyph, token: fixture.token },
    });
  }

  return { floorId: input.floor.floorId, width: input.floor.width, height: input.floor.height, cells };
}
