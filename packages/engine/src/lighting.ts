import type { AmbientLight, IlluminationField, LightSource, RgbColor } from './light-model.js';
import { assertOpaqueId, type OpaqueId, type TileId } from './model.js';
import { computeFieldOfView, isVisible } from './visibility.js';

export interface IlluminationInput {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly ambient: AmbientLight;
  readonly lights: readonly LightSource[];
  readonly actors: ReadonlyMap<OpaqueId, Readonly<{ x: number; y: number }>>;
}

interface ResolvedLight {
  readonly source: LightSource;
  readonly x: number;
  readonly y: number;
}

const TILE_ID_MAX = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertPositiveDimension(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function assertIntegerRange(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be a safe integer from ${minimum} through ${maximum}`);
  }
}

function validateColor(value: unknown, label: string): asserts value is RgbColor {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} must contain exactly three channels`);
  }
  for (let channel = 0; channel < 3; channel += 1) {
    assertIntegerRange(value[channel], 0, 255, `${label} channel ${channel}`);
  }
}

function validateTiles(input: IlluminationInput): number {
  assertPositiveDimension(input.width, 'field width');
  assertPositiveDimension(input.height, 'field height');
  const cellCount = input.width * input.height;
  if (!Number.isSafeInteger(cellCount)) throw new RangeError('field cell count must be a safe integer');
  if (!Array.isArray(input.tiles) || input.tiles.length !== cellCount) {
    throw new RangeError(`tile length must be ${cellCount}`);
  }
  for (let index = 0; index < cellCount; index += 1) {
    const tile = input.tiles[index];
    if (!Number.isInteger(tile) || (tile as number) < 0 || (tile as number) > TILE_ID_MAX) {
      throw new TypeError(`tile ${index} must be a valid tile ID`);
    }
  }
  return cellCount;
}

function validateAmbient(value: unknown): asserts value is AmbientLight {
  if (!isRecord(value)) throw new TypeError('ambient light must be an object');
  validateColor(value.color, 'ambient color');
  assertIntegerRange(value.strength, 0, 255, 'ambient strength');
}

function validatePresentation(source: Record<string, unknown>, label: string): void {
  const owner = source.vaultPlacementId;
  const presentation = source.presentation;
  if (owner !== null) assertOpaqueId(owner, `${label} vaultPlacementId`);
  if (presentation !== null) {
    if (!isRecord(presentation)) throw new TypeError(`${label} presentation must be an object or null`);
    if (typeof presentation.glyph !== 'string' || [...presentation.glyph].length !== 1) {
      throw new TypeError(`${label} presentation glyph must be one Unicode glyph`);
    }
    assertOpaqueId(presentation.token, `${label} presentation token`);
  }
}

function resolveLocation(
  input: IlluminationInput,
  source: Record<string, unknown>,
  label: string,
): Readonly<{ x: number; y: number }> {
  if (!isRecord(source.location)) throw new TypeError(`${label} location must be an object`);
  const location = source.location;
  if (location.type === 'fixed') {
    if (!Number.isSafeInteger(location.x) || !Number.isSafeInteger(location.y)
      || (location.x as number) < 0 || (location.x as number) >= input.width
      || (location.y as number) < 0 || (location.y as number) >= input.height) {
      throw new RangeError(`${label} location must be an integer point within the field`);
    }
    const x = location.x as number;
    const y = location.y as number;
    if (input.tiles[y * input.width + x] === 6) throw new RangeError(`${label} location cannot be void`);
    if (source.vaultPlacementId !== null && source.presentation === null) {
      throw new TypeError(`${label} vaultPlacementId requires presentation`);
    }
    return { x, y };
  }
  if (location.type === 'actor') {
    assertOpaqueId(location.actorId, `${label} actorId`);
    if (source.vaultPlacementId !== null) throw new TypeError(`${label} actor location cannot have vaultPlacementId`);
    if (source.presentation !== null) throw new TypeError(`${label} actor location cannot have presentation`);
    const point = input.actors.get(location.actorId);
    if (!point) throw new RangeError(`${label} cannot resolve actor ${location.actorId}`);
    if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)
      || point.x < 0 || point.x >= input.width || point.y < 0 || point.y >= input.height) {
      throw new RangeError(`${label} actor ${location.actorId} must be at an integer point within the field`);
    }
    return { x: point.x, y: point.y };
  }
  throw new TypeError(`${label} location type must be fixed or actor`);
}

