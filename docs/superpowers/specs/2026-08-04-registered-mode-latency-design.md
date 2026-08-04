# Registered-Mode Latency — Design

**Source:** playtest report, 2026-08-03 ("navigation is horribly slow in registered sessions, sometimes stuck on 'That action has already been handled'"). **Date:** 2026-08-04. **Status:** approved, implemented.

Built as specified. `permessage-deflate` (listed under "Alternatives considered") was also enabled, and composes with the delta work rather than replacing it: deflate cut the whole-floor reply ~15x, and the deltas cut what has to be compressed in the first place.

## Goal

Make signed-in play over a remote server feel like guest play. The freeze half of the report is already fixed (PR #216 — the command-id counter now seeds from the server's retained window). This design addresses the other half: **the per-turn payload**.

The server stays authoritative. Nothing here moves the engine, the seed, or hidden state to the client, so no anti-cheat property is traded away for latency.

## The measurement

Measured against the real content pack, a fresh run, `DEFAULT_GUEST_HERO`, seed `[7,14,21,28]` (throwaway harness; numbers reproduced below so the design does not rest on estimates):

| Depth | Grid | Whole projection | `floor.cells` | Known cells | Bytes that carry information |
| --- | --- | --- | --- | --- | --- |
| 0 (town) | 34×16 = 544 | 55,986 B | 51,233 B (91.5%) | 251 | 32,749 B |
| 1 | 160×50 = 8,000 | 526,922 B | 523,374 B (99.3%) | 54 | 7,094 B |
| 3 | 160×50 = 8,000 | 527,367 B | 524,034 B (99.4%) | 64 | 8,404 B |
| 6 | 160×50 = 8,000 | 526,640 B | 523,308 B (99.4%) | 53 | 6,884 B |

**Every command reply on a dungeon floor is ~527 KB of JSON, of which ~1.3% describes anything the player can perceive.** The remaining ~516 KB is 7,946 repetitions of `{"index":N,"x":N,"y":N,"knowledge":"unknown","intensity":0}`. Guest mode builds the identical array and never serializes it, which is exactly why only registered play feels bad.

Walking a real hero 36 steps on depth 1 and diffing consecutive projections:

- changed cells per move: **mean 51.1, max 63**
- changed-cell JSON per move: **mean 6,619 B, max 8,159 B**
- **delta / full snapshot = 1.25%**
- everything in `ServerRunSnapshot` *other than* `floor.cells`: **~3,332 B** — already small enough to ship whole

Two consequences drive the whole design:

1. The non-cell remainder is ~3.3 KB. **Only the cells need delta treatment.** Everything else ships whole, every turn, unchanged. This removes most of the complexity a general delta protocol would carry.
2. A full snapshot **gets worse as the player explores**: an unknown cell costs ~65 B, a remembered one ~105 B. A fully-explored floor projects to roughly 840 KB — *larger than today*. Omitting unknown cells is therefore not sufficient on its own; only deltas bound the per-turn cost, because the delta is bounded by the hero's light radius rather than by exploration.

## Non-goals

- **No client-side prediction.** Faithful prediction requires the full actor set and live RNG state; handing the client those is precisely the foreknowledge cheat the server-authoritative model exists to prevent. Narrow hero-displacement prediction may be revisited *after* measuring the result of this work — it is not part of it.
- **No binary framing.** Deferred to a follow-up; the payload win here is large enough that a wire-format change should be justified by a fresh measurement, not by assumption.
- **No replay verification.** The previously-discussed model (client runs the engine, server replays the command log to verify) is superseded: it only pays for itself if the engine moves client-side, which this design deliberately avoids. Revisit only if prediction is ever adopted.
- **No engine changes, no save-schema bump, no content bump.** `projectFloor` keeps returning whole floors in-process; this is a wire concern only. The demo fixture hashes are untouched.
- **No change to the run's authority, persistence cadence, or checkpoint model.**

## Component 1 — Full syncs omit unknown cells

`ServerRunSnapshot.projection.floor` gains an explicit convention on the wire: **only cells with `knowledge !== 'unknown'` are transmitted; the client materialises the remainder as unknown from `width`/`height`.**

This is a pure encode/decode pair around the existing `ObservableFloorProjection`, applied at the `ws-protocol` boundary. `projectFloor` is unchanged, and the client reconstructs an array indistinguishable from the server's.

Effect on the message the client sees today: depth 1 floor entry goes 527 KB → ~10.4 KB.

## Component 2 — Revision-keyed cell patches

A new server → client message carries the ordinary snapshot with the cell array replaced by the cells that changed:

```ts
| {
    readonly type: 'patch';
    /** The revision the client MUST already hold for this patch to apply. */
    readonly baseRevision: number;
    readonly snapshot: ServerRunSnapshotPatch;
  }
```

`ServerRunSnapshotPatch` is `ServerRunSnapshot` with `projection.floor.cells` replaced by:

```ts
readonly floorId: OpaqueId;
/** Whole-cell replacements keyed by `index`. A cell that has reverted to unknown
 *  (light-out with `rememberedMapPersists: false`) appears here as an ordinary
 *  `knowledge: 'unknown'` cell — replacement, never field-level merging. */
readonly changedCells: readonly ObservableCell[];
```

**Whole-cell replacement, not field-level diffs.** Cells are small and uniform; per-field patching would buy a few hundred bytes and cost a merge semantics nobody can review. Replacement also expresses reversion-to-unknown for free.

**Server state.** `ServerPlaySession` retains the last cell array it transmitted, plus the floor id and revision it belongs to. Per connection, in memory only — nothing persisted, nothing in the save blob. On reconnect the cache is simply absent and a full sync is sent, which is already the reconnect behaviour.

**Server sends a full `state` instead of a `patch` when:** there is no cached array; the active floor id differs (floor change); the cached revision is not the client's current revision; the run's revision moved backwards (Wanderer `rise-again`); or the client asked for one.

**Client.** `ProfileSession` retains the last materialised cell array. On `patch`, it verifies `baseRevision` equals its cached revision and `floorId` matches; on mismatch it discards and sends `{ type: 'resync' }`, to which the server replies with a full `state`. The mismatch path is a correctness backstop, not an expected occurrence — single-command-in-flight plus newest-wins eviction means it should not fire in normal play, and it is cheap when it does.

Expected steady-state reply: ~3.3 KB non-cell + ~6.6 KB changed cells ≈ **10 KB, down from 527 KB — a ~52× reduction**, and one that stays flat as the floor is explored rather than growing.

## Component 3 — Protocol version

`PROTOCOL_VERSION` 2 → 3. The `hello` handshake already refuses a client whose protocol version diverges, so a stale client fails loudly at connect rather than mis-decoding a patch. No migration path is needed — there is no stored protocol state.

## Error handling

- **Patch arriving out of order or against the wrong base** — client discards, requests `resync`, server sends full `state`. Never a partial apply.
- **Patch for a floor the client is not on** — same path; `floorId` is checked before `baseRevision`.
- **Unknown message type on either side** — existing behaviour (client refuses at `hello` on version mismatch; server's message validation rejects).
- **A `resync` storm** — if a client requests resync repeatedly the cost degrades to today's behaviour, which is slow but correct. No new failure mode is introduced.

## Testing

- **Parity (the load-bearing test).** Drive a session through a scripted command sequence covering movement, floor change, light-out, and Wanderer rewind; after every reply, assert the client-reconstructed cell array is **deeply equal** to the server's `projectFloor` output. This is the invariant the whole design rests on.
- **Unknown-omission round-trip** — encode/decode a floor and assert equality with the original projection, including a fully-explored floor and an all-unknown floor.
- **Reversion to unknown** — light-out with `rememberedMapPersists: false` produces `knowledge: 'unknown'` entries in `changedCells` and the client applies them.
- **Resync path** — a client holding a stale revision receives a full `state` and converges.
- **Floor change** — descending yields a full sync, never a patch against the previous floor.
- **Payload assertion** — a regression test pinning per-move reply bytes under a threshold (say 32 KB), so a future field addition that reintroduces whole-floor shipping fails CI rather than a playtest.

## Cross-device roaming (previously open)

Unaffected, and worth stating because it constrained earlier designs: the authoritative `ActiveRun` continues to live in SQLite and the delta cache is per-connection, ephemeral, and rebuilt from a full sync on connect. A player moving between devices gets a full sync and correct state with no extra machinery.

## Alternatives considered

- **WebSocket `permessage-deflate`.** A configuration change, not a code change, and the payload is pathologically compressible (7,946 near-identical unknown cells), so it would plausibly cut the wire bytes by an order of magnitude for nearly no work. It is a reasonable thing to turn on regardless. It is not a substitute for this design: it leaves the server serialising 8,000 objects per turn and the client parsing them, so CPU and GC cost stay, and the payload still grows with exploration. Recommendation: **enable it as well**, and measure — but do not let it stand in for the delta work.
- **Trimming per-cell fields** (dropping `x`/`y`, derivable from `index` and `width`; interning `glyph`/`token`). Real, but ~30% on a payload that Component 2 has already cut 50×. Deferred until measurement says the remaining 10 KB matters.
- **Shipping unknown cells as a run-length or bitmask encoding** rather than omitting them. Equivalent outcome to Component 1 with more machinery.

## Follow-up (not in this design)

- **Batched travel intents.** The client already owns `travel.ts`/`explore.ts` route planning; sending a whole route as one intent and receiving one reply collapses many round trips into one at zero anti-cheat cost. For a turn-based game this may matter more than prediction ever would, and it composes with everything above. Worth a design of its own once this lands and the improvement is measured.
- Binary framing; narrow hero-displacement prediction. Both gated on post-landing measurement.
