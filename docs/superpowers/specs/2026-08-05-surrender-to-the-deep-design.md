# Surrender to the Deep — Design

**Source:** user request, 2026-08-05 ("if a player suddenly runs out of light and does not find their way, they must be able to give up the run by surrendering to the Deep"). **Date:** 2026-08-05. **Status:** approved, not yet implemented.

## Goal

Give the player a way to end a run deliberately. The motivating case is the lightless hero — the torch curve makes deep floors torchless by design (`2026-08-04-loot-coverage-and-torch-curve-design.md`), so a run can reach a state where the hero is alive, unable to see, and unable to make progress. Today the only exits from that state are dying to something in the dark or closing the tab, and neither is a decision the player gets to make.

Surrender is that decision: the hero lays down and gives themselves to the Deep. The run concludes, the Hall records it, and the tablet fragments the hero was carrying are lost.

## The shape: a voluntary non-death conclusion

Surrender concludes the run with the hero **alive**, exactly as the Final Chamber's `became-heart` and `broke-cycle` choices do. It is not a variant of dying.

This is the cheap shape because the save schema already accommodates it. `packages/engine/src/save-schema/run-record.ts` encodes two invariants that a new completion must satisfy:

- `:1081` — a hero at zero health requires a non-null conclusion. Surrender leaves the hero alive, so this never fires.
- `:1088` — a living hero may not carry a `died` conclusion. Surrender is not `died`, so this never fires. The comment above it already states the general rule: voluntary conclusions close the run with the hero still alive.
- `:1109` — only a `died` completion may record a killer content id. Surrender records `killerContentId: null`, which the shared `concludeRunOnChoice` already supplies.

No new invariant is needed and no existing one is weakened.

Surrender **consumes no randomness and costs no turn**. It does not advance `worldTime`, does not run a world step, and does not draw from any RNG stream. This is what keeps every pinned demo hash untouched by the engine half of this change, and it matches how the instant chamber choices already behave.

## Availability

Available at **every** point in a live run, at any depth, including town (depth 0) and including the Final Chamber. The only rejection is the existing `run.concluded` reason when the run has already ended.

No light-based gate. Running out of light is the motivating case, not the rule: a gate on "carries no lit source and no fuel" would need to model every future light source and every future way to relight one, and would still refuse the player who is lost for some other reason. A standing command is one rule instead of a growing list of them.

Availability in town is deliberate rather than an oversight. Nothing bad happens there — the run ends and the record is written — and excluding it would buy a reason code and a test in exchange for preventing a player from doing something harmless on purpose.

## Content — the new completion type

`CompletionType` gains a fifth member:

```ts
export type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle' | 'surrendered';
```

in `packages/content/src/model/common.ts:144`. This is a **content schema bump** (currently `CONTENT_SCHEMA_VERSION = 17`; take whatever is current at branch time — parallel PRs collide on these numbers) with migration notes in `docs/server-admin/content-configuration.md`.

`balance.score.completionBonus` is a closed `Record<CompletionType, number>`, so both authored copies gain the key:

| Location | Change |
| --- | --- |
| `content/balance/core-gameplay.yaml:72` | `completionBonus: { died: 0, surrendered: 0, refused: 400, became-heart: 800, broke-cycle: 1500 }` |
| `packages/engine/src/fixture.ts:59` | same key added to the inline test fixture |

A bonus of **0**, identical to `died`. A surrendered run scores exactly what its depth, kills, discoveries and turn efficiency earned it — no bonus and no penalty. The cost of surrendering is paid in fragments (below), not in points.

### Hall ordering

`HALL_TIER_RANK` (`packages/engine/src/score-run.ts:142`) gains `surrendered: 0` — **the same tier as `died`**, so ordering between a surrender and a death falls through to score.

Surrender does not get a lower tier of its own. Tier dominates score absolutely in `compareHallRecords`, so a tier of `-1` would sort a depth-18 surrender beneath a depth-1 death. Both outcomes are "you did not make it out"; the difference between them belongs in what the run banks, not in an ordering that overrides every other measure of how the run went.

## Engine — the command

A new command in `packages/engine/src/commands-model.ts`:

```ts
export interface SurrenderCommand extends CommandEnvelope {
  readonly type: 'surrender';
}
```

added to the `Command` union there and to the command union in `packages/session-core/src/ws-protocol.ts`.

`reducer.ts` resolves it in a **dedicated branch modelled on the house-command branch** (`reducer.ts:402`), not on the Final Chamber branch. This is the load-bearing routing decision.

