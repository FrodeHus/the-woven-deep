# Batched Travel Intents — Design

**Source:** follow-up to `2026-08-04-registered-mode-latency-design.md` ("step 3"), after the payload work landed in PR #216. **Date:** 2026-08-04. **Status:** approved, implemented.

Built with the approved answers: cap 16, `travel.ts`/`explore.ts` moved wholesale into session-core, stairs-travel excluded, held-key coalescing (Component 3) deferred.

Two things changed during implementation. The reply is **one ordinary `state` message per applied step followed by `travel-ended`**, rather than a bespoke batch message: it needed no new snapshot machinery, the client already renders `state` frames, and the floor patches from PR #216 chain naturally because the connection's encoder sees them in order. And because those frames arrive in one burst, `ProfileSession` **queues and paces them** at the mode's step interval — otherwise a 16-step batch renders as a teleport rather than a walk, since `useAutoTravel`'s existing pacing only ever covered dispatches it made itself.

## Goal

Collapse an auto-walk from one WebSocket round trip **per step** into one round trip per **chunk of steps**. The payload work made each reply small; this makes there be far fewer of them. It is the last structural source of registered-mode sluggishness that carries no anti-cheat cost — the server still validates every single step, it just stops asking permission between them.

## The measurement

Auto-explore on depth 1 (real content pack, seed `[7,14,21,28]`, no auto-pickup, classic stop set), counting steps until a stop rule fired:

| Leg | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Steps | 2 | 298 | 60 | 40 | 3100 | 1000 | 500 | 500 |

**Total 5,500 steps across 8 legs; mean 688, max 3,100.** Legs ended on `light` (3), `hunger` (3), `hero-damaged` (1), `blocked` (1).

Every one of those steps is a round trip today. At a 100 ms RTT the 298-step leg is ~30 seconds of waiting and the 3,100-step leg is over five minutes — for a walk the engine itself resolves in milliseconds. This is why auto-explore feels far worse than manual play over a remote server even after the payload fix: manual play costs one round trip per *keypress*, but auto-explore costs one per *simulated turn*.

(The floor was comparatively quiet — more monsters means shorter legs. Even so, legs are hundreds of steps.)

## The enabler

Batching only works if the server can decide *when to stop* exactly as the client does. It can, and with less restructuring than expected:

- `baseStopPredicate`, `classicStopPredicate` and `computeExplorePath` are **pure functions of `GameplayProjection` (+ `PublicEvent[]`)**. They read no client state and no hidden run state.
- `apps/web/src/session/projection-view.ts` is literally `export * from '@woven-deep/session-core'`, so `travel.ts` and `explore.ts` already depend only on helpers the server has.
- The one piece of genuine client state, `AutoPickupPolicy`, is built by `createAutoPickupPolicy({ pack, allowConsumables })` — so the wire needs a single boolean, and the server rebuilds the identical policy.

So `travel.ts` and `explore.ts` move to `@woven-deep/session-core` essentially as-is. **Both modes then run the same code**: guest in-process, profile server-side. That shared-module move is the design's real substance — it is also what stops the two modes from drifting apart, which they otherwise inevitably would.

## Component 1 — The `travel` client message

```ts
| {
    readonly type: 'travel';
    readonly commandId: string;
    readonly expectedRevision: number;
    /** 'travel' walks a fixed clicked path; 'explore' re-plans a frontier path every step;
     *  'stairs' walks to a discovered stair. Mirrors the existing `TravelMode`. */
    readonly mode: TravelMode;
    /** The planned path for 'travel'/'stairs'. Omitted for 'explore', which re-plans server-side. */
    readonly steps?: readonly Point[];
    readonly onArrive: 'pickup' | null;
    /** Rebuilds the server's `AutoPickupPolicy`; the whole of that policy's client state. */
    readonly autoPickup: { readonly allowConsumables: boolean } | null;
    /** Items the player has already declined, so a walk does not re-halt on each of them.
     *  Client-owned and per-floor (see `useAutoTravel`); sent because only the client knows it. */
    readonly offeredItemIds: readonly string[];
  }
```