function validateLights(input: IlluminationInput): readonly ResolvedLight[] {
  if (!Array.isArray(input.lights)) throw new TypeError('lights must be an array');
  const records: Record<string, unknown>[] = [];
  for (let index = 0; index < input.lights.length; index += 1) {
    const source = input.lights[index];
    if (!isRecord(source)) throw new TypeError('light source must be an object');
    records.push(source);
  }
  for (const source of records) assertOpaqueId(source.lightId, 'lightId');
  records.sort((left, right) => {
    const leftId = left.lightId as string;
    const rightId = right.lightId as string;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  for (let index = 1; index < records.length; index += 1) {
    const lightId = records[index]!.lightId as string;
    if (lightId === records[index - 1]!.lightId) throw new TypeError(`duplicate light ID ${lightId}`);
  }

  const resolved: ResolvedLight[] = [];
  for (const source of records) {
    const lightId = source.lightId as string;
    const label = `light ${lightId}`;
    validateColor(source.color, `${label} color`);
    assertIntegerRange(source.radius, 1, 32, `${label} radius`);
    assertIntegerRange(source.strength, 1, 255, `${label} strength`);
    if (typeof source.enabled !== 'boolean') throw new TypeError(`${label} enabled must be boolean`);
    if (source.falloff !== 'linear') throw new TypeError(`${label} falloff must be linear`);
    if (source.vaultPlacementId !== null && source.vaultPlacementId === undefined) {
      throw new TypeError(`${label} vaultPlacementId must be an opaque ID or null`);
    }
    if (source.presentation !== null && source.presentation === undefined) {
      throw new TypeError(`${label} presentation must be an object or null`);
    }
    validatePresentation(source, label);
    const point = resolveLocation(input, source, label);
    resolved.push({ source: source as unknown as LightSource, x: point.x, y: point.y });
  }
  return resolved;
}

function ambientChannel(channel: number, strength: number): number {
  return Math.floor(channel * strength / 255);
}

export function computeIllumination(input: IlluminationInput): IlluminationField {
  const cellCount = validateTiles(input);
  validateAmbient(input.ambient);
  if (!input.actors || typeof input.actors.get !== 'function') throw new TypeError('actors must be a read-only map');
  const lights = validateLights(input);
  const red = Array<number>(cellCount).fill(ambientChannel(input.ambient.color[0], input.ambient.strength));
  const green = Array<number>(cellCount).fill(ambientChannel(input.ambient.color[1], input.ambient.strength));
  const blue = Array<number>(cellCount).fill(ambientChannel(input.ambient.color[2], input.ambient.strength));

  for (const light of lights) {
    const source = light.source;
    if (!source.enabled) continue;
    const visible = computeFieldOfView({
      width: input.width,
      height: input.height,
      tiles: input.tiles,
      origin: { x: light.x, y: light.y },
      radius: source.radius,
    });
    for (let index = 0; index < cellCount; index += 1) {
      if (!isVisible(visible, index)) continue;
      const x = index % input.width;
      const y = Math.floor(index / input.width);
      const distance = Math.ceil(Math.sqrt((x - light.x) ** 2 + (y - light.y) ** 2));
      if (distance > source.radius) continue;
      const scalar = Math.floor(source.strength * (source.radius + 1 - distance) / (source.radius + 1));
      red[index] = Math.min(255, red[index]! + Math.floor(source.color[0] * scalar / 255));
      green[index] = Math.min(255, green[index]! + Math.floor(source.color[1] * scalar / 255));
      blue[index] = Math.min(255, blue[index]! + Math.floor(source.color[2] * scalar / 255));
    }
  }

  const intensity = red.map((value, index) => Math.max(value, green[index]!, blue[index]!));
  return { red, green, blue, intensity };
}