The Final Chamber choice is an ordinary player action: it runs through `validatePlayerAction`, is charged `actionCostFor(rules, 'action.final-chamber-choice')` — which falls through to `normalActionCost`, since no `action.final-chamber-choice` key exists in `content/balance/core-gameplay.yaml`'s `actionCosts` — and then drives a full `resolveWorldStep`. Routing surrender that way would cost a turn, advance world time, let every monster act, and draw from the combat and effects streams. That contradicts this design's no-turn/no-randomness requirement, and it introduces a genuine collision: if the world killed the hero in that same transition, the run would already be concluded `died` by the time the choice branch called `concludeRunOnChoice`, which throws on an already-concluded run.

The house and trade branches are the existing precedent for a command that advances the revision and nothing else. Following it, surrender:

```ts
// after the modal-session normalization, before validatePlayerAction
if (command.type === 'surrender') {
  assertCountersCanAdvance(current, false);
  const result = {
    status: 'applied',
    commandId: command.commandId,
    revision: current.revision + 1,
    turn: current.turn,          // unchanged: surrender costs no turn
  } as const;
  const resolved = concludeRunOnChoice({
    state: current,
    completionType: 'surrendered',
    turn: current.turn,
    eventId: command.commandId,
  });
  // ... project events and `record(...)`, exactly as the house branch does
}
```

`concludeRunOnChoice` already supplies everything else the conclusion needs: null killer, depth from the hero's active floor, `concludedAtRevision: state.revision + 1` (which matches `result.revision`), and a `run.concluded` domain event. Its throw-on-already-concluded guard can never fire here, because the generic `state.conclusion !== null` check at the top of `resolveCommand` (`reducer.ts:165`) already rejects with `run.concluded` well before this branch.

No world step, no `resolveWorldStep`, no curse post-pass, no RNG. No new invalid-reason code is introduced.

## Save schema

The persisted `completionType` enum in `packages/engine/src/save-schema/primitives.ts:112` widens to include `'surrendered'`.

This is a **save schema bump** (currently `SAVE_SCHEMA_VERSION = 19`; again, take what is current at branch time): preserve the previous schema as `legacyActiveRunV19Schema` and add exactly one ordered migration in `save-codec.ts`. The migration is an identity pass over `conclusion` — no save written before this change can contain `surrendered`, so nothing needs rewriting. It exists because the codec's ordered chain is the project's record of what changed and when, and a widened enum that skips the chain leaves a gap in it.

## Finalization — what surrender costs

One guard carries the entire cost. `newlyCollectedFragmentIds` in `packages/engine/src/run-finalize.ts:172` returns an empty list when the conclusion is `surrendered`:

> The Deep keeps the tablet. Every Ancient Tablet fragment the hero was carrying is lost — not banked to lifetime, and so contributing nothing toward the `broke-cycle` ending in any future run.

This is the meaningful dock because fragments are the one thing in the game that only accumulates across runs. Losing a run's score hurts a leaderboard; losing a run's fragments costs progress toward the only ending that requires them.

Everything else finalizes normally:

| Output | Surrendered run |
| --- | --- |
| Hall record | written |
| Score | normal, `completionBonus` 0 |
| Heirloom | selected normally |
| Achievements | granted normally (no `complete-ending` achievement targets `surrendered`) |
| Champion conquests | credited normally |
| Discovery protection | applied normally |
| Lifetime metrics | applied normally |
| **Tablet fragments** | **none banked** |

### Heirloom is not the dock

Removing the heirloom was considered and rejected. `HallRecord.heirloom` is non-nullable, and `deathInventory` falls back to it when the hero has nothing equipped (`run-finalize.ts:274`) so that a future champion drop always has something to materialize. Making it optional would ripple through the record schema, the haunt system and the artifact ledger — far more surface than this feature warrants.

### Haunts

A surrendered run produces an ordinary Hall record, so the existing haunt and champion systems pick it up with **no code change at all**. Population placement does not filter on `completionType` anywhere.

This is kept deliberately, not merely tolerated: a hero who gave themselves to the Deep and then waits inside it, guarding what they carried, is the outcome the fiction asks for.

### Artifact stints

`artifactStints` (`run-finalize.ts:202`) currently computes the carried artifact's outcome as:

```ts
input.completionType === 'died' ? 'died-with' : 'escaped-with'
```

A surrendered hero did not escape with anything. The condition widens to treat `surrendered` the same as `died`, yielding `'died-with'`.

