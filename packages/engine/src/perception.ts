import type { FloorKnowledge } from './knowledge.js';
import { rememberTiles, validateKnowledgePacking } from './knowledge.js';
import type { AmbientLight, IlluminationField, LightSource } from './light-model.js';
import { computeIllumination } from './lighting.js';
import { assertOpaqueId, type OpaqueId, type TileId } from './model.js';
import { computeFieldOfView, isVisible } from './visibility.js';

export interface PerceptionFloor {
  readonly floorId: OpaqueId;
  readonly depth: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly ambient: AmbientLight;
  readonly lights: readonly LightSource[];
  readonly knowledge: FloorKnowledge;
}

export interface PerceptionHero {
  readonly heroId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly sightRadius: number;
}

export interface RefreshKnowledgeInput {
  readonly floor: PerceptionFloor;
  readonly hero: PerceptionHero;
  readonly actors: ReadonlyMap<OpaqueId, Readonly<{ x: number; y: number }>>;
  readonly additionalLights?: readonly LightSource[];
  /**
   * The `trait.dungeon-sense`-style knob: when `commitsMemory` is true and the hero's own cell
   * is dark, the hero's light-out bubble (Chebyshev `revealRadius` around the hero) is committed
   * to `FloorKnowledge` as terrain, in addition to the normal illumination-gated commit. Omit
   * (or leave `commitsMemory` false) to leave the commit path exactly as before.
   */
  readonly lightOutMemory?: Readonly<{ commitsMemory: boolean; revealRadius: number }>;
}

export interface RefreshedPerception {
  readonly knowledge: FloorKnowledge;
  readonly visibilityWords: readonly number[];
  readonly illumination: IlluminationField;
}

export function isPerceivedCell(
  visibilityWords: readonly number[],
  illumination: Readonly<{ intensity: readonly number[] }>,
  index: number,
): boolean {
  return isVisible(visibilityWords, index) && (illumination.intensity[index] ?? 0) > 0;
}

export function refreshKnowledge(input: RefreshKnowledgeInput): RefreshedPerception {
  assertOpaqueId(input.floor.floorId, 'floorId');
  assertOpaqueId(input.hero.heroId, 'heroId');
  if (!Number.isSafeInteger(input.hero.sightRadius) || input.hero.sightRadius < 0) {
    throw new RangeError('hero sight radius must be a nonnegative safe integer');
  }

  const illumination = computeIllumination({
    width: input.floor.width,
    height: input.floor.height,
    tiles: input.floor.tiles,
    ambient: input.floor.ambient,
    lights: [...input.floor.lights, ...(input.additionalLights ?? [])],
    actors: input.actors,
  });
  const cellCount = input.floor.width * input.floor.height;
  validateKnowledgePacking(input.floor.knowledge, cellCount);
  const visibilityWords = computeFieldOfView({
    width: input.floor.width,
    height: input.floor.height,
    tiles: input.floor.tiles,
    origin: { x: input.hero.x, y: input.hero.y },
    radius: input.hero.sightRadius,
  });
  const observed: { index: number; tile: TileId }[] = [];
  const observedIndexes = new Set<number>();

  for (let index = 0; index < cellCount; index += 1) {
    if (isPerceivedCell(visibilityWords, illumination, index)) {
      observed.push({ index, tile: input.floor.tiles[index]! });
      observedIndexes.add(index);
    }
  }

  if (input.lightOutMemory?.commitsMemory) {
    const heroIndex = input.hero.y * input.floor.width + input.hero.x;
    const heroInDark = (illumination.intensity[heroIndex] ?? 0) <= 0;
    if (heroInDark) {
      for (let index = 0; index < cellCount; index += 1) {
        if (observedIndexes.has(index)) continue;
        const x = index % input.floor.width;
        const y = Math.floor(index / input.floor.width);
        const distance = Math.max(Math.abs(x - input.hero.x), Math.abs(y - input.hero.y));
        if (distance <= input.lightOutMemory.revealRadius) {
          observed.push({ index, tile: input.floor.tiles[index]! });
          observedIndexes.add(index);
        }
      }
    }
  }

  return {
    knowledge: rememberTiles(input.floor.knowledge, cellCount, observed),
    visibilityWords,
    illumination,
  };
}
