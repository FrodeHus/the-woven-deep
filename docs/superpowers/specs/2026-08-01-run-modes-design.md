# Run Modes: Classic / Wanderer — Design

**Issue:** #162. **Date:** 2026-08-01. **Status:** approved.

## Goal

Expand who can enjoy The Woven Deep without touching what makes it The Woven Deep. At character creation the player picks a mode, locked for the run's lifetime:

- **Classic** — today's game, byte-identical: death is final, the Hall remembers.
- **Wanderer** — death is a setback: rise again at the top of the current floor, as many times as needed. The Hall does not watch — no records, no standings, no champions, no artifact circulation, ever (deaths *and* victories alike).

## Non-goals

- No mid-run mode switching in either direction.
- No death toll, rise counter, or other Wanderer penalty beyond losing floor progress.
- No marked/segregated Wanderer Hall records (the Hall stays 100% Classic).
- No unlock gating — both modes are open from the first launch.
- No engine-side death-path changes: death concludes the run in both modes exactly as today.

## Architecture

The engine stays pure and mode-agnostic in behavior: `concludeRunOnHeroDeath`, `finalizeRun`, every reducer gate, and the save-validation invariants are untouched. The mode is **data on the run** that the *hosts* read:

- **Rise again** is a host operation: discard the concluded state and `decodeActiveRun` a checkpoint the host stashed at floor entry. `finalizeRun` never runs for that death — no record, no heirloom roll (`run-records` stream untouched), no lifetime deltas, no artifact deltas.
- **Accept death** in Wanderer ends the run without calling `finalizeRun` at all.
- In Classic the hosts behave exactly as today (regression-pinned).

## Components

### 1. Engine — `ActiveRun.mode` (save v14 → v15)