Correspondingly, `ESCAPE_TEXT` in `apps/web/src/session/artifact-view.ts:107` is an exhaustive `Record<CompletionType, string>` and therefore requires a `surrendered` key for the type to close, even though the widened condition above makes it unreachable. It mirrors the `died` entry (`OUTCOME_TEXT['died-with']`), which is what an unreachable-but-required entry should read as if it ever did surface.

## Web client

**Command surface.** A Command Palette entry, "Surrender to the Deep", in `apps/web/src/ui/CommandPalette.tsx`. **No default keybind.** A single stray keypress must never be able to end a run, and no keybinding is worth that risk for an action taken once per run at most.

**Confirmation.** One confirm overlay, registered in `apps/web/src/ui/overlays/registry.ts`, following the `FinalChamberChoice` overlay's structure. Single step — no type-to-confirm. The copy is in-fiction but names both consequences in plain terms: the run ends immediately, and no tablet fragments are banked. A player who reads the dialog must not be able to be surprised afterward.

**Conclusion screen.** `ConclusionScreen.tsx` gains a `surrendered` entry in `COMPLETION_HEADLINE` and one in `COMPLETION_EPILOGUE`, alongside the existing four. The Wanderer epilogue path already replaces every per-completion epilogue and needs no change.

**Session dispatch.** `surrender()` on both `guest-session.ts` and `profile-session.ts`, mirroring the existing `chooseFinalChamber` dispatch on each. Guest builds the `GameCommand` directly and calls `dispatchCommand`; registered sends a `surrender` websocket message. Neither routes through `PlayerIntent` — there is no intent for a conclusion, exactly as `chooseFinalChamber` documents.

## Server

The registered path needs the message accepted and forwarded, mirroring `final-chamber-choice` at each hop:

- `packages/session-core/src/ws-protocol.ts` — a `{ type: 'surrender'; commandId; expectedRevision }` member on the client-message union.
- `apps/server/src/ws-protocol.ts:272` — a parse branch validating the same envelope fields.
- `apps/server/src/routes/ws-play.ts:188` — dispatch the `surrender` `GameCommand` into the play session.

The server stays authoritative throughout: the browser asks to surrender, the server's engine decides and produces the record. No record, score, or conclusion is ever accepted from the client.

## Testing

RED first, in this order.

**Engine** (`packages/engine/test/`):

1. `surrender` on a live run concludes with `completionType: 'surrendered'`, `killerContentId: null`, and the depth of the hero's active floor.
2. The transition advances **no** RNG stream — every stream's state is byte-identical before and after — and does not advance `worldTime` or `turn`.
3. `surrender` on an already-concluded run is rejected with `run.concluded` and changes no state.
4. Surrender is accepted at depth 0 (town) and on the Final Chamber floor. Both are explicit tests because both are places other commands are gated.

**Save codec:**

5. Encode/decode round-trip of a surrendered run is byte-identical.
6. Split save/reload replay of a run that ends in surrender matches continuous play byte for byte, per the standing determinism rule.

**Finalization:**

7. A surrendered run holding tablet fragments banks none of them; the same run ending in `died` banks them. This is the paired test that pins the dock.
8. A surrendered run still produces a heirloom and a non-empty `deathInventory`.
9. A surrendered run carrying an artifact records a `died-with` stint, not `escaped-with`.

**Content** (`packages/content/test/`):

10. `balance.score.completionBonus` has an entry for every member of `CompletionType`. This is the test that stops a future sixth completion type from silently scoring `undefined`.

## Expected hash drift

Editing `content/balance/core-gameplay.yaml` moves the pack's `contentHash`. Engine behaviour is unchanged and no RNG stream moves, so the pinned demo transcript hashes in `packages/engine/test/fixtures/*-demo-hashes.json` are expected to hold.

If any of them does drift, that drift is to be diffed and explained before re-pinning — never re-pinned because this document predicted a content-hash change. The standing rule applies unchanged.

## Non-goals

- **No light-based gate**, now or later. See Availability.
- **No "abandon" for a concluded run.** The existing `DELETE /api/profile/active-run` discard path (stranded-save recovery) is untouched and remains a different thing: it destroys a run without recording it, for content-mismatch recovery, not as a player-facing choice.
- **No new score line.** The cost is expressed through fragments and an existing zero-valued bonus, not a new `ScoreLineId`.
- **No haunt filtering.** Surrendered records return as haunts like any other.
- **No achievement for surrendering.** Nothing in `content/achievements/` targets the new ending.
