import type { VaultContentEntry } from '@woven-deep/content';
import { analyzeConnectivity } from './connectivity.js';
import { createFallbackTopology } from './fallback-floor.js';
import { generateTopologyAttempt, validateTopologyRequest } from './generate-topology.js';
import {
  GenerationError,
  type GenerateTopologyRequest,
  type GenerationRejectionCode,
  type GenerationReport,
  type TopologyDraft,
} from './generation-model.js';
import { createUnknownKnowledge } from './knowledge.js';
import type { FloorSnapshot } from './model.js';
import { placeVaults } from './vault-placement.js';

export interface GenerateFloorRequest extends GenerateTopologyRequest {
  readonly vaults: readonly VaultContentEntry[];
  readonly requiredVaultId?: string;
  readonly vaultTags?: readonly string[];
}

export interface GeneratedFloor {
  readonly floor: FloorSnapshot;
  readonly report: GenerationReport;
}

function increment(
  counts: Partial<Record<GenerationRejectionCode, number>>,
  code: GenerationRejectionCode,
): void {
  counts[code] = (counts[code] ?? 0) + 1;
}

function generatedReport(
  topology: TopologyDraft,
  tiles: FloorSnapshot['tiles'],
  vaults: FloorSnapshot['vaults'],
  rejectionCounts: Readonly<Partial<Record<GenerationRejectionCode, number>>>,
): GenerationReport {
  const connectivity = analyzeConnectivity({
    width: topology.width, height: topology.height, tiles,
    start: topology.stairUp, target: topology.stairDown,
  });
  if (!connectivity.connected || connectivity.distance === null) {
    throw new GenerationError('generation.fallback-invariant', 'complete generated floor is disconnected');
  }
  return {
    ...topology.report,
    vaults: vaults.map((vault) => ({
      vaultId: vault.vaultId, rotation: vault.rotation, reflected: vault.reflected,
    })),
    stairDistance: connectivity.distance,
    traversableCellCount: connectivity.traversableCellCount,
    rejectionCounts: { ...rejectionCounts },
  };
}

function floorSnapshot(
  request: GenerateFloorRequest,
  topology: TopologyDraft,
  placement: Extract<ReturnType<typeof placeVaults>, { ok: true }>,
): FloorSnapshot {
  return {
    floorId: topology.floorId,
    seed: [...topology.floorSeed] as [number, number, number, number],
    generatorVersion: 2,
    width: topology.width,
    height: topology.height,
    depth: topology.depth,
    tiles: placement.tiles,
    entities: [],
    themeId: topology.themeId,
    ambient: { color: [...request.theme.ambient.color] as [number, number, number], strength: request.theme.ambient.strength },
    knowledge: createUnknownKnowledge(topology.width * topology.height),
    lights: placement.lights,
    stairUp: { ...topology.stairUp },
    stairDown: { ...topology.stairDown },
    vaults: placement.vaults,
    placementSlots: placement.placementSlots,
  };
}

function fallbackDraft(
  request: GenerateFloorRequest,
  rejectionCounts: Readonly<Partial<Record<GenerationRejectionCode, number>>>,
): TopologyDraft {
  const fallback = createFallbackTopology(
    request.width, request.height, request.theme.maskWords, request.theme.minimumStairDistance,
  );
  const connectivity = analyzeConnectivity({
    width: request.width, height: request.height, tiles: fallback.tiles,
    start: fallback.stairUp, target: fallback.stairDown,
  });
  if (!connectivity.connected || connectivity.distance === null
    || connectivity.distance < request.theme.minimumStairDistance
    || fallback.tiles[fallback.stairUp.y * request.width + fallback.stairUp.x] !== 4
    || fallback.tiles[fallback.stairDown.y * request.width + fallback.stairDown.x] !== 5) {
    throw new GenerationError('generation.fallback-invariant', 'deterministic fallback failed complete validation');
  }
  const report: GenerationReport = {
    generatorVersion: 2, attempt: null, fallback: true,
    roomCount: fallback.rooms.length, corridorCount: fallback.corridors.length, vaults: [],
    stairUp: fallback.stairUp, stairDown: fallback.stairDown, stairDistance: connectivity.distance,
    traversableCellCount: connectivity.traversableCellCount, connected: true,
    rejectionCounts: { ...rejectionCounts },
  };
  return {
    floorId: request.floorId, floorSeed: [...request.floorSeed] as [number, number, number, number],
    depth: request.depth, themeId: request.theme.themeId, width: request.width, height: request.height,
    tiles: fallback.tiles, rooms: fallback.rooms, corridors: fallback.corridors,
    stairUp: fallback.stairUp, stairDown: fallback.stairDown,
    vaultState: request.floorSeed,
    report,
  };
}

export function generateFloor(request: GenerateFloorRequest): GeneratedFloor {
  const attemptLimit = validateTopologyRequest(request);
  if (!Array.isArray(request.vaults)) {
    throw new GenerationError('generation.invalid-request', 'vaults must be a dense array');
  }
  const rejectionCounts: Partial<Record<GenerationRejectionCode, number>> = {};
  const factory = request.topologyFactory ?? generateTopologyAttempt;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const topology = factory(request, attempt);
    if (!topology.ok) { increment(rejectionCounts, topology.code); continue; }
    const placement = placeVaults(topology.draft, request.vaults, {
      ...(request.requiredVaultId === undefined ? {} : { requiredVaultId: request.requiredVaultId }),
      ...(request.vaultTags === undefined ? {} : { vaultTags: request.vaultTags }),
    });
    if (!placement.ok) { increment(rejectionCounts, placement.code); continue; }
    const floor = floorSnapshot(request, topology.draft, placement);
    return { floor, report: generatedReport(topology.draft, floor.tiles, floor.vaults, rejectionCounts) };
  }
  const topology = fallbackDraft(request, rejectionCounts);
  const placement = { ok: true as const, tiles: topology.tiles, vaults: [], lights: [], placementSlots: [] };
  const floor = floorSnapshot(request, topology, placement);
  return { floor, report: topology.report };
}
