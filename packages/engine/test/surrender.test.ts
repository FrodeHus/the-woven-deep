import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  decodeActiveRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  encodeActiveRun,
  heroActor,
  resolveCommand,
  validateActiveRun,
  type ActiveRun,
  type GameCommand,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [7, 14, 21, 28] as const;
const context = () => ({ content: pack });

function freshRun(): ActiveRun {
  return createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
}

function surrenderCommand(run: ActiveRun, index = 1): GameCommand {
  return {
    type: 'surrender',
    commandId: `command.surrender.${index}`,
    expectedRevision: run.revision,
  };
}

/** Puts the hero on the given cell without walking there, so a test can reach a stair-down. */
function teleportHeroTo(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  return validateActiveRun({
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, x: position.x, y: position.y } : actor,
    ),
  });
}

describe('surrender', () => {
  it('concludes the run as surrendered', () => {
    const run = freshRun();
    const { state, result } = resolveCommand(run, surrenderCommand(run), context());

    expect(result.status).toBe('applied');
    expect(state.conclusion).not.toBeNull();
    expect(state.conclusion!.completionType).toBe('surrendered');
    expect(state.conclusion!.cause.killerContentId).toBeNull();
    expect(state.conclusion!.finalized).toBe(false);
  });

  it('leaves the hero alive', () => {
    const run = freshRun();
    const { state } = resolveCommand(run, surrenderCommand(run), context());
    expect(heroActor(state).health).toBeGreaterThan(0);
  });

  it('costs no turn and no world time', () => {
    const run = freshRun();
    const { state, result } = resolveCommand(run, surrenderCommand(run), context());

    expect(result.status === 'applied' && result.revision).toBe(run.revision + 1);
    expect(result.status === 'applied' && result.turn).toBe(run.turn);
    expect(state.turn).toBe(run.turn);
    expect(state.worldTime).toBe(run.worldTime);
  });

  it('draws from no RNG stream', () => {
    const run = freshRun();
    const { state } = resolveCommand(run, surrenderCommand(run), context());
    // Byte-identical stream state is the determinism claim: surrender must be free of every named
    // stream, not merely of the ones this particular run happens to have touched.
    expect(JSON.stringify(state.rng)).toBe(JSON.stringify(run.rng));
  });

  it('records the conclusion at the revision the command produced', () => {
    const run = freshRun();
    const { state, result } = resolveCommand(run, surrenderCommand(run), context());
    expect(state.conclusion!.concludedAtRevision).toBe(
      result.status === 'applied' ? result.revision : -1,
    );
  });

  it('emits a run.concluded public event', () => {
    const run = freshRun();
    const { events } = resolveCommand(run, surrenderCommand(run), context());
    expect(events.some((event) => event.type === 'run.concluded')).toBe(true);
  });

  it('rejects a second surrender with run.concluded', () => {
    const run = freshRun();
    const first = resolveCommand(run, surrenderCommand(run), context());
    const second = resolveCommand(first.state, surrenderCommand(first.state, 2), context());

    expect(second.result.status).toBe('invalid');
    expect(second.result.status === 'invalid' && second.result.reason).toBe('run.concluded');
    expect(second.state.conclusion!.completionType).toBe('surrendered');
  });

  it('is accepted in town at depth 0', () => {
    const run = freshRun();
    const activeFloor = run.floors.find((floor) => floor.floorId === run.activeFloorId);
    expect(activeFloor!.depth).toBe(0); // guard the premise: a fresh run starts in town
    const { result, state } = resolveCommand(run, surrenderCommand(run), context());
    expect(result.status).toBe('applied');
    expect(state.conclusion!.cause.depth).toBe(0);
  });

  it('produces a run that still encodes and round-trips', () => {
    // The command lands in `recentCommands`, so the save schema's command union has to accept it:
    // a surrendered run that cannot be saved would strand the profile at the moment of concluding.
    const run = freshRun();
    const { state } = resolveCommand(run, surrenderCommand(run), context());

    const encoded = encodeActiveRun(state);
    const decoded = decodeActiveRun(encoded);

    expect(decoded.conclusion!.completionType).toBe('surrendered');
    expect(decoded.recentCommands.at(-1)!.command.type).toBe('surrender');
    expect(encodeActiveRun(decoded)).toBe(encoded);
  });

  it('is accepted below town and records the hero floor depth', () => {
    const town = freshRun();
    const townFloor = town.floors.find((floor) => floor.floorId === town.activeFloorId)!;
    const onStairs = teleportHeroTo(town, townFloor.stairDown!);
    const descended = descendToNextFloor(onStairs, { content: pack }).state;

    const { state, result } = resolveCommand(descended, surrenderCommand(descended), context());

    expect(result.status).toBe('applied');
    const floor = state.floors.find((candidate) => candidate.floorId === state.activeFloorId)!;
    expect(floor.depth).toBe(1);
    expect(state.conclusion!.cause.depth).toBe(1);
  });
});