- `mode: 'classic' | 'wanderer'` on `ActiveRun`; strict Zod field in the save schema; `legacyActiveRunV14Schema` frozen (heed the Task-3 lesson from #121: freeze shared sub-schemas, and the migration chain must default `mode: 'classic'` at every entry version so v4–v14 saves all decode); exactly one ordered migration v14→v15.
- `createNewRun` gains a run-scoped input beside `hero`/`records`: `mode?: RunMode` (default `'classic'`, so all existing callers/fixtures/demos are byte-identical except the one new field + schemaVersion — the demo re-pin attributes exactly that).
- Projection exposes `mode` (player-known, not hidden).
- `HeroChoices` does NOT carry it (build-scoped vs run-scoped); the wizard passes it alongside choices, like the portrait glyph.

### 2. Chargen — a Mode step

New wizard step between Traits and Review:

- **Classic**: "The true Deep. Death is final. The Hall remembers."
- **Wanderer**: "Walk the Deep unbound. Death is a setback — rise again at the floor's mouth. The Hall does not watch."

Default selection: Classic. Rides `WizardState` (reducer + StepMenu + steps.tsx + Review summary line), flows into `createNewRun`'s `mode` input at confirm. Keyboard flow matches the existing console wizard.

### 3. Checkpoints (Wanderer only)

The checkpoint is the full `encodeActiveRun(state)` string captured after every completed floor transition (all six entry paths — descend generated/stored, ascend, chamber, both recalls — land in the hosts' existing per-transition persist branches).

- **Guest:** a second `sessionStorage` key beside `SAVE_KEY` (e.g. `woven-deep.guest-checkpoint`), written from `GuestSession.persist()` when the dispatch was a transition and `mode === 'wanderer'`; cleared on run end and on new run. Quota failure: drop the checkpoint, log a system line ("The Deep will not promise a return."), and continue — death then behaves like Classic-without-record. Never crash.
- **Server profile:** a `checkpoint_blob` column on `active_runs` (nullable; single-row-per-profile upsert unchanged), written in the same transaction as the eager transition persist; cleared by `clear()` and on finalize.
- Classic runs never write checkpoints.

### 4. Death flow

- `DeathOverlay` in Wanderer presents two actions: **Rise again** (default) and **Accept death**. Classic keeps the single acknowledge.
- The immediate-finalize effect in `App.tsx` becomes conditional: Classic → finalize as today; Wanderer → wait for the choice.
- **Rise again:** host decodes the checkpoint and swaps it in as the live run. Guest: replace the in-memory run + persist + publish. Server: replace repo blob and push an authoritative snapshot (same shape as the reconnect push) so the client's cached `revision` re-syncs; the client's command-sequence counter keeps advancing, so no commandId collisions with the pre-death life. A missing/corrupt checkpoint degrades to Accept-death with a log line.
- **Accept death:** navigate to ConclusionScreen with a Wanderer epilogue variant; no `finalizeRun`, nothing written to the Hall store; the active run (and server row + checkpoint) is cleared.
- Death on floor 1 of town-adjacent depth works identically — the checkpoint from entering depth 1 exists before any danger does. A death BEFORE the first checkpoint exists (theoretically impossible — town has no hostiles; guarded anyway) degrades to Accept-death.

### 5. Records and circulation gating

- The two finalize call sites gate on mode: `GuestSession.finalizeConcludedRun` and the server's `maybeFinalize` return early (after clearing run state) when `mode === 'wanderer'`.
- Consequences, deliberate: Wanderer runs never produce Hall records, never enter standings/champions/echoes, never roll heirlooms, never apply lifetime or artifact deltas. Artifacts a Wanderer finds were never marked `lost` in the ledger, so they remain discoverable by Classic runs — circulation coherent with zero new ledger logic.
- The rewind is also ledger-safe by construction: no host-side ledger/lifetime write exists between floor entry and death.

### 6. Surfaces

- Character sheet and ConclusionScreen show the mode.
- Hall UI: untouched (nothing Wanderer ever reaches it).
- Server wire protocol: when server-side chargen lands (it does not exist yet — profile runs use the default hero), the mode must be server-owned like the sketched `canStartClass` guard; until then the mode rides the run blob the session already owns.

## Determinism

- Resume is a plain `decodeActiveRun` of a fully self-consistent blob — every RNG stream rewinds with it, so a re-attempted floor replays byte-identically until the player diverges. This is the accepted, documented behavior (pure-rewind decision).
- `revision`/`turn`/`worldTime` decrease across a rise; each blob is internally consistent and validates standalone. The server treats the restore as an authoritative snapshot push, so client `expectedRevision` re-syncs.
- Split save/reload byte-identity is unaffected: the checkpoint lives outside `ActiveRun` (host storage), never nested in the encoded state.

## Error handling

- Checkpoint write failure (quota): drop + warn line, continue playing; death degrades gracefully.
- Checkpoint decode failure at rise time: degrade to Accept-death with an apologetic line; never a crash, never a half-restored state.
- Save-schema: unknown mode value in a blob fails strict decode (invalid save), like any enum.

## Testing

- Engine: v14→v15 migration (all legacy entry versions default `classic`), round-trip byte-identity with both modes, `createNewRun` default, projection exposure, demo digest re-pin attributed to schemaVersion+mode only.
- Web: checkpoint written on every transition kind in Wanderer and never in Classic; rise-again restores byte-identical floor-entry state (encode equality); accept-death writes nothing to the Hall store; Classic flow regression-pinned unchanged; quota and corrupt-checkpoint degradation paths.
- Server: checkpoint column round-trip, restore push shape, finalize gating (Wanderer victory produces no record, no unlocks, no achievements), transaction discipline.
- Wizard: step navigation, default Classic, Review summary, mode reaches `createNewRun`.

## Amendments (2026-08-01, during implementation)

Each was an under-specification found while mapping the spec onto the code.

1. **The server owns the mode; no wire path carries it.** Server-side chargen does not exist (profile runs use `DEFAULT_GUEST_HERO`), and `parseClientMessage` must never trust a client-declared mode. `ServerPlaySession.open()` gains `mode?: RunMode` (default `'classic'`), server-owned exactly like the `canStartClass` guard beside it. Until chargen lands, Wanderer profile runs are reachable only from server-side tests.
2. **Rise/accept ride two new client→server messages, and reuse the existing `state` push.** The spec names the restore push but not the request. Two new `ClientMessage` variants, `rise-again` and `accept-death`, both carrying `commandId`/`expectedRevision` (mandatory for every message in `parseClientMessage`). The reply is the existing `{ type: 'state', snapshot }` — that IS the reconnect-push shape, so no new `ServerMessage` variant and no client-side message-handling branch is needed.
3. **`RunConclusionProjection` carries the mode.** The spec says ConclusionScreen shows the mode but not how it gets there. Adding `mode` to the conclusion projection (player-known data, same as `completionType`) is cleaner than threading a second value through React navigation state, and it is what the guest finalize gate reads back.
4. **Naming: `ServerPlaySession.checkpoint()` is already taken** (the movement dirty-counter, `play-session.ts:420`). The Wanderer checkpoint members are `writeRiseCheckpoint()` / `checkpoint_blob` / `riseAgain()` throughout, so no existing symbol is shadowed or reused for a second meaning.
5. **All six floor-entry paths already land in ONE host branch.** `dispatchIntent` (`packages/session-core/src/dispatch.ts`) returns `kind: 'transition'` for descend-generated, descend-stored, the Final Chamber, ascend, `recallReturn` (the descend branch's anchored arm), and the recall-cast follow-on `recallToTown`. The checkpoint write therefore hooks that single branch in each host, not six call sites.
6. **`GameplayProjection.mode` is required, not optional.** The spec says the projection exposes the mode; a required field makes every consumer's missing-mode bug a `tsc` error rather than a silent `'classic'`.
7. **Non-death Wanderer conclusions gate at the same place.** The spec's §4 death UX covers death only, but §5 says "deaths *and* victories alike". A Wanderer victory (`became-heart`, `broke-cycle`, `refused`) still flows through the host's normal immediate-finalize effect; the gate lives inside `finalizeConcludedRun`/`maybeFinalize`, which clear run state and return an unfinalized, record-null projection.
8. **`legacyActiveRunV14Schema` freezes the top level only.** This bump touches no sub-schema (`item`, `actor`, `floor`, `hero`, standings), so the frozen v14 literal reuses the live sub-schemas for those — the same latitude `legacyActiveRunV11Schema` / `legacyActiveRunV12Schema` already take. The next bump that touches a sub-schema must freeze that sub-schema at that time, as `legacyItemV13` did.

Additional review-driven behavior changes, folded in during Task 10:

9. **Server Wanderer death is undecided, not auto-cleared.** The plan's original gate ("clear on any conclusion") was self-defeating for a Wanderer death — it destroyed the run row and checkpoint inside the killing transition's own command, before the player could ever choose rise-again. Resolution: on the server, a Wanderer death leaves the `active_runs` row and `checkpoint_blob` in place, undecided, until the client explicitly sends `rise-again` or `accept-death`. A Wanderer victory still clears on sight (§5's gate). A reconnect mid-undecided-death re-offers the same choice from the pushed snapshot rather than silently resolving it either way.
10. **`accept-death` is sent by `ProfileSession` only from the player's own accept choice.** It is a fire-and-forget send, which can drop on a socket that is already closing (e.g. tab close mid-choice). This self-heals via the reconnect re-offer in (9) — a dropped `accept-death` just leaves the death undecided until the next connection, which is known, accepted behavior rather than a bug to chase.
11. **`expectedRevision` on `rise-again`/`accept-death` is validated but deliberately not enforced.** Both messages carry it per the mandatory-field rule in amendment 2, but the rewind target is always the stored checkpoint, not a revision-addressed state — the real precondition is that the run's `conclusion !== null` (i.e. a death is in fact pending). Rejecting on a stale `expectedRevision` here would only make an already-agreed-on rewind fail for no safety benefit.
12. **Guest-side hardening beyond the spec's checkpoint section.** The guest checkpoint-quota failure degrades exactly as specified (drop + log line, continue playing) on every write path, not just the common one. The checkpoint is cleared on every conclusion path (finalize, Wanderer accept-death, Wanderer rise-again's pre-swap clear-then-rewrite), not only "run end and new run" as originally phrased. Both the guest and the server checkpoint carry a `runSeed` guard so a rise can never restore a checkpoint belonging to a different run than the one currently live (`fix: refuse a rise from another run's checkpoint`).
13. **Both tiers allow repeated rises from the same floor-entry checkpoint.** Rising does not clear or advance the checkpoint — only reaching the next floor-entry transition overwrites it, and only a conclusion (finalize or accept-death) clears it. A Wanderer can die on the same floor repeatedly and rise from the same checkpoint each time; this is intended, not a missed invalidation.

## Server-admin note

`active_runs.checkpoint_blob` (migration 5, nullable `text` column, additive `alter table`): `null` for every Classic run and for a Wanderer run before its first floor-entry checkpoint; holds the full `encodeActiveRun` string of the last completed floor entry for a live Wanderer run otherwise. Cleared together with the rest of the row on finalize and on accept-death — never left dangling once a run concludes. See `docs/server-admin/authentication.md` for where this is documented alongside the rest of the server's persistent per-profile state.
