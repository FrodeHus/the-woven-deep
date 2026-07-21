import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  compareCodeUnits,
  createInMemoryRunRecordRepository,
  createNewRun,
  decodeActiveRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  encodeActiveRun,
  expandLegacySeed,
  finalizeRun,
  FINAL_CHAMBER_DEPTH,
  HEART_BOSS_ENCOUNTER_ID,
  heroActor,
  isHeartBossActive,
  isHeartBossDefeated,
  movementBlockReason,
  nextUint32,
  projectGameplayState,
  resolveCommand,
  stableJson,
  tabletFragmentIds,
  validateActiveRun,
} from '../packages/engine/dist/index.js';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const reviewedHashesPath = fileURLToPath(
  new URL('../packages/engine/test/fixtures/endgame-demo-hashes.json', import.meta.url),
);

/** Host-supplied Hall enrichment: the closed achieved-at date and portrait vocabulary only. */
const DEMO_ENRICHMENT = { achievedAt: '2026-07-21', portraitGlyph: '@' };

function parseArguments(arguments_) {
  let verify = false;
  let hashesOnly = false;
  let contentDirectory = resolve(repositoryRoot, 'content');
  let sawContentDirectory = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--verify') {
      if (verify) throw new Error('--verify may only be supplied once');
      verify = true;
      continue;
    }
    if (argument === '--hashes-only') {
      if (hashesOnly) throw new Error('--hashes-only may only be supplied once');
      hashesOnly = true;
      continue;
    }
    if (argument === '--content-dir') {
      if (sawContentDirectory) throw new Error('--content-dir may only be supplied once');
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith('--'))
        throw new Error('--content-dir requires a path');
      contentDirectory = resolve(value);
      sawContentDirectory = true;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${argument}`);
  }
  return { verify, hashesOnly, contentDirectory };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : stableJson(value))
    .digest('hex');
}

const context = (content) => ({ content });

/** Moves the hero's cell directly, as a save edit rather than a walk, to reach a target position. */
function teleportHeroTo(run, position) {
  const hero = heroActor(run);
  return validateActiveRun({
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, x: position.x, y: position.y } : actor,
    ),
  });
}

/**
 * Drives a fresh guest run all the way down to the Final Chamber: on each floor the hero is placed
 * on the stair-down and `descendToNextFloor` generates the next one, until the depth-20 authored
 * Chamber is reached. The Chamber generation itself consumes no randomness.
 */
function descendToChamber(seed, content) {
  let state = createNewRun({ pack: content, seed, hero: DEFAULT_GUEST_HERO });
  while (true) {
    const floor = state.floors.find((candidate) => candidate.floorId === state.activeFloorId);
    if (floor === undefined) throw new Error('endgame demo lost its active floor while descending');
    if (floor.depth >= FINAL_CHAMBER_DEPTH) return state;
    if (floor.stairDown === null) {
      throw new Error(`endgame demo floor at depth ${floor.depth} has no stair-down`);
    }
    state = descendToNextFloor(teleportHeroTo(state, floor.stairDown), context(content)).state;
  }
}

function choiceCommand(choice, revision) {
  return {
    type: 'final-chamber-choice',
    commandId: `command.${choice}`,
    expectedRevision: revision,
    choice,
  };
}

/** One Ancient Tablet fragment carried in the hero's backpack. */
function fragment(contentId, heroId) {
  return {
    itemId: `${contentId}.instance`,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: heroId },
  };
}

/** Places the full authored fragment set in the hero's backpack, ordered as the save schema requires. */
function withAllFragments(run, content) {
  const fragments = tabletFragmentIds(content).map((id) => fragment(id, run.hero.actorId));
  const items = [...run.items, ...fragments].sort((left, right) =>
    compareCodeUnits(left.itemId, right.itemId),
  );
  return validateActiveRun({ ...run, items });
}

/** Rigs the combat stream so its next d20 lands a natural 20, guaranteeing the killing blow hits. */
function rigCombatCritical(run) {
  const sides = 20;
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  for (let seed = 1; seed < 100_000; seed += 1) {
    const rigged = expandLegacySeed(seed);
    const step = nextUint32(rigged);
    if (step.value < limit && (step.value % sides) + 1 === sides) {
      return validateActiveRun({ ...run, rng: { ...run.rng, combat: rigged } });
    }
  }
  throw new Error('endgame demo could not rig a combat critical hit');
}

/** The first free walkable neighbour of the boss, in a fixed order, for the hero to strike from. */
function freeCellBeside(run, actor) {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  if (floor === undefined) throw new Error('endgame demo has no active floor for boss positioning');
  const occupied = new Set(
    run.actors
      .filter(
        (candidate) =>
          candidate.actorId !== run.hero.actorId &&
          candidate.floorId === floor.floorId &&
          candidate.health > 0,
      )
      .map((candidate) => `${candidate.x}:${candidate.y}`),
  );
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const x = actor.x + dx;
    const y = actor.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
    if (movementBlockReason(floor.tiles[y * floor.width + x]) !== undefined) continue;
    if (occupied.has(`${x}:${y}`)) continue;
    return { x, y };
  }
  throw new Error('endgame demo cannot find a free cell beside the Heart boss');
}

/**
 * Applies one command through `resolveCommand`, asserting it applied, and returns a record carrying
 * the authoritative (persisted) events, the public events, the projection, and the next state.
 */
function step(state, command, content) {
  const resolution = resolveCommand(state, command, context(content));
  assert(
    resolution.result.status === 'applied',
    `endgame demo command ${command.commandId} was ${resolution.result.status}: ${stableJson(
      resolution.events,
    )}`,
  );
  const next = resolution.state;
  const recorded = next.recentCommands.find(
    (entry) => entry.command.commandId === command.commandId,
  );
  assert(recorded !== undefined, `endgame demo command ${command.commandId} was not persisted`);
  return {
    state: next,
    record: {
      command,
      result: resolution.result,
      authoritativeEvents: recorded.events,
      publicEvents: resolution.events,
      projection: projectGameplayState({ state: next, content }),
    },
  };
}

/**
 * The three endings, each as a `prepare` step (the expensive descent to the Chamber plus its
 * ending-specific setup, run once) and a `conclude` step (the terminal command(s) that end the run,
 * run twice -- continuously and after a save reload -- to prove the outcome is reload-stable).
 */
const SCENARIOS = [
  {
    name: 'broke-cycle',
    // Reach the Chamber carrying the full tablet set, then assemble it: an instant conclusion.
    prepare: (content) => withAllFragments(descendToChamber([1, 2, 3, 4], content), content),
    conclude: (state, content) => {
      const { state: concluded, record } = step(
        state,
        choiceCommand('break-cycle', state.revision),
        content,
      );
      assert(
        concluded.conclusion?.completionType === 'broke-cycle',
        `broke-cycle scenario concluded ${concluded.conclusion?.completionType}`,
      );
      assert(
        stableJson(concluded.rng) === stableJson(state.rng),
        'broke-cycle is an instant conclusion and must consume no randomness',
      );
      return { finalState: concluded, records: [record] };
    },
  },
  {
    name: 'became-heart',
    // Reach the Chamber and take the bound Heart's place: instant, and it writes the lineage slot.
    prepare: (content) => descendToChamber([5, 6, 7, 8], content),
    conclude: (state, content) => {
      const { state: concluded, record } = step(
        state,
        choiceCommand('become-heart', state.revision),
        content,
      );
      assert(
        concluded.conclusion?.completionType === 'became-heart',
        `became-heart scenario concluded ${concluded.conclusion?.completionType}`,
      );
      assert(
        stableJson(concluded.rng) === stableJson(state.rng),
        'became-heart is an instant conclusion and must consume no randomness',
      );
      return { finalState: concluded, records: [record] };
    },
  },
  {
    name: 'refused',
    // Only the descent is costly, so it alone is prepared once. `conclude` turns away to enrage the
    // weakened Heart, brings it to one health beside the hero with a rigged critical, then lands the
    // killing `attack` -- a genuine boss win. Both commands stay observable in the hashed records.
    prepare: (content) => descendToChamber([9, 10, 11, 12], content),
    conclude: (state, content) => {
      const turned = step(state, choiceCommand('turn-away', state.revision), content);
      assert(isHeartBossActive(turned.state), 'refused scenario did not activate the Heart boss');
      const boss = turned.state.populations.find(
        (population) =>
          population.model === 'boss' && population.encounterId === HEART_BOSS_ENCOUNTER_ID,
      );
      assert(boss !== undefined, 'refused scenario is missing the Heart boss population');
      const bossActor = turned.state.actors.find((actor) => actor.actorId === boss.actorId);
      assert(bossActor !== undefined, 'refused scenario is missing the Heart boss actor');
      const cell = freeCellBeside(turned.state, bossActor);
      const engaged = rigCombatCritical(
        validateActiveRun({
          ...turned.state,
          actors: turned.state.actors.map((actor) =>
            actor.actorId === boss.actorId
              ? { ...actor, health: 1 }
              : actor.actorId === turned.state.hero.actorId
                ? { ...actor, ...cell, energy: 100 }
                : actor,
          ),
        }),
      );
      const { state: concluded, record: slain } = step(
        engaged,
        {
          type: 'attack',
          commandId: 'command.slay-heart',
          expectedRevision: engaged.revision,
          targetActorId: boss.actorId,
        },
        content,
      );
      assert(isHeartBossDefeated(concluded), 'refused scenario did not defeat the Heart boss');
      assert(
        concluded.conclusion?.completionType === 'refused',
        `refused scenario concluded ${concluded.conclusion?.completionType}`,
      );
      assert(
        slain.publicEvents.some((event) => event.type === 'run.concluded'),
        'refused scenario never emitted run.concluded',
      );
      return { finalState: concluded, records: [turned.record, slain] };
    },
  },
];

/**
 * Finalizes a concluded scenario through `finalizeRun` and a fresh in-memory repository, mirroring
 * the client's finalize path (append record, apply deltas, and -- for `became-heart` -- write the
 * Heart lineage slot). Returns the observable outcome bundle the demo hashes and asserts against.
 */
function finishScenario(name, { finalState: state, records }, content) {
  assert(state.conclusion !== null, `${name} scenario never concluded`);
  const repository = createInMemoryRunRecordRepository();
  const finalized = finalizeRun({ run: state, content, lifetime: repository.lifetime() });
  assert(
    finalized.record.completionType === state.conclusion.completionType,
    `${name} scenario record completionType diverged from the conclusion`,
  );
  repository.appendRecord({ ...finalized.record, enrichment: DEMO_ENRICHMENT });
  repository.applyDeltas(finalized.deltas);
  if (finalized.record.completionType === 'became-heart') {
    repository.recordHeart({
      heroName: finalized.record.heroName,
      classTags: finalized.record.classTags,
      hallRecordId: finalized.record.recordId,
      enrichment: DEMO_ENRICHMENT,
    });
  }
  const heart = repository.currentHeart();
  if (finalized.record.completionType === 'became-heart') {
    assert(heart !== null, 'became-heart scenario did not write the Heart lineage');
  } else {
    assert(heart === null, `${name} scenario must not write the Heart lineage`);
  }
  return {
    name,
    completionType: finalized.record.completionType,
    finalState: state,
    records,
    finalization: { record: finalized.record, deltas: finalized.deltas, events: finalized.events },
    standings: repository.standings(10),
    heart,
  };
}

/**
 * Runs one ending: prepares the Chamber state once (the costly descent), then concludes it both
 * continuously and from a save reload of that same prepared state, asserting the two are
 * byte-identical (final save, records, and finalization). Returns the finished continuous bundle.
 */
function runScenario(scenario, content) {
  const prepared = scenario.prepare(content);
  const continuous = finishScenario(scenario.name, scenario.conclude(prepared, content), content);
  const reloaded = finishScenario(
    scenario.name,
    scenario.conclude(decodeActiveRun(encodeActiveRun(prepared)), content),
    content,
  );
  assert(
    encodeActiveRun(continuous.finalState) === encodeActiveRun(reloaded.finalState),
    `${scenario.name} scenario final save diverged across a reload`,
  );
  assert(
    stableJson(continuous.records) === stableJson(reloaded.records),
    `${scenario.name} scenario records diverged across a reload`,
  );
  assert(
    stableJson(continuous.finalization) === stableJson(reloaded.finalization),
    `${scenario.name} scenario finalization diverged across a reload`,
  );
  return continuous;
}

function scenarioHashes(scenario) {
  return {
    [`${scenario.name}-save`]: hash(encodeActiveRun(scenario.finalState)),
    [`${scenario.name}-records`]: hash(scenario.records),
    [`${scenario.name}-events`]: hash({
      authoritative: scenario.records.map((record) => record.authoritativeEvents),
      public: scenario.records.map((record) => record.publicEvents),
      finalization: scenario.finalization.events,
    }),
    [`${scenario.name}-record`]: hash(scenario.finalization.record),
    [`${scenario.name}-standings`]: hash(scenario.standings),
    [`${scenario.name}-heart`]: hash(scenario.heart),
  };
}

function computeHashes(scenarios) {
  return scenarios.reduce((all, scenario) => ({ ...all, ...scenarioHashes(scenario) }), {});
}

async function verifyReviewedHashes(hashes) {
  const reviewed = JSON.parse(await readFile(reviewedHashesPath, 'utf8'));
  assert(stableJson(hashes) === stableJson(reviewed), 'reviewed endgame demo hashes do not match');
}

function printHashes(hashes) {
  for (const [label, value] of Object.entries(hashes)) {
    assert(/^[a-f0-9]{64}$/.test(value), `${label} must be a nonempty sha-256 hex digest`);
    console.log(`${label} ${value}`);
  }
}

function runScenarios(content) {
  return SCENARIOS.map((scenario) => runScenario(scenario, content));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const content = await compileContentDirectory({ rootDir: options.contentDirectory });
  const scenarios = runScenarios(content);
  const hashes = computeHashes(scenarios);
  if (options.hashesOnly) {
    printHashes(hashes);
    return;
  }

  for (const scenario of scenarios) {
    console.log(`ending ${scenario.name} -> completion ${scenario.completionType}`);
    console.log(
      stableJson({
        depth: scenario.finalState.conclusion.cause.depth,
        killerContentId: scenario.finalState.conclusion.cause.killerContentId,
        score: scenario.finalization.record.score.total,
        heart:
          scenario.heart === null
            ? null
            : { heroName: scenario.heart.heroName, classTags: scenario.heart.classTags },
      }),
    );
  }
  console.log('first process hashes');
  printHashes(hashes);

  const second = spawnSync(
    process.execPath,
    [scriptPath, '--hashes-only', '--content-dir', options.contentDirectory],
    { encoding: 'utf8' },
  );
  assert(second.status === 0, `second process failed: ${second.stderr}`);
  const expected = Object.entries(hashes)
    .map(([label, value]) => `${label} ${value}`)
    .join('\n');
  assert(second.stdout.trim() === expected, 'second process hashes diverged');
  console.log('second process hashes');
  process.stdout.write(second.stdout);

  if (options.verify) {
    await verifyReviewedHashes(hashes);
    console.log('endgame milestone verified');
  } else {
    const candidateHashesPath = join(
      await mkdtemp(join(tmpdir(), 'endgame-demo-')),
      'endgame-demo-hashes.json',
    );
    await writeFile(candidateHashesPath, `${JSON.stringify(hashes, null, 2)}\n`, 'utf8');
    console.log(`candidate hashes written ${candidateHashesPath}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`endgame demo failed: ${message.replace(/\s+/g, ' ').trim()}`);
  process.exitCode = 1;
});
