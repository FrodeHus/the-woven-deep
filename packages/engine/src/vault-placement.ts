import type { VaultContentEntry } from '@woven-deep/content';
import { analyzeConnectivity } from './connectivity.js';
import type { GenerationRejectionCode, RoomBounds, TopologyDraft } from './generation-model.js';
import type { LightSource } from './light-model.js';
import {
  assertOpaqueId,
  type FloorPlacementSlot,
  type OpaqueId,
  type TileId,
  type Uint32State,
  type VaultPlacement,
} from './model.js';
import { nextUint32 } from './random.js';
import { tileDefinition, TILE_DEFINITIONS } from './terrain.js';
import { vaultTransforms, type TransformedVault } from './vault-transform.js';

export interface VaultPlacementOptions {
  readonly requiredVaultId?: OpaqueId;
  readonly vaultTags?: readonly string[];
}

export type VaultPlacementResult =
  | {
    readonly ok: true;
    readonly tiles: readonly TileId[];
    readonly vaults: readonly VaultPlacement[];
    readonly lights: readonly LightSource[];
    readonly placementSlots: readonly FloorPlacementSlot[];
  }
  | { readonly ok: false; readonly code: Extract<GenerationRejectionCode, `vault.${string}`> };

interface Candidate {
  readonly template: VaultContentEntry;
  readonly transformed: TransformedVault;
  readonly room: RoomBounds;
  readonly x: number;
  readonly y: number;
  readonly key: string;
}

const TERRAIN_IDS = Object.fromEntries(TILE_DEFINITIONS.map((definition) => [definition.name, definition.id])) as
  Readonly<Record<(typeof TILE_DEFINITIONS)[number]['name'], TileId>>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function overlaps(candidate: Pick<Candidate, 'x' | 'y' | 'transformed'>, placed: VaultPlacement): boolean {
  return candidate.x < placed.x + placed.width && placed.x < candidate.x + candidate.transformed.width
    && candidate.y < placed.y + placed.height && placed.y < candidate.y + candidate.transformed.height;
}

function pointOutside(candidate: Candidate, x: number, y: number): boolean {
  return x < candidate.x || x >= candidate.x + candidate.transformed.width
    || y < candidate.y || y >= candidate.y + candidate.transformed.height;
}

function hasExternalEntranceConnection(topology: TopologyDraft, candidate: Candidate): boolean {
  return candidate.transformed.entrances.every((entrance) => {
    const x = candidate.x + entrance.x;
    const y = candidate.y + entrance.y;
    if (entrance.x !== 0 && entrance.y !== 0
      && entrance.x !== candidate.transformed.width - 1 && entrance.y !== candidate.transformed.height - 1) return false;
    return [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]].some(([nextX, nextY]) => {
      if (!pointOutside(candidate, nextX!, nextY!)
        || nextX! < 0 || nextY! < 0 || nextX! >= topology.width || nextY! >= topology.height) return false;
      return tileDefinition(topology.tiles[nextY! * topology.width + nextX!]!).potentiallyTraversable;
    });
  });
}

function candidates(
  topology: TopologyDraft,
  template: VaultContentEntry,
  placed: readonly VaultPlacement[],
  rejected: ReadonlySet<string>,
): Candidate[] {
  const result: Candidate[] = [];
  const rooms = [...topology.rooms].sort((left, right) => compareText(left.roomId, right.roomId));
  for (const room of rooms) for (const transformed of vaultTransforms(template)) {
    const minimumX = room.left + template.margin;
    const minimumY = room.top + template.margin;
    const maximumX = room.right - template.margin - transformed.width + 1;
    const maximumY = room.bottom - template.margin - transformed.height + 1;
    for (let y = minimumY; y <= maximumY; y += 1) for (let x = minimumX; x <= maximumX; x += 1) {
      const key = `${template.id}\0${room.roomId}\0${transformed.rotation}\0${Number(transformed.reflected)}\0${y}\0${x}`;
      if (rejected.has(key)) continue;
      const candidate: Candidate = { template, transformed, room, x, y, key };
      if (placed.some((entry) => overlaps(candidate, entry))) continue;
      let eligible = true;
      for (const cell of transformed.cells) {
        const globalX = x + cell.x; const globalY = y + cell.y;
        const index = globalY * topology.width + globalX;
        if (topology.tiles[index] === 6
          || (globalX === topology.stairUp.x && globalY === topology.stairUp.y)
          || (globalX === topology.stairDown.x && globalY === topology.stairDown.y)) eligible = false;
      }
      if (eligible && hasExternalEntranceConnection(topology, candidate)) result.push(candidate);
    }
  }
  return result;
}

function floorSuffix(floorId: string): string {
  return floorId.startsWith('floor.') ? floorId.slice('floor.'.length) : floorId;
}

