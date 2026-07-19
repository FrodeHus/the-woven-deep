# Content Pipeline

**Status:** Shipped, extended incrementally with every gameplay milestone (currently
content schema v7)

**Package:** `packages/content` (`@woven-deep/content`), source data in `content/`

Game content and balance data live in strict YAML rather than hard-coded TypeScript
objects, so a content author can add or rebalance a monster, item, encounter, or vault
without a code change — as long as the new entry composes existing engine behaviors and
effects. A fundamentally new mechanic still requires a new engine operation or condition
trait with a schema and tests: YAML is data, never a scripting language.

## What lives in YAML vs TypeScript

YAML controls glyphs, presentation, statistics, tags, rarity, run-appearance chance,
depth eligibility, prices, resistances, ability parameters, loot references, synergy
weights, unlock criteria, and other declarative values. It **never** contains executable
scripts, embedded expressions, custom YAML tags, or new algorithms — it references
TypeScript-registered behaviors and effects by stable ID (e.g. `ai: light_hunter`,
`effect: cone_fire`) and supplies schema-validated parameters. AI models, targeting
rules, procedural algorithms, and effect implementations stay in TypeScript, registered
and tested.

Current content kinds under `content/`: `monsters`, `items`, `spells`, `traps`,
`loot-tables`, `vaults`, `balance`, `conditions`, `encounters` (individual/group/swarm/
boss/merchant), `npcs`, `npc-factions`, `achievements`, `classes`, `backgrounds`,
`traits`, `identification-pools`. Each file can contain one or more entries with
globally stable identifiers; filenames don't affect content identity, so files can be
split, merged, or renamed freely.

## Compilation and validation

At startup, the server reads the complete directory named by `CONTENT_DIR` (falling back
to the content bundled in the image), sorts paths deterministically, parses YAML with
custom tags disabled and bounded aliases/file sizes, then runs four validation stages:

1. **File and entry shape** against versioned strict Zod schemas, rejecting unknown
   properties.
2. **Global uniqueness and stable-identifier validation.**
3. **Cross-reference, dependency-cycle, range, and weight validation** (e.g. every
   `effect.condition.apply` resolves to a real condition; loot-table nesting is acyclic).
4. **Semantic checks**: required foundational content exists, effect parameters are
   compatible, unlock rules are reachable, generation pools are valid.

Any error prevents the server from accepting traffic and reports filename, entry ID,
field path, and a corrective message. `npm run content:validate` runs the same compiler
standalone for fast author feedback, without booting a server.

Successful validation compiles YAML to **stable JSON** and hashes that stable
representation (not raw YAML formatting) with SHA-256. This is deliberate: reformatting a
YAML file, reordering keys, or changing whitespace never changes the content hash;
changing a value does.

## Content hash binding

Every active run stores the exact content hash it was created under. This is the
mechanism that keeps a resumed or replayed run honest when the operator edits content:
existing runs keep resolving definitions from their original immutable compiled pack
(`content_packs`, indexed by hash, retained and deduplicated in SQLite); only *new* runs
pick up the current pack. Hall records remain replayable under the content they were
actually played with, forever.

Persistent-profile simulation runs against the authoritative server pack; the browser
only receives presentation data and observable definitions for the current state. Guest
mode receives the complete compiled pack because its engine runs locally — guest content
is inspectable and is deliberately not treated as a security boundary.

## Closed registries

Several YAML fields reference closed, TypeScript-published registries rather than free
text, so a spelling mistake or content author's whim can never silently create new engine
behavior:

- **Behaviors** (AI/NPC behavior IDs, e.g. `npc-behavior.travelling-merchant`).
- **Effects** (primitive operations: damage, healing, condition apply/remove, forced
  movement, reveal, fuel transfer, light-state change, item consumption, feature
  mutation).
- **Targeting rules.**
- **Condition traits** (`condition-trait.incapacitated`, `condition-trait.suppresses-
  reactions`, `condition-trait.avoids-opportunity-attacks`, `condition-trait.interrupts-
  rest`, `condition-trait.prevents-movement`) — see the condition design below.
- **Merchant services** (currently only `merchant-service.identify` and
  `merchant-service.strongbox`).
- **Achievement criteria** (`first-champion-defeat`, `first-echo-defeat`).

The compiler rejects unknown IDs, invalid parameters, missing references, impossible
equipment definitions, malformed dice, loot cycles, unreachable foundational generation
categories, invalid depth ranges, unsafe integers, and duplicate stable IDs, with
deterministic diagnostics (file, entry, field path, correction).

## Conditions as content

Conditions (stun, poison, buffs, etc.) were deliberately moved into strictly validated
YAML early, while the condition runtime still had only one hard-coded rule and no
released packs depended on its shape — this was judged to be the last easy moment to do
it. A condition definition declares presentation (name, description, color), duration
mode (`timed`/`permanent`, with default/maximum), stacking mode (`replace`/`refresh`/
`intensify`, with a cap), per-stack derived-stat modifiers, and a sorted set of closed
traits.

Engine code checks traits, never special-cased condition IDs — e.g. scheduling excludes
an actor via `condition-trait.incapacitated` rather than comparing against
`condition.incapacitated` by name. This means adding a new condition that only combines
existing traits and modifiers is pure content work. A genuinely new mechanic (periodic
damage, on-apply/on-expire triggers, auras, condition-to-condition triggers) is
explicitly deferred to a later `effect-sequence` content kind, not smuggled in as a
condition trait.

## Server-admin documentation as a gate

All operator-editable YAML is documented in `docs/server-admin/content-configuration.md`
— schemas alone are not considered sufficient documentation. A documentation-consistency
test reads that reference and requires every compiler-published content kind and closed
registry ID to appear in it, so adding YAML surface area without documenting it fails the
content package gate. `docs/operations/content-and-storage.md` links to the server-admin
reference rather than duplicating it.

The documented operator workflow: copy the bundled content directory, edit or add YAML,
run `npm run content:validate -- /absolute/path`, mount the complete replacement
directory read-only, restart the container, and verify the new hash before admitting
play. A run stays bound to its original content hash and never silently continues under
changed definitions — this is the rollback story.
