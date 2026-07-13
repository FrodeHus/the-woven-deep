import type { CompiledContentPack, VaultContentEntry } from '@woven-deep/content';
import { addGeneratedFloor } from './floor-integration.js';
import { createDemoRun } from './fixture.js';
import { generateFloor, type GeneratedFloor } from './generate-floor.js';
import { createClassicTheme } from './generation-mask.js';
import type { FloorSeedAllocation } from './generation-model.js';
import { allocateFloorSeed } from './generation-random.js';
import type { LightSource } from './light-model.js';
import type { ActiveRun, FloorSnapshot } from './model.js';
import { heroActor } from './actor-model.js';
import { allocateIdentificationMap } from './identification.js';

export interface GeneratedDemoRun {
  readonly run: ActiveRun;
  readonly generated: GeneratedFloor;
  readonly allocation: FloorSeedAllocation;
}

const WIDTH = 80;
const HEIGHT = 25;

export function createGeneratedDemoRun(pack: CompiledContentPack): GeneratedDemoRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content: pack, rng: base.rng });
  const initialized = { ...base, identification: identified.identification, rng: identified.rng };
  const allocation = allocateFloorSeed(initialized.rng.generation);
  const vaults = pack.entries.filter((entry): entry is VaultContentEntry => entry.kind === 'vault');
  const generated = generateFloor({
    floorId: 'floor.generated-01',
    floorSeed: allocation.floorSeed,
    depth: 2,
    width: WIDTH,
    height: HEIGHT,
    theme: createClassicTheme(WIDTH, HEIGHT, {
      ambient: { color: [19, 23, 31], strength: 7 },
    }),
    vaults,
    requiredVaultId: 'vault.lampwright-cache',
  });
  const stairUp = generated.floor.stairUp;
  if (stairUp === null) throw new Error('generated demo floor must have a stair-up');

  const baseHeroActor = heroActor(initialized);
  const movedHeroActor = { ...baseHeroActor, floorId: generated.floor.floorId, ...stairUp };
  const carriedLight: LightSource = {
    lightId: 'light.hero-demo',
    location: { type: 'actor', actorId: movedHeroActor.actorId },
    color: [255, 179, 71],
    radius: 7,
    strength: 180,
    enabled: true,
    falloff: 'linear',
    vaultPlacementId: null,
    presentation: null,
  };
  const floor: FloorSnapshot = {
    ...generated.floor,
    lights: [...generated.floor.lights, carriedLight]
      .sort((left, right) => left.lightId < right.lightId ? -1 : left.lightId > right.lightId ? 1 : 0),
  };
  const transitional: ActiveRun = {
    ...initialized,
    contentHash: pack.hash,
    runId: 'run.generated-demo',
    actors: initialized.actors.map((actor) => actor.actorId === movedHeroActor.actorId ? movedHeroActor : actor),
    activeFloorId: generated.floor.floorId,
  };
  const run = addGeneratedFloor(transitional, { ...generated, floor }, allocation);
  return { run, generated, allocation };
}
