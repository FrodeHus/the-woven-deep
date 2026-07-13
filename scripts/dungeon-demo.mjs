import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  analyzeConnectivity,
  createGeneratedDemoRun,
  createUnknownKnowledge,
  decodeActiveRun,
  encodeActiveRun,
  heroActor,
  heroPerception,
  isVisible,
  projectFloor,
  refreshKnowledge,
  resolveCommand,
  stableJson,
  tileDefinition,
} from '../packages/engine/dist/index.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const reviewedHashesPath = fileURLToPath(
  new URL('../packages/engine/test/fixtures/dungeon-demo-hashes.json', import.meta.url),
);
const candidateHashesPath = '/tmp/dungeon-demo-hashes.json';

function parseArguments(arguments_) {
  let verify = false;
  let contentDirectory = resolve(repositoryRoot, 'content');
  let sawContentDirectory = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--verify') {
      if (verify) throw new Error('--verify may only be supplied once');
      verify = true;
      continue;
    }
    if (argument === '--content-dir') {
      if (sawContentDirectory) throw new Error('--content-dir may only be supplied once');
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--content-dir requires a path');
      }
      contentDirectory = resolve(value);
      sawContentDirectory = true;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${argument}`);
  }
  return { verify, contentDirectory };
}

function hash(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function activeFloor(run) {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  if (floor === undefined) throw new Error(`active floor ${run.activeFloorId} is missing`);
  return floor;
}

function actorsFor(floor, run) {
  const actors = new Map(floor.entities.map((entity) => [entity.entityId, entity]));
  for (const actor of run.actors) {
    if (actor.floorId === floor.floorId) actors.set(actor.actorId, actor);
  }
  return actors;
}

function perceive(floor, run, preview) {
  const hero = heroPerception(run.hero, heroActor(run));
  const perception = refreshKnowledge({ floor, hero, actors: actorsFor(floor, run) });
  const refreshedFloor = { ...floor, knowledge: perception.knowledge };
  return projectFloor({
    floor: refreshedFloor,
    hero,
    visibilityWords: perception.visibilityWords,
    illumination: perception.illumination,
    ...(preview === undefined ? {} : { preview }),
  });
}

function generatedViews(run) {
  const savedFloor = activeFloor(run);
  const unknown = createUnknownKnowledge(savedFloor.width * savedFloor.height);
  const disabledLights = savedFloor.lights.map((light) => ({ ...light, enabled: false }));
  const absoluteFloor = {
    ...savedFloor,
    ambient: { color: [0, 0, 0], strength: 0 },
    lights: disabledLights,
    knowledge: unknown,
  };
  const lowAmbientFloor = {
    ...absoluteFloor,
    ambient: { color: [255, 255, 255], strength: 3 },
  };
  const route = analyzeConnectivity({
    width: savedFloor.width,
    height: savedFloor.height,
    tiles: savedFloor.tiles,
    start: savedFloor.stairUp,
    target: savedFloor.stairDown,
  }).route;
  assert(route.length > 8, 'generated floor route is too short for overlapping lights');
  const redPosition = route[7];
  const overlappingFloor = {
    ...absoluteFloor,
    lights: [
      {
        lightId: 'light.demo-blue-carried',
        location: { type: 'actor', actorId: run.hero.actorId },
        color: [0, 0, 255], radius: 7, strength: 255, enabled: true,
        falloff: 'linear', vaultPlacementId: null, presentation: null,
      },
      {
        lightId: 'light.demo-red-fixed',
        location: { type: 'fixed', x: redPosition.x, y: redPosition.y },
        color: [255, 0, 0], radius: 7, strength: 255, enabled: true,
        falloff: 'linear', vaultPlacementId: null, presentation: null,
      },
    ],
  };
  const absoluteDarkness = perceive(absoluteFloor, run);
  const lowAmbient = perceive(lowAmbientFloor, run);
  const overlappingColor = perceive(overlappingFloor, run);
  const torch = { color: [255, 179, 71], strength: 180, falloff: 'linear' };
  const preview3 = perceive(lowAmbientFloor, run, { ...torch, radius: 3 });
  const preview7 = perceive(lowAmbientFloor, run, { ...torch, radius: 7 });

  assert(absoluteDarkness.cells.every((cell) => cell.knowledge === 'unknown'),
    'absolute darkness exposed terrain without an enabled source');
  assert(lowAmbient.cells.some((cell) => cell.knowledge === 'visible' && cell.intensity === 3),
    'ambient strength 3 did not expose dim terrain');
  const tints = overlappingColor.cells
    .filter((cell) => cell.knowledge === 'visible')
    .map((cell) => cell.tint);
  assert(tints.some((tint) => tint[0] > 0 && tint[2] > 0), 'red and blue lights did not overlap');
  return { absoluteDarkness, lowAmbient, preview3, preview7, overlappingColor };
}

function sealedCornerView() {
  const width = 5;
  const height = 5;
  const index = (x, y) => y * width + x;
  const lines = ['#####', '#.#.#', '##..#', '#...#', '#####'];
  const tiles = lines.flatMap((line) => [...line].map((glyph) => glyph === '#' ? 0 : 1));
  const hero = { heroId: 'hero.corner', x: 1, y: 1, sightRadius: 5 };
  const light = {
    lightId: 'light.corner', location: { type: 'actor', actorId: hero.heroId },
    color: [255, 255, 255], radius: 4, strength: 255, enabled: true,
    falloff: 'linear', vaultPlacementId: null, presentation: null,
  };
  const floor = {
    floorId: 'floor.sealed-corner', width, height, tiles,
    ambient: { color: [0, 0, 0], strength: 0 }, lights: [light],
    knowledge: createUnknownKnowledge(width * height),
  };
  const perception = refreshKnowledge({ floor, hero, actors: new Map([[hero.heroId, hero]]) });
  const target = index(2, 2);
  assert(!isVisible(perception.visibilityWords, target) && perception.illumination.intensity[target] === 0,
    'two orthogonal blockers did not seal sight and light');

  const oneBlockerTiles = [...tiles];
  oneBlockerTiles[index(1, 2)] = 1;
  const oneBlockerFloor = { ...floor, tiles: oneBlockerTiles };
  const oneBlocker = refreshKnowledge({
    floor: oneBlockerFloor,
    hero,
    actors: new Map([[hero.heroId, hero]]),
  });
  assert(isVisible(oneBlocker.visibilityWords, target) && oneBlocker.illumination.intensity[target] > 0,
    'one orthogonal blocker incorrectly sealed sight or light');

  return projectFloor({
    floor: { ...floor, knowledge: perception.knowledge },
    hero,
    visibilityWords: perception.visibilityWords,
    illumination: perception.illumination,
  });
}

function direction(from, to) {
  if (to.x === from.x + 1 && to.y === from.y) return 'east';
  if (to.x === from.x - 1 && to.y === from.y) return 'west';
  if (to.y === from.y + 1 && to.x === from.x) return 'south';
  if (to.y === from.y - 1 && to.x === from.x) return 'north';
  throw new Error('generated route contains non-adjacent points');
}

function rememberedView(initialRun) {
  const floor = activeFloor(initialRun);
  const route = analyzeConnectivity({
    width: floor.width,
    height: floor.height,
    tiles: floor.tiles,
    start: floor.stairUp,
    target: floor.stairDown,
  }).route;
  const steps = route.slice(0, 21);
  assert(steps.length === 21, 'generated route is too short to demonstrate memory');
  let run = initialRun;
  for (let index = 1; index < steps.length; index += 1) {
    const destination = steps[index];
    assert(tileDefinition(floor.tiles[destination.y * floor.width + destination.x]).walkable,
      'remembered route requires a blocked terrain cell');
    const resolution = resolveCommand(run, {
      type: 'move',
      commandId: `command.dungeon-demo-${index}`,
      expectedRevision: run.revision,
      direction: direction(steps[index - 1], destination),
    });
    assert(resolution.result.status === 'applied', 'valid remembered route movement was not applied');
    run = resolution.state;
  }
  const movedFloor = activeFloor(run);
  const projection = perceive(movedFloor, run);
  assert(projection.cells.some((cell) => cell.knowledge === 'remembered'),
    'valid hero movement did not leave remembered terrain');
  return { run, projection };
}

const dimGlyph = new Map([
  [0, '%'], [1, ','], [2, '='], [3, 'o'], [4, '{'], [5, '}'], [6, ' '],
]);

function renderDiagnostic(floor) {
  const lines = [];
  for (let y = 0; y < floor.height; y += 1) {
    let line = '';
    for (let x = 0; x < floor.width; x += 1) {
      line += tileDefinition(floor.tiles[y * floor.width + x]).glyph;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function renderProjection(projection, hero, mode = 'terrain') {
  const lines = [];
  for (let y = 0; y < projection.height; y += 1) {
    let line = '';
    for (let x = 0; x < projection.width; x += 1) {
      const cell = projection.cells[y * projection.width + x];
      let glyph = ' ';
      if (cell.knowledge === 'remembered') glyph = dimGlyph.get(cell.tileId) ?? '?';
      if (cell.knowledge === 'visible') glyph = cell.fixture?.glyph ?? cell.glyph;
      if (mode === 'preview' && cell.previewIntensity > 0 && glyph === '.') glyph = '*';
      if (mode === 'color' && cell.knowledge === 'visible' && glyph === '.') {
        const [red, , blue] = cell.tint;
        glyph = red > 0 && blue > 0 ? 'm' : red > 0 ? 'r' : blue > 0 ? 'b' : '.';
      }
      if (hero !== undefined && x === hero.x && y === hero.y && cell.knowledge === 'visible') glyph = '@';
      line += glyph;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function sameProjectionSet(left, right) {
  return stableJson(left.absoluteDarkness) === stableJson(right.absoluteDarkness)
    && stableJson(left.lowAmbient) === stableJson(right.lowAmbient)
    && stableJson(left.overlappingColor) === stableJson(right.overlappingColor);
}

async function verifyReviewedHashes(hashes) {
  const reviewed = JSON.parse(await readFile(reviewedHashesPath, 'utf8'));
  assert(stableJson(hashes) === stableJson(reviewed), 'reviewed dungeon demo hashes do not match');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const pack = await compileContentDirectory({ rootDir: options.contentDirectory });
  const first = createGeneratedDemoRun(pack);
  const second = createGeneratedDemoRun(pack);
  assert(stableJson(first.generated.floor) === stableJson(second.generated.floor),
    'generated floor bytes diverged');
  assert(stableJson(first.generated.report) === stableJson(second.generated.report),
    'generation report bytes diverged');

  const floor = activeFloor(first.run);
  const views = generatedViews(first.run);
  const sealedCorner = sealedCornerView();
  const remembered = rememberedView(first.run);
  const restoredRun = decodeActiveRun(encodeActiveRun(first.run));
  assert(encodeActiveRun(restoredRun) === encodeActiveRun(first.run), 'decoded generated run bytes diverged');
  assert(sameProjectionSet(views, generatedViews(restoredRun)), 'decoded generated projections diverged');
  const restoredRemembered = decodeActiveRun(encodeActiveRun(remembered.run));
  assert(stableJson(remembered.projection) === stableJson(perceive(activeFloor(restoredRemembered), restoredRemembered)),
    'decoded remembered projection diverged');

  const hashes = {
    'floor-state': hash(first.generated.floor),
    'projection absolute-darkness': hash(views.absoluteDarkness),
    'projection low-ambient': hash(views.lowAmbient),
    'projection overlapping-color': hash(views.overlappingColor),
    'projection sealed-corner': hash(sealedCorner),
    'projection remembered': hash(remembered.projection),
  };
  await writeFile(candidateHashesPath, `${JSON.stringify(hashes, null, 2)}\n`, 'utf8');
  if (options.verify) await verifyReviewedHashes(hashes);

  const report = first.generated.report;
  const vault = report.vaults.find((candidate) => candidate.vaultId === 'vault.lampwright-cache');
  assert(vault !== undefined, 'required lampwright vault is missing');
  const attempt = report.fallback ? 'fallback' : String(report.attempt);
  const seed = floor.seed.map((word) => word.toString(16).padStart(8, '0')).join(' ');
  console.log('diagnostic terrain');
  console.log(renderDiagnostic(floor));
  console.log(`floor ${floor.floorId} ${floor.width}x${floor.height} generator ${floor.generatorVersion}`);
  console.log(`seed ${seed} attempt ${attempt}`);
  console.log(`rooms ${report.roomCount} corridors ${report.corridorCount} vault ${vault.vaultId}`);
  console.log(`stairs ${report.stairUp.x},${report.stairUp.y} -> ${report.stairDown.x},${report.stairDown.y} distance ${report.stairDistance}`);
  console.log('view absolute-darkness');
  console.log(renderProjection(views.absoluteDarkness, heroActor(first.run)));
  console.log('view low-ambient');
  console.log(renderProjection(views.lowAmbient, heroActor(first.run)));
  console.log('preview torch radius 3');
  console.log(renderProjection(views.preview3, heroActor(first.run), 'preview'));
  console.log('preview torch radius 7');
  console.log(renderProjection(views.preview7, heroActor(first.run), 'preview'));
  console.log('view overlapping-color');
  console.log(renderProjection(views.overlappingColor, heroActor(first.run), 'color'));
  console.log('view sealed-corner');
  console.log(renderProjection(sealedCorner, { x: 1, y: 1 }));
  console.log('view remembered');
  console.log(renderProjection(remembered.projection, heroActor(remembered.run)));
  for (const [label, value] of Object.entries(hashes)) console.log(`${label} ${value}`);
  if (options.verify) console.log('deterministic dungeon, visibility, and light verified');
  else console.log(`candidate hashes written ${candidateHashesPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`dungeon demo failed: ${message.replace(/\s+/g, ' ').trim()}`);
  process.exitCode = 1;
});
