# NPC Dialogue (#79) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Talk to the travelling lampwright through an authored topic-based conversation with three light consequences (nudge reputation once, reveal a Codex lore entry, open trade).

**Architecture:** A new `dialogue` content kind + a `dialogueId?` on NPCs. The conversation is mostly CLIENT: a self-contained `DialogueScreen` overlay walks the authored tree from the content pack + the projection (adjacency), with per-open React state; `reveal-lore` and topic traversal never touch the engine. ONLY the reputation consequence crosses into the deterministic engine — a `dialogue-consequence` command validated like `merchantSession()` (adjacent, non-hostile, perceived), re-deriving the faction/amount authoritatively from content, guarded one-time by an omit-when-empty field on the NPC's merchant population. `open-trade` reuses `trade-open`.

**Tech Stack:** TypeScript 5.8 (strict + exactOptionalPropertyTypes), ESM `.js` specifiers, Zod v4 STRICT, Vitest + jsdom (web), deterministic engine. Workspaces: `@woven-deep/content`, `@woven-deep/engine`, `@woven-deep/session-core`, `apps/web`, `apps/server`.

## Global Constraints

- **Determinism is a hard invariant.** Adding the `dialogue` kind with NO entries + the optional `dialogueId`/save fields does NOT change the compiled content hash or any demo fixture (Tasks 1-3 keep all 8 demos byte-identical). ONLY authoring the lampwright's dialogue + linking `dialogueId` (Task 4) shifts the content hash → benign content-hash-embed fixture regen. The `dialogue-consequence` command + the omit-when-empty save field are behavior-neutral until a consequence fires — the demo hero never talks. Parity harness green throughout.
- **Anti-cheat:** the `dialogue-consequence` command carries only `npcActorId` + `topicId`; the engine re-derives the reputation faction/amount from content (never trusts a client-supplied value) and validates adjacency/non-hostility/perception exactly like `merchantSession()`.
- **Save-schema:** the new `dialogueConsequencesApplied?: readonly OpaqueId[]` on `MerchantPopulation` is an OPTIONAL, omit-when-empty field (the `Hero.knownSpellIds` pattern) — backward-compatible, so **NO `SAVE_SCHEMA_VERSION` bump and NO migration** (old saves lack it → optional → valid). A round-trip test proves an old-shape merchant population (no field) decodes, and a populated one round-trips.
- STRICT content validation; every referenced id resolves. `npx prettier --write` changed files; full `npm run verify` (tsc across all 5 workspaces — vitest does NOT typecheck) must pass before each commit.
- **Process:** run `npm run verify` and demos FOREGROUND to completion — never background them and idle.
- **Fixture-regen recipe** (Task 4 only): build content+engine, run each demo WITHOUT `--verify` (writes candidate hashes to a temp path), diff vs the reviewed fixture, copy only the intended/benign content-hash-embed moves, re-run `--verify`.

---

### Task 1: The `dialogue` content kind + `dialogueId` on NPCs (content package)

**Files:**
- Create: `packages/content/src/model/dialogue.ts`, `packages/content/src/compiler/schema/dialogue.ts`, `packages/content/src/compiler/validation/dialogue.ts`
- Modify: `packages/content/src/model/common.ts` (`CONTENT_KIND_IDS`), `packages/content/src/model.ts` (export + `ContentEntry` union), `packages/content/src/compiler/schema.ts` (union), `packages/content/src/compiler/validation/index.ts` (aggregate), `packages/content/src/model/npc.ts` (+`dialogueId?`), `packages/content/src/compiler/schema/npc.ts` (+`dialogueId`), `packages/content/src/compiler/validation/npc.ts` (+dialogueId cross-ref), `docs/server-admin/content-configuration.md` (dialogue section), `packages/content/test/default-content.test.ts` (kinds + counts)
- Test: `packages/content/test/dialogue.test.ts` (create)

**Interfaces:**
- Produces: `DialogueContentEntry`, `DialogueTopic`, `DialogueConsequence` (exported from the content barrel); `NpcContentEntry.dialogueId?: ContentId`. Consumed by Tasks 2 (engine resolves the consequence) + 3 (client walks the tree) + 4 (content).

- [ ] **Step 1: Model**

Create `packages/content/src/model/dialogue.ts`:

```ts
import type { BaseContentEntry, ContentId } from './common.js';

export type DialogueConsequence =
  | { readonly kind: 'reputation'; readonly factionId: ContentId; readonly amount: number }
  | { readonly kind: 'reveal-lore'; readonly contentId: ContentId }
  | { readonly kind: 'open-trade' };

export interface DialogueTopic {
  readonly id: string;
  readonly prompt: string;
  readonly response: string;
  readonly reveals?: readonly string[];
  readonly consequence?: DialogueConsequence;
  readonly once?: boolean;
}

export interface DialogueContentEntry extends BaseContentEntry {
  readonly kind: 'dialogue';
  readonly greeting: string;
  readonly topics: readonly DialogueTopic[];
}
```

In `packages/content/src/model.ts`: add `export * from './model/dialogue.js';` (alongside the other `model/*` re-exports), add `import type { DialogueContentEntry } from './model/dialogue.js';` to the per-kind import block (~lines 1-17), and add `| DialogueContentEntry` to the `ContentEntry` union (~lines 164-181).

In `packages/content/src/model/common.ts`, add `'dialogue'` to `CONTENT_KIND_IDS` (~line 22-41).

In `packages/content/src/model/npc.ts`, add `readonly dialogueId?: ContentId;` to `NpcContentEntry` (import `ContentId` if not already).

- [ ] **Step 2: Schema**

Create `packages/content/src/compiler/schema/dialogue.ts`:

```ts
import { z } from 'zod';
import { base, stableIdSchema } from './common.js';

const dialogueConsequence = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('reputation'), factionId: stableIdSchema, amount: z.number().int() }),
  z.strictObject({ kind: z.literal('reveal-lore'), contentId: stableIdSchema }),
  z.strictObject({ kind: z.literal('open-trade') }),
]);

const dialogueTopic = z.strictObject({
  id: z.string().trim().min(1).max(64),
  prompt: z.string().trim().min(1).max(120),
  response: z.string().trim().min(1).max(600),
  reveals: z.array(z.string().trim().min(1)).readonly().optional(),
  consequence: dialogueConsequence.optional(),
  once: z.boolean().optional(),
});

export const dialogueEntry = z.strictObject({
  ...base,
  kind: z.literal('dialogue'),
  greeting: z.string().trim().min(1).max(600),
  topics: z.array(dialogueTopic).min(1).readonly(),
});
```

In `packages/content/src/compiler/schema.ts`: `import { dialogueEntry } from './schema/dialogue.js';` and add `dialogueEntry` to the `contentSourceEntrySchema` discriminated union (~lines 35-53).

In `packages/content/src/compiler/schema/npc.ts`, add `dialogueId: stableIdSchema.optional(),` to `npcEntry` (~lines 35-52; `stableIdSchema` is already imported there or in `./common.js`).

- [ ] **Step 3: Validation**

Create `packages/content/src/compiler/validation/dialogue.ts`:

```ts
import type { ContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { issue, referencedKindIssue, type LocatedContentEntry } from './shared.js';

export function dialogueIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'dialogue') continue;
    const topicIds = new Set(entry.topics.map((topic) => topic.id));
    const seen = new Set<string>();
    for (const topic of entry.topics) {
      const path = `$.entries.${entry.id}.topics.${topic.id}`;
      if (seen.has(topic.id)) issues.push(issue(file, `${path}.id`, `duplicate topic id ${topic.id}`));
      seen.add(topic.id);
      for (const target of topic.reveals ?? []) {
        if (!topicIds.has(target)) issues.push(issue(file, `${path}.reveals`, `unknown topic ${target}`));
      }
      const consequence = topic.consequence;
      if (consequence?.kind === 'reputation')
        issues.push(...referencedKindIssue(file, `${path}.consequence.factionId`, consequence.factionId, 'npc-faction', byId));
      if (consequence?.kind === 'reveal-lore') {
        const target = byId.get(consequence.contentId);
        if (!target)
          issues.push(issue(file, `${path}.consequence.contentId`, `unknown reference ${consequence.contentId}`));
        else if ((target.kind !== 'monster' && target.kind !== 'item') || target.lore == null)
          issues.push(issue(file, `${path}.consequence.contentId`, `reveal-lore ${consequence.contentId} must be a monster or item with authored lore`));
      }
    }
  }
  return issues;
}
```

In `packages/content/src/compiler/validation/npc.ts` `npcIssues`, after the existing `factionId` check, add the dialogue cross-ref:

```ts
    if (entry.dialogueId !== undefined)
      issues.push(...referencedKindIssue(file, `$.entries.${entry.id}.dialogueId`, entry.dialogueId, 'dialogue', byId));
```

In `packages/content/src/compiler/validation/index.ts`: `import { dialogueIssues } from './dialogue.js';` and `issues.push(...dialogueIssues(locatedEntries, byId));` right after the `npcIssues(...)` push.

- [ ] **Step 4: Docs + count fixtures**

In `docs/server-admin/content-configuration.md`, add a `dialogue` section documenting the kind (so `admin-docs.test.ts`'s literal-substring check for every `CONTENT_KIND_IDS` id passes). Follow the format of an existing kind's section; describe `greeting`, `topics[]` (`id`/`prompt`/`response`/`reveals`/`consequence`/`once`), the three consequence kinds, and the NPC `dialogueId` link.

In `packages/content/test/default-content.test.ts`: add `'dialogue'` to the `kinds` tuple and `dialogue: 0` to the expected-count object (no dialogue content exists until Task 4).

- [ ] **Step 5: Content compile test (TDD)**

Create `packages/content/test/dialogue.test.ts`: compile an in-memory content fixture (mirror an existing compile test's fixture-build helper) with a `dialogue` entry + an NPC linking it, and assert: it compiles; a dangling `dialogueId`, a `reveals` targeting a nonexistent topic, a `reputation` consequence with an unknown faction, and a `reveal-lore` pointing at a non-lore entry each produce a compile issue. Follow the rejection-test shape in `packages/content/test/compile-directory.test.ts`.

Run: `npm run test --workspace @woven-deep/content`
Expected: PASS (the real `content/` still has zero dialogue entries → `dialogue: 0` holds; the fixture tests pass).

- [ ] **Step 6: Verify + commit**

`npm run verify` (all workspaces typecheck — the new exported types must resolve everywhere). No demo fixtures change (no content-hash shift: the kind has no entries, `dialogueId` is unset).

```bash
npm run verify
npx prettier --write packages/content/ docs/server-admin/content-configuration.md
git add packages/content/ docs/
git commit -m "feat(content): dialogue content kind + npc dialogueId"
```

---

### Task 2: The `dialogue-consequence` engine command (engine package)

**Files:**
- Modify: `packages/engine/src/commerce.ts` (reason union) + `packages/engine/src/events-model.ts` (`ReputationChangedEvent.reason`), `packages/engine/src/commands-model.ts` (command + unions), `packages/engine/src/merchant-model.ts` (`MerchantPopulation` field), `packages/engine/src/save-schema/merchant.ts` (schema field), `packages/engine/src/reducer.ts` (short-circuit)
- Create: `packages/engine/src/dialogue.ts` (`isDialogueCommand`, `validateDialogueCommand`, `applyDialogueConsequence`)
- Test: `packages/engine/test/dialogue-consequence.test.ts` (create)

**Interfaces:**
- Consumes: `DialogueContentEntry` + `NpcContentEntry.dialogueId` (Task 1); `MerchantPopulation.npcId` → NPC content; `changeReputation`; `merchantSession`-style validation.
- Produces: `DialogueConsequenceCommand { type: 'dialogue-consequence', npcActorId, topicId }`; `MerchantPopulation.dialogueConsequencesApplied?: readonly OpaqueId[]`.

- [ ] **Step 1: Extend the reputation reason union**

In `packages/engine/src/commerce.ts` (`changeReputation` input `reason`, ~line 134) and `packages/engine/src/events-model.ts` (`ReputationChangedEvent.reason`, ~line 628), change `'commerce' | 'aggression' | 'death'` → `'commerce' | 'aggression' | 'death' | 'dialogue'`.

- [ ] **Step 2: The command + population field**

In `packages/engine/src/commands-model.ts`, add next to `TradeCommand`:

```ts
export interface DialogueConsequenceCommand extends CommandEnvelope {
  readonly type: 'dialogue-consequence';
  readonly npcActorId: OpaqueId;
  readonly topicId: string;
}
```

Add `| DialogueConsequenceCommand` to the `GameCommand` union (~line 175), and add a `'dialogue.unavailable' | 'dialogue.out-of-range' | 'dialogue.invalid-topic'` group to `InvalidActionReason` (~lines 208-232), mirroring `TradeInvalidReason`.

In `packages/engine/src/merchant-model.ts`, add to `MerchantPopulation`:
`readonly dialogueConsequencesApplied?: readonly OpaqueId[];`

- [ ] **Step 3: The dialogue module (validate + apply)**

Create `packages/engine/src/dialogue.ts`. `validateDialogueCommand` mirrors `merchantSession`'s adjacency/non-hostile/perceived/same-floor checks (reuse the same helpers — import `merchantPerceived`, `relationshipBetween`, `heroActor`), resolves the consequence authoritatively from content, and enforces the one-time guard:

```ts
import type { CompiledContentPack, DialogueContentEntry, NpcContentEntry } from '@woven-deep/content';
import type { ActiveRun, DomainEvent, GameCommand, OpaqueId } from './model.js';
import type { DialogueConsequenceCommand } from './commands-model.js';
import type { MerchantPopulation } from './merchant-model.js';
import { changeReputation } from './commerce.js';
import { heroActor } from './actor-model.js';
// import merchantPerceived, relationshipBetween, merchantFaction from their modules (mirror trade.ts imports)

export function isDialogueCommand(command: GameCommand): command is DialogueConsequenceCommand {
  return command.type === 'dialogue-consequence';
}

type DialogueValidation =
  | Readonly<{ ok: true; population: MerchantPopulation; faction: /* NpcFactionContentEntry */ unknown; amount: number }>
  | Readonly<{ ok: false; reason: 'dialogue.unavailable' | 'dialogue.out-of-range' | 'dialogue.invalid-topic' }>;

export function validateDialogueCommand(
  input: Readonly<{ state: ActiveRun; command: DialogueConsequenceCommand; content: CompiledContentPack }>,
): DialogueValidation {
  const { state, command, content } = input;
  const hero = heroActor(state);
  const population = state.populations.find(
    (candidate): candidate is MerchantPopulation =>
      candidate.model === 'merchant' && candidate.actorId === command.npcActorId,
  );
  const actor = state.actors.find((candidate) => candidate.actorId === command.npcActorId);
  if (!population || !actor || actor.populationId !== population.populationId || actor.health <= 0)
    return { ok: false, reason: 'dialogue.unavailable' };
  // same-floor + Chebyshev-adjacent + non-hostile + perceived (mirror merchantSession exactly)
  if (
    population.floorId !== state.activeFloorId ||
    actor.floorId !== hero.floorId ||
    Math.max(Math.abs(actor.x - hero.x), Math.abs(actor.y - hero.y)) !== 1 ||
    relationshipBetween(state, hero.actorId, actor.actorId) === 'hostile' ||
    !merchantPerceived(state, content, hero, actor)
  )
    return { ok: false, reason: 'dialogue.out-of-range' };
  // Re-derive the consequence from content (anti-cheat): npc -> dialogueId -> dialogue -> topic -> consequence
  const npc = content.entries.find(
    (entry): entry is NpcContentEntry => entry.kind === 'npc' && entry.id === population.npcId,
  );
  const dialogue = npc?.dialogueId
    ? content.entries.find(
        (entry): entry is DialogueContentEntry => entry.kind === 'dialogue' && entry.id === npc.dialogueId,
      )
    : undefined;
  const topic = dialogue?.topics.find((candidate) => candidate.id === command.topicId);
  if (!topic || topic.consequence?.kind !== 'reputation')
    return { ok: false, reason: 'dialogue.invalid-topic' };
  if ((population.dialogueConsequencesApplied ?? []).includes(command.topicId))
    return { ok: false, reason: 'dialogue.invalid-topic' }; // already applied -> no-op reject
  const faction = merchantFaction(content, topic.consequence.factionId);
  return { ok: true, population, faction, amount: topic.consequence.amount };
}

export function applyDialogueConsequence(
  input: Readonly<{ state: ActiveRun; command: DialogueConsequenceCommand; content: CompiledContentPack }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const validation = validateDialogueCommand(input);
  if (!validation.ok) throw new Error('internal invariant: applyDialogueConsequence on an invalid command');
  const changed = changeReputation({
    run: input.state,
    faction: validation.faction as never,
    delta: validation.amount,
    reason: 'dialogue',
    eventId: input.command.commandId,
  });
  const populations = changed.state.populations.map((population) =>
    population.populationId === validation.population.populationId
      ? {
          ...population,
          dialogueConsequencesApplied: [
            ...((population as MerchantPopulation).dialogueConsequencesApplied ?? []),
            input.command.topicId,
          ],
        }
      : population,
  );
  return { state: { ...changed.state, populations }, events: [changed.event] };
}
```

> Implementer note: confirm the exact import names/paths for `merchantPerceived`, `relationshipBetween`, `merchantFaction` (grep `trade.ts` imports); fix the `faction`/`NpcFactionContentEntry` typing (replace the `unknown`/`as never` placeholders with the real `NpcFactionContentEntry` type). The validation logic + the anti-cheat re-derivation are the contract; match the real helper signatures.

- [ ] **Step 4: Reducer short-circuit**

In `packages/engine/src/reducer.ts`, add a short-circuit block mirroring the `isTradeCommand` block (~lines 204-238) — placed adjacent to it — that handles `isDialogueCommand(command)`: validate via `validateDialogueCommand`; on failure `recordInvalid(...)` with the reason; on success apply `applyDialogueConsequence`, advance the revision ONLY (no turn/worldTime/energy/survival — exactly like trade commands), project the events, and return the applied result. Reuse the exact revision-only result shape from the trade block.

- [ ] **Step 5: Save-schema (optional field, no version bump) + tests**

In `packages/engine/src/save-schema/merchant.ts`, add to `merchantPopulationFields`:
`dialogueConsequencesApplied: z.array(identifier).readonly().optional(),`
(No `SAVE_SCHEMA_VERSION` bump: the optional field is backward-compatible — an old save without it validates.)

Create `packages/engine/test/dialogue-consequence.test.ts` (build a run + a merchant population for an NPC whose content links a dialogue with a `reputation` topic, mirroring existing trade/merchant test setup):
- applies the reputation change once (reputations updated, event `reason: 'dialogue'`);
- a second `dialogue-consequence` for the same topic is REJECTED (one-time guard) — reputation unchanged;
- adjacency/non-hostile/perceived validation rejects a non-adjacent / hostile / unperceived NPC;
- **anti-cheat:** a `topicId` absent from the dialogue, or a topic whose consequence is `open-trade`/`reveal-lore`/none, is rejected;
- save round-trip: a `MerchantPopulation` WITHOUT the field decodes and re-encodes byte-identically (omit-when-empty → non-dialogue saves unchanged); one WITH a populated `dialogueConsequencesApplied` round-trips.

- [ ] **Step 6: Verify + commit**

`npm run verify` — no demo fixtures change (no content edit; the command/field are behavior-neutral for the demo hero). Confirm parity harness green.

```bash
npm run verify
npx vitest run --root apps/server determinism-parity
npx prettier --write packages/engine/
git add packages/engine/
git commit -m "feat(engine): dialogue-consequence command applies a one-time reputation nudge"
```

---

### Task 3: Client conversation — `DialogueScreen` overlay + `talk` action (apps/web)

**Files:**
- Create: `apps/web/src/ui/screens/DialogueScreen.tsx` (self-contained: seeded from projection + pack, per-open React state)
- Modify: `apps/web/src/session/codex-storage.ts` (+ a `revealLore` insert helper), the `RunSession` interface + `GuestSession` + `ProfileSession` (a `revealLore(contentId)` method), `apps/web/src/ui/overlays/registry.ts` (+`'dialogue'`), `apps/web/src/ui/overlays/OverlayHost.tsx` (+body case), `apps/web/src/session/settings.ts` (+`'talk'` action/label/binding), `apps/web/src/ui/KeyRouter.ts` + `apps/web/src/ui/CommandPalette.tsx` (talk overlay-open, gated by `talkAvailable`), `apps/web/src/session/projection-view.ts` (a `dialogueTargetAvailable(projection)` helper mirroring `tradeIsAvailable`)
- Test: `apps/web/test/dialogue-screen.test.tsx` (create)

**Interfaces:**
- Consumes: `DialogueContentEntry`/`DialogueTopic` (Task 1) from the client `pack`; the `dialogue-consequence` intent → command (Task 2). The `talk` overlay is `scope: 'play'`, gated to an adjacent dialogue-bearing NPC.

- [ ] **Step 1: `reveal-lore` client insert**

In `apps/web/src/session/codex-storage.ts`, add a direct-insert helper (a dialogue reveal is a narrative event, NOT a perceived sighting, so it bypasses `accumulateSightings`):

```ts
export function insertSighting(prev: Sightings, pack: CompiledContentPack, contentId: string): Sightings {
  const monster = monsterById(pack, contentId);
  if (monster) return { ...prev, monsterIds: sortedUnique([...prev.monsterIds, contentId]) };
  const item = itemById(pack, contentId);
  if (item) return { ...prev, itemIds: sortedUnique([...prev.itemIds, contentId]) };
  return prev;
}
```

Add a `revealLore(contentId: string): void` method to the `RunSession` interface and both `GuestSession` and `ProfileSession`. Implementation (mirror `syncSightings`'s reveal path): if the contentId is not already in `this.sightings`, set `this.sightings = insertSighting(this.sightings, this.pack, contentId)`, persist it (`saveSightings`, as `syncSightings` does), and `this.appendReveal(revealLine(<entry name>))` (export `revealLine` from `codex-storage.ts`, or add a `loreRevealLine(pack, contentId)` helper). Idempotent (a second reveal of the same id is a no-op, no duplicate line).

- [ ] **Step 2: `DialogueScreen`**

Create `apps/web/src/ui/screens/DialogueScreen.tsx`. Props: `pack: CompiledContentPack`, `projection: GameplayProjection` (for adjacency + the NPC actor), `onDispatch: (intent: PlayerIntent) => void`, `onRevealLore: (contentId: string) => void`, `onClose: () => void`. It:
- resolves the target: the adjacent (`Chebyshev === 1`, same floor), non-hostile NPC actor in the projection whose content entry has a `dialogueId`; if none, render "No one to talk to." + a close control;
- loads that `dialogue` entry from `pack`; holds React state `revealed: Set<topicId>` (seeded to the topics reachable from the greeting — i.e. topics not gated behind a `reveals`) and `chosen: Set<topicId>`;
- renders the greeting (or the last chosen topic's `response`) + the list of currently-available topic `prompt`s (a topic is available when it's in `revealed` and, if `once`, not in `chosen`) + a "Leave" control;
- on choosing a topic: add its `reveals` to `revealed`, add it to `chosen`, show its `response`, and fire its `consequence` — `reveal-lore` → `onRevealLore(contentId)`; `open-trade` → `onDispatch({ type: 'trade-open', ... })` then `onClose()`; `reputation` → `onDispatch({ type: 'dialogue-consequence', npcActorId, topicId })` (the client-side intent; command-builder maps it — see Step 4). Reputation topics are typically `once`, so they grey out after use (the authoritative one-time guard is server-side).
- Follow `TradeScreen.tsx`'s dialog/portrait/theme-token structure; reuse existing UI primitives.

- [ ] **Step 3: Overlay registration**

In `apps/web/src/ui/overlays/registry.ts`: add `'dialogue'` to `OverlayId` and an `OVERLAY_REGISTRY.dialogue = { id: 'dialogue', title: 'Talk', scope: 'play', action: 'talk' }`.

In `apps/web/src/ui/overlays/OverlayHost.tsx` `renderBody`, add a `case 'dialogue':` that renders `<DialogueScreen pack={ctx.pack} projection={<the current projection>} onDispatch={...} onRevealLore={(id) => session.revealLore(id)} onClose={onClose} />` (thread the projection + `session` through `RenderBodyContext` if not already present — it already carries `pack` and `snapshot`).

- [ ] **Step 4: The `talk` action wiring + the intent**

- **Intent + command:** only the reputation consequence needs an engine intent. Add `{ type: 'dialogue-consequence'; npcActorId: string; topicId: string }` to the `PlayerIntent` union (`packages/session-core/src/intents.ts`, next to `trade-open`), and a command-builder branch (`packages/session-core/src/command-builder.ts`, alongside the `trade-open` branch ~lines 383-396) that maps it to the engine `DialogueConsequenceCommand` (passing `npcActorId`/`topicId` + `commandId`/`expectedRevision`). Opening the overlay is NOT an engine intent.
- **Action:** add `'talk'` to `ActionId`, `ACTION_IDS`, `ACTION_LABELS` (`talk: 'Talk'`), and `DEFAULT_BINDINGS` (a free key, e.g. `talk: chord('T', false)`) in `apps/web/src/session/settings.ts`. `talk` is an OVERLAY-OPEN action (opens the `'dialogue'` overlay via `OVERLAY_REGISTRY`), NOT an engine intent — wire it like `codex`/`inventory` opens, gated to availability.
- **Availability gate:** add `dialogueTargetAvailable(projection): boolean` to `apps/web/src/session/projection-view.ts` (mirror `tradeIsAvailable`): true when an adjacent, same-floor, non-hostile NPC actor has a `dialogueId`-bearing content entry (the client has the pack).
- **CommandPalette:** add `'talk'` to the palette's gated action list, driven by a `talkAvailable` prop, mirroring `tradeAvailable` (`CommandPalette.tsx:107-115`, `PlayScreen.tsx:388`).
- **KeyRouter / usePlayKeyDispatcher:** route the `talk` action to open the `'dialogue'` overlay (mirror how `codex`/overlay actions open). The modal gate is automatic (`overlay !== null` already covers a `'dialogue'` overlay); closing via Escape uses the existing `onCloseOverlay` path (`DialogueScreen`'s per-open React state resets on unmount — a fresh greeting next open, which is fine; the one-time reputation guard is server-side).

- [ ] **Step 5: Client tests (jsdom)**

Create `apps/web/test/dialogue-screen.test.tsx` (testing-library, mirror `TradeScreen`/overlay tests; avoid the known parallel-load flakiness — issue #87): with a stub pack (a dialogue + a linked NPC) and a projection placing that NPC adjacent — the screen shows the greeting + initial topics; choosing a topic shows its response and reveals its follow-ups; a `reveal-lore` topic calls `onRevealLore` with the contentId; an `open-trade` topic dispatches `trade-open`; a `reputation` topic dispatches `dialogue-consequence` with the right `npcActorId`/`topicId`; "Leave" calls `onClose`; with no adjacent dialogue NPC the screen shows "No one to talk to." Add a unit test for `insertSighting`/`revealLore` idempotency.

- [ ] **Step 6: Verify + commit**

`npm run verify` — client-only; no demo fixtures change.

```bash
npm run verify
npx prettier --write apps/web/ packages/session-core/
git add apps/web/ packages/session-core/
git commit -m "feat(web): DialogueScreen + talk action; reveal-lore, open-trade, reputation dispatch"
```

---

### Task 4: The lampwright's conversation (content) + fixture regen

**Files:**
- Create: `content/dialogues/travelling-lampwright.yaml`
- Modify: `content/npcs/travelling-lampwright.yaml` (+`dialogueId`), `packages/content/test/default-content.test.ts` (`dialogue: 1`)
- Test: `packages/content/test/dialogue-roster.test.ts` (create, small)

**Interfaces:** consumes the Task-1 kind + validators. Produces `dialogue.travelling-lampwright`, referenced by the NPC.

- [ ] **Step 1: Author the dialogue**

Create `content/dialogues/travelling-lampwright.yaml`. Use real, resolvable references: the `reputation` consequence targets `npc-faction.lampwrights`; the `reveal-lore` targets a real lore-bearing monster (pick one whose lore fits "the fallen" — e.g. a fallen-champion/echo monster id confirmed present with authored `lore`; the implementer verifies the id resolves and has `lore`). In-voice, spoiler-light copy:

```yaml
schemaVersion: 7
entries:
  - kind: dialogue
    id: dialogue.travelling-lampwright
    name: The Travelling Lampwright
    tags: [dialogue, lampwright]
    greeting: "Mind the wick, traveller. Light's the only coin the dark respects down here."
    topics:
      - id: lamps
        prompt: "Tell me about your lamps."
        response: "Every one trimmed by hand. Oil runs out; courage runs out faster. I sell what keeps both burning a while longer."
      - id: heart
        prompt: "What lies at the bottom?"
        response: "Something that was a person once, they say, worn thin by all that binds it. I keep my lamps lit and my questions few."
      - id: fallen
        prompt: "You speak of the fallen."
        response: "Champions who went down and did not come up whole. Their echoes still pace the deep. Here — let me tell you of one, so you'll know it when it finds you."
        consequence: { kind: reveal-lore, contentId: <a-fallen-monster-with-lore> }
      - id: keep-lit
        prompt: "I'll keep your lamps lit."
        response: "Then you're a friend of the wick. The Lampwrights remember such things."
        once: true
        consequence: { kind: reputation, factionId: npc-faction.lampwrights, amount: 5 }
      - id: trade
        prompt: "What are you selling?"
        response: "Have a look, then. Mind the prices — oil's dear this far down."
        consequence: { kind: open-trade }
```

The greeting-reachable topics (`lamps`/`heart`/`fallen`/`keep-lit`/`trade`) are all initially available (none behind a `reveals` gate in this first cut; `reveals` is exercised by the Task-1 fixture test). Choose the `amount: 5` to a sensible in-band nudge (confirm against `npc-faction.lampwrights` min/max reputation).

- [ ] **Step 2: Link the NPC + roster test**

In `content/npcs/travelling-lampwright.yaml`, add `dialogueId: dialogue.travelling-lampwright`.

Create `packages/content/test/dialogue-roster.test.ts`: compile the real content; assert `dialogue.travelling-lampwright` exists with ≥1 topic, its `reveal-lore` contentId resolves to a lore-bearing entry, its `reputation` factionId resolves, and `npc.travelling-lampwright.dialogueId` links it. Update `default-content.test.ts` `dialogue: 0 → 1`.

Run: `npm run test --workspace @woven-deep/content`
Expected: PASS.

- [ ] **Step 3: Regenerate fixtures + diff-check + parity**

The new dialogue entry + the NPC `dialogueId` shift the pack content hash → regenerate all content-hash-embed demo fixtures (recipe in Global Constraints). Expected: ONLY content-hash-embed fields move (save/record/heart hashes via the content hash); NO projection/events/standings simulation shift (the demo hero never talks). Diff-check each; then:

```bash
npm run test --workspace @woven-deep/engine
npx vitest run --root apps/server determinism-parity
```
Expected: PASS.

- [ ] **Step 4: Verify + commit**

```bash
npm run verify
npx prettier --write content/ packages/content/test/
git add content/ packages/content/test/ packages/engine/test/fixtures/
git commit -m "feat(content): the travelling lampwright's conversation"
```

---

### Task 5: Whole-feature verification

- [ ] **Step 1: Full suite + all demos + parity**

```bash
npm run verify
npm run dungeon:demo && npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run run-records:demo && npm run endgame:demo && npm run magic:demo && npm run engine:demo
npx vitest run --root apps/server determinism-parity
```
Expected: all PASS — every demo re-derives its reviewed hashes in two processes; parity green; the full workspace suite green.

- [ ] **Step 2: Manual smoke (optional, documented)**

Note in the task report how to reach the feature manually (the lampwright is a rare ~25% dungeon encounter): when adjacent to her, `Talk` opens the conversation; the warm topic nudges Lampwright reputation once; "the fallen" reveals a Codex lore entry; "what are you selling?" opens trade. If unreachable in a quick seed, rely on the automated tests (which exercise the mechanism directly).

---

## Self-Review

**Spec coverage:**
- New `dialogue` content kind (greeting + topics + closed consequence union) + `dialogueId` on NPCs + validators — Task 1. ✓
- Client-managed `DialogueScreen` (not projection-driven), `talk` gated overlay-open, pure-client tree walk + reveal-lore — Task 3. ✓
- Only the reputation consequence in the engine: `dialogue-consequence` command validated like `merchantSession`, content-derived faction/amount (anti-cheat), one-time omit-when-empty guard, new `'dialogue'` reason — Task 2. ✓
- `open-trade` reuses `trade-open`; `reveal-lore` is a new small client insert — Tasks 2/3. ✓
- The lampwright's authored conversation + link — Task 4. ✓
- Determinism: no bump/migration (optional field); Tasks 1-3 byte-identical demos, Task 4 content-hash-embed only + parity — Global Constraints + Task 4/5. ✓
- Out of scope (other NPCs, quest trees, tier-gating) — untouched.

**Placeholder scan:** The two `<...>` markers (the `reveal-lore` monster id in Task 4, the faction/type typing in Task 2's dialogue module) are explicit implementer-resolves-against-real-code items with named criteria (a lore-bearing fallen monster; the real `NpcFactionContentEntry` type), not vague gaps. No TBD/TODO.

**Type consistency:** `DialogueContentEntry`/`DialogueTopic`/`DialogueConsequence` defined in Task 1, consumed by Task 2 (engine re-derivation) + Task 3 (client walk) + Task 4 (content). `DialogueConsequenceCommand { npcActorId, topicId }` defined in Task 2, dispatched by Task 3's intent→command-builder. `dialogueConsequencesApplied?` optional on `MerchantPopulation` (Task 2) matches the omit-when-empty save schema. `dialogueId?` on `NpcContentEntry` (Task 1) resolved via `population.npcId` (Task 2) and the client adjacency gate (Task 3).