The reply is **one ordinary `state` message per applied step**, followed by:

```ts
| {
    readonly type: 'travel-ended';
    /** null when only the cap was reached, so the walk is still viable and the client asks for
     *  the next batch. 'blocked' ends it silently, as a blocked step does today. */
    readonly reason: StopReason | 'arrived' | 'blocked' | null;
    readonly stepsTaken: number;
    /** Item ids the walk newly offered, folded into the client's per-floor `offered` set. */
    readonly offeredItemIds: readonly string[];
  }
```

Reusing `state` rather than inventing a batch envelope means no new snapshot machinery: the client already renders those frames, each carries its own `lastEvents` so the log reads exactly as it does today, and the floor patches from PR #216 chain naturally because the connection's encoder sees the steps in order.

Per-step command ids are the batch's id suffixed `:i`. The separator must stay inside the save schema's id pattern (`[a-z0-9._:-]`) — a `/` is rejected on persist, and during implementation that surfaced only as a dead connection rather than a clear error.

## Component 2 — The chunk cap (the real trade)

**Batching costs interruptibility.** Today the player can abort an auto-walk between any two steps. With a batch in flight the steps are already applied server-side, so an abort can overshoot by up to the batch size.

This is bounded but not eliminated, and the mitigation is the stop set itself: every *dangerous* interruption (hostile appeared, hero damaged, light failing, sound heard) already ends the batch server-side. Overshoot therefore only happens in conditions the rules consider safe — the "I changed my mind" abort, not the "I'm about to die" one.

**Proposed cap: 16 steps per batch.** On the measured legs that turns 5,500 round trips into ~344 — a **16x reduction** — while keeping worst-case abort overshoot to 16 turns of safe walking. The cap is a single constant; it should be easy to retune once the change can be felt over a real connection.

I would not go to "whole leg in one message" even though it is tempting: a 3,100-step leg would be uninterruptible, would produce an enormous `lastEvents` array, and would make the walk feel like a cutscene rather than something the player is doing.

## Component 3 — Held-key navigation: coalesce, do not debounce

The same machinery applies to a held or rapidly-tapped movement key, because a held key **is** a straight-line travel path. But the obvious framing — "debounce, then send once the player pauses" — is the wrong primitive, and it is worth being precise about why.

**What happens today.** Two throttles stack:

- `createKeyDispatcher` drops `event.repeat` keydowns arriving within `REPEAT_INTERVAL_MS` (80 ms), capping input at ~12.5 steps/sec.
- `ProfileSession.dispatch` allows one command in flight with a **size-1, latest-wins** queue. Repeats that arrive during a round trip overwrite each other, so at most one step survives per round trip.

So held-key movement runs at one step per RTT. At 100 ms that is ~10 steps/sec against the input layer's 12.5 — barely noticeable. At 300 ms it is ~3.3 against 12.5, roughly **4x slower than guest mode**, and every dropped repeat is a step the player asked for and did not get. (Derived from the two constants above, not yet measured over a real link — worth confirming before acting on it.)

**Why not debounce.** Debouncing waits for a pause before issuing the intent, which adds that wait to the *first* step of every press. Pressing a direction must move the hero immediately; deliberately delaying it trades a throughput problem for an input-lag problem, which is the worse of the two in a game where one keypress is one turn.

**Coalesce instead:**

1. The first press dispatches immediately, exactly as today — no added latency, ever.
2. Repeats arriving while that command is in flight **accumulate a count** instead of overwriting each other.
3. When the reply lands, the accumulated run goes out as one batched intent of N steps in that direction.

This keeps the first step instant and recovers the steps latest-wins currently discards, at one round trip per batch instead of per step.