function draftCandidate(
  topology: TopologyDraft,
  candidate: Candidate,
  ordinal: number,
  currentTiles: readonly TileId[],
): Extract<VaultPlacementResult, { ok: true }> | null {
  const suffix = floorSuffix(topology.floorId);
  const placementId = `vault-placement.${suffix}.${ordinal}`;
  assertOpaqueId(placementId, 'vault placementId');
  const tiles = [...currentTiles];
  for (const cell of candidate.transformed.cells) {
    tiles[(candidate.y + cell.y) * topology.width + candidate.x + cell.x] = TERRAIN_IDS[cell.terrain];
  }
  const vault: VaultPlacement = {
    placementId, vaultId: candidate.template.id, x: candidate.x, y: candidate.y,
    width: candidate.transformed.width, height: candidate.transformed.height,
    rotation: candidate.transformed.rotation, reflected: candidate.transformed.reflected,
    entrances: candidate.transformed.entrances.map(({ x, y }) => ({ x: candidate.x + x, y: candidate.y + y })),
  };
  const lights = candidate.transformed.fixtures.map(({ x, y, fixture }): LightSource => {
    const lightId = `light.${suffix}.${ordinal}.${fixture.idSuffix}`;
    assertOpaqueId(lightId, 'vault lightId');
    return {
      lightId, location: { type: 'fixed', x: candidate.x + x, y: candidate.y + y },
      color: [...fixture.color] as [number, number, number], radius: fixture.radius,
      strength: fixture.strength, enabled: fixture.enabled, falloff: 'linear', vaultPlacementId: placementId,
      presentation: { glyph: fixture.glyph, token: fixture.presentationToken },
    };
  });
  const placementSlots = candidate.transformed.slots.map(({ x, y, slot }): FloorPlacementSlot => {
    const slotId = `slot.${suffix}.${ordinal}.${slot.id}`;
    assertOpaqueId(slotId, 'vault slotId');
    return {
      slotId, vaultPlacementId: placementId, kind: slot.kind, required: slot.required,
      tags: [...slot.tags], x: candidate.x + x, y: candidate.y + y,
    };
  });
  const connectivity = analyzeConnectivity({
    width: topology.width, height: topology.height, tiles,
    start: topology.stairUp, target: topology.stairDown,
  });
  if (!connectivity.connected || connectivity.distance === null) return null;
  const reachable = (point: Readonly<{ x: number; y: number }>): boolean => {
    const index = point.y * topology.width + point.x;
    return tileDefinition(tiles[index]!).potentiallyTraversable
      && ((connectivity.visitedWords[index >>> 5]! >>> (index & 31)) & 1) === 1;
  };
  if (!vault.entrances.every(reachable) || !placementSlots.filter((slot) => slot.required).every(reachable)) return null;
  return { ok: true, tiles, vaults: [vault], lights, placementSlots };
}

function chooseWeighted(templates: readonly VaultContentEntry[], state: Uint32State): readonly [VaultContentEntry, Uint32State] {
  const step = nextUint32(state);
  const total = templates.reduce((sum, template) => sum + BigInt(template.weight), 0n);
  let draw = (BigInt(step.value) * total) / 0x1_0000_0000n;
  for (const template of templates) {
    const weight = BigInt(template.weight);
    if (draw < weight) return [template, step.state];
    draw -= weight;
  }
  return [templates.at(-1)!, step.state];
}

function chooseCandidate(values: readonly Candidate[], state: Uint32State): readonly [Candidate, Uint32State] {
  const step = nextUint32(state);
  return [values[step.value % values.length]!, step.state];
}

export function placeVaults(
  topology: TopologyDraft,
  vaults: readonly VaultContentEntry[],
  options: VaultPlacementOptions = {},
): VaultPlacementResult {
  const eligible = [...vaults].filter((vault) => topology.depth >= vault.minDepth && topology.depth <= vault.maxDepth
    && (options.vaultTags ?? []).every((tag) => vault.tags.includes(tag)))
    .sort((left, right) => compareText(left.id, right.id));
  const required = options.requiredVaultId === undefined
    ? undefined : eligible.find((vault) => vault.id === options.requiredVaultId);
  if (options.requiredVaultId !== undefined && !required) return { ok: false, code: 'vault.required-unavailable' };
  const placed: VaultPlacement[] = [];
  const lights: LightSource[] = [];
  const placementSlots: FloorPlacementSlot[] = [];
  const counts = new Map<string, number>();
  const rejected = new Set<string>();
  let tiles = topology.tiles;
  let state = topology.vaultState;

  const attemptTemplate = (template: VaultContentEntry): boolean => {
    while ((counts.get(template.id) ?? 0) < template.maxPerFloor) {
      const available = candidates({ ...topology, tiles }, template, placed, rejected);
      if (available.length === 0) return false;
      const selected = chooseCandidate(available, state); state = selected[1];
      const candidate = selected[0];
      const draft = draftCandidate(topology, candidate, placed.length, tiles);
      if (!draft) { rejected.add(candidate.key); continue; }
      tiles = draft.tiles;
      placed.push(...draft.vaults); lights.push(...draft.lights); placementSlots.push(...draft.placementSlots);
      counts.set(template.id, (counts.get(template.id) ?? 0) + 1);
      return true;
    }
    return false;
  };

  if (required && !attemptTemplate(required)) return { ok: false, code: 'vault.no-valid-placement' };
  while (true) {
    const availableTemplates = eligible.filter((template) => (counts.get(template.id) ?? 0) < template.maxPerFloor
      && candidates({ ...topology, tiles }, template, placed, rejected).length > 0);
    if (availableTemplates.length === 0) break;
    const selected = chooseWeighted(availableTemplates, state); state = selected[1];
    if (!attemptTemplate(selected[0])) continue;
  }
  return {
    ok: true,
    tiles,
    vaults: placed.sort((left, right) => compareText(left.placementId, right.placementId)),
    lights: lights.sort((left, right) => compareText(left.lightId, right.lightId)),
    placementSlots: placementSlots.sort((left, right) => compareText(left.slotId, right.slotId)),
  };
}
