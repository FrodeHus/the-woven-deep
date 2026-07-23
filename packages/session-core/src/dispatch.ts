import type { CompiledContentPack } from '@woven-deep/content';
import {
  ascendToPreviousFloor,
  descendToNextFloor,
  projectDomainEvents,
  projectGameplayState,
  recallReturn,
  recallToTown,
  resolveCommand,
  type ActiveRun,
  type CommandResolution,
  type GameCommand,
  type OpaqueId,
  type PublicEvent,
} from '@woven-deep/engine';
import { buildIntent } from './command-builder.js';
import type { PlayerIntent } from './intents.js';

/**
 * Maps an applied `PlayerIntent` to the onboarding mastery vocabulary (`apps/web`'s
 * `onboarding.ts`'s `HINTS`), or `null` for intents no hint cares about. Deliberately synthetic,
 * not a passthrough of `PlayerIntent['type']` -- `'trade-complete'` in particular folds both
 * `trade-buy` and `trade-sell` into the same mastery count, since either one demonstrates "you
 * traded". Mirrors the pre-extraction `onboardingIntentType` that used to live in
 * `guest-session.ts` -- moved here because it's part of classifying what an intent DID, which is
 * exactly what `dispatchIntent` below already computes.
 */
function onboardingIntentType(intent: PlayerIntent): string | null {
  if (intent.type === 'move') return 'move';
  if (intent.type === 'backpack' && intent.action === 'toggle-light') return 'toggle-light';
  if (intent.type === 'trade-buy' || intent.type === 'trade-sell') return 'trade-complete';
  return null;
}

/**
 * What `dispatchIntent` produced, for the caller (`GuestSession`/a future server play session) to
 * act on. Every variant carries the resulting `run` -- unchanged from the input for `rejected` and
 * `house`, since neither one mutates the run.
 *
 * - `rejected`: `buildIntent` itself refused the intent (e.g. "nothing to pick up here") before
 *   ever reaching the engine -- no command was built, no resolution ran.
 * - `house`: the intent opens the house-transfer screen -- a purely client/session-level UI
 *   toggle, never an engine command.
 * - `transition`: a session-level floor transition (descend/ascend) -- these live in the engine
 *   but are not run through `resolveCommand`/the reducer's command apparatus, so there is no
 *   `CommandResult` for them.
 * - `command`: the intent built a real `GameCommand` that went through `resolveCommand` --
 *   `resolution` is the engine's own `CommandResolution` (`applied`/`invalid`/`decision_required`/
 *   `rejected`), untouched.
 */
export type DispatchOutcome =
  | { readonly kind: 'rejected'; readonly run: ActiveRun; readonly message: string }
  | { readonly kind: 'house'; readonly run: ActiveRun }
  | {
      readonly kind: 'transition';
      readonly run: ActiveRun;
      readonly events: readonly PublicEvent[];
      readonly onboardingIntentType: string | null;
    }
  | {
      readonly kind: 'command';
      readonly resolution: CommandResolution;
      readonly onboardingIntentType: string | null;
    };

/**
 * The pure run-mutation pipeline behind a single dispatched `PlayerIntent`: builds the engine
 * command (or session-level transition) via `buildIntent`, then either runs the floor transition
 * (`descendToNextFloor`/`ascendToPreviousFloor`) or `resolveCommand`, exactly as
 * `GuestSession.dispatch` used to inline. Deliberately framework-free -- no storage, no log
 * folding, no projection beyond what building the command itself requires, no notices, no clock.
 * The caller owns persistence, log folding, snapshot projection, and onboarding bookkeeping.
 */
export function dispatchIntent(
  run: ActiveRun,
  intent: PlayerIntent,
  ctx: Readonly<{ pack: CompiledContentPack; commandId: OpaqueId; expectedRevision: number }>,
): DispatchOutcome {
  const { pack, commandId, expectedRevision } = ctx;
  const projection = projectGameplayState({ state: run, content: pack });
  const built = buildIntent({ intent, projection, commandId, expectedRevision, pack });

  if (built.kind === 'rejected') {
    return { kind: 'rejected', run, message: built.message };
  }

  if (built.kind === 'descend') {
    // A pending recall anchor reroutes the town's descend/stair intent to the return portal
    // instead of generating/entering the next dungeon floor: the hero is walking back down into
    // the floor they recalled away from, not descending fresh.
    const transition =
      run.returnAnchorFloorId !== undefined
        ? recallReturn(run, { content: pack })
        : descendToNextFloor(run, { content: pack });
    const events = projectDomainEvents({
      state: transition.state,
      content: pack,
      heroId: transition.state.hero.actorId,
      events: transition.events,
    });
    return { kind: 'transition', run: transition.state, events, onboardingIntentType: 'descend' };
  }

  if (built.kind === 'ascend') {
    // Mirrors the descend branch above exactly: a session-level transition (not a reducer
    // command), so it goes through `projectDomainEvents` on the returned events -- ascending never
    // emits any events (see `ascendToPreviousFloor`), but routing it identically keeps the two
    // floor-change paths symmetric. Unlike descend, ascending was never folded into onboarding
    // mastery.
    const transition = ascendToPreviousFloor(run, { content: pack });
    const events = projectDomainEvents({
      state: transition.state,
      content: pack,
      heroId: transition.state.hero.actorId,
      events: transition.events,
    });
    return { kind: 'transition', run: transition.state, events, onboardingIntentType: null };
  }

  if (built.kind === 'house') {
    return { kind: 'house', run };
  }

  const resolution = resolveCommand(run, built.command, { content: pack });
  // A recall cast sets `returnAnchorFloorId` inside the reducer but deliberately does not move the
  // hero (floor transitions live outside `resolveCommand` and clear `recentCommands`, which would
  // invalidate the very command just retained). Once the anchor first appears here, this performs
  // the actual town move as a follow-on session-level transition -- guarded by `run.returnAnchorFloorId
  // === undefined` so re-dispatching an already-anchored run (e.g. replay) never re-triggers it.
  if (resolution.state.returnAnchorFloorId !== undefined && run.returnAnchorFloorId === undefined) {
    const moved = recallToTown(resolution.state, { content: pack });
    // `resolution.events` carries the cast's own public events (notably `hero.recalled`) --
    // `recallToTown` itself emits none, but its town-move is still projected the same way the
    // other floor-transition branches project theirs, for consistency.
    const events = [
      ...resolution.events,
      ...projectDomainEvents({
        state: moved.state,
        content: pack,
        heroId: moved.state.hero.actorId,
        events: moved.events,
      }),
    ];
    return { kind: 'transition', run: moved.state, events, onboardingIntentType: 'recall' };
  }
  return {
    kind: 'command',
    resolution,
    onboardingIntentType: onboardingIntentType(intent),
  };
}

/**
 * The raw-command sibling of `dispatchIntent`, for the two call sites that build a `GameCommand`
 * directly rather than through a `PlayerIntent`/`buildIntent` (`answerDecision`'s synthesized
 * `attack`, `chooseFinalChamber`'s `final-chamber-choice`) -- there is no intent for either. A
 * thin, named forward onto `resolveCommand` so every run-mutating call in the session layer goes
 * through this module rather than importing the engine's reducer directly.
 */
export function dispatchCommand(
  run: ActiveRun,
  command: GameCommand,
  ctx: Readonly<{ pack: CompiledContentPack }>,
): CommandResolution {
  return resolveCommand(run, command, { content: ctx.pack });
}