**The catch this creates, and the fix.** Latest-wins is not an oversight — its doc comment states the intent plainly: *"releasing the key never replays a backlog of queued steps."* Accumulating reintroduces exactly that rubber-banding: release the key and the hero keeps walking through a queue the player has already stopped asking for.

Coalescing is therefore only safe if **keyup cancels the pending remainder**, which needs keyup tracking the input layer does not have today (it reads `event.repeat` on keydown and nothing else). That is a small addition, but it is a real prerequisite, not a detail — without it this change makes held-key navigation worse, not better.

**The stop set matters here too.** A held-key batch must use `baseStopPredicate` (stop on damage or a newly-appeared hostile), not the classic set. Holding a direction into a monster currently auto-attacks it one round trip at a time, which at least lets the player react between blows; batching eight attacks with no chance to disengage would be a straight downgrade.

**Sequencing.** The win here is much smaller than auto-explore's — bounded by how long a human holds a key, and near-parity with guest mode at low latency. Auto-explore's 5,500 round trips are the problem worth solving first. I would land that, measure over a real connection, and only then decide whether held-key coalescing earns its keyup plumbing.

## Component 4 — Idempotency

A batch is N engine commands but ONE client-minted `commandId`, so it does not fit `recentCommands` as-is. Two options, and I recommend the first:

1. **Derive per-step ids** — step *i* of batch `command.profile-000000042` applies as `command.profile-000000042/i`. The reducer's existing dedup then works unchanged, a replayed batch is idempotent step-for-step, and `nextCommandSequenceFor`'s regex (which anchors on digits-only) simply ignores them, so the seeding fix from PR #216 is unaffected.
2. Record the batch's own id with its step count and treat a repeat as a no-op. Fewer ids in the window, but it introduces a second idempotency mechanism alongside the existing one.

`expectedRevision` is checked once, against the batch's first step — the rest are sequential by construction.

## Non-goals

- **No new authority.** Every step is still `resolveCommand` against the server's run. Batching changes *when the client is asked*, never *who decides*.
- **No prediction**, no client-side engine. Unchanged from the previous design.
- **No new stop rules**, and no change to any existing one — this is a relocation, not a redesign. Behaviour must be identical to today's, which is what the parity test below is for.
- **No engine, save-schema, or content change.**
- **No change to manual play**, which already costs one round trip per keypress and cannot be improved without prediction.

## Testing

- **Guest/profile parity (load-bearing).** Run the same seed and the same auto-explore through the guest in-process path and through a batched server session; assert an identical command stream and byte-identical `encodeActiveRun` at the end. The existing `determinism-parity.test.ts` is the obvious model.
- **Stop-rule parity.** For each `StopReason`, construct the triggering condition and assert the batch ends on exactly the step the current one-at-a-time loop ends on.
- **Cap behaviour** — a walk longer than the cap returns `reason: null` with `stepsTaken` equal to the cap, and the client's follow-up batch resumes seamlessly.
- **Abort** — a batch in flight followed by a player intent does not double-apply, and the client's cursor reconciles from `stepsTaken` rather than from its own optimistic count.
- **Round-trip regression** — pin the round trips for a scripted explore, so a future change that quietly reverts to per-step dispatch fails CI.

## Open decisions

1. **Chunk cap value** — 16 proposed; it trades round trips against abort overshoot and is worth an opinion from someone who has played it.
2. **Does `travel.ts` move wholesale to session-core, or only its pure core?** Wholesale is simpler and keeps guest/profile identical; it does mean `session-core` gains the planning code that is today web-only. I lean wholesale.
3. **Should the stairs mode batch at all?** Its path is short and already known; the win is smaller and it may not be worth the surface.
4. **Is held-key coalescing (Component 3) in scope now or later?** It needs keyup tracking in the input layer as a prerequisite, and its payoff only becomes real above ~200 ms RTT. My recommendation is later, after auto-explore batching can be measured over a real connection.
