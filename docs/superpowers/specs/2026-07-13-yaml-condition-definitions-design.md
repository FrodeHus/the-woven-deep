# YAML Condition Definitions Design

**Date:** 2026-07-13

**Status:** Proposed for review

**Roadmap placement:** Narrow prerequisite between core-gameplay Tasks 5 and 6

**Parent design:** `docs/superpowers/specs/2026-07-13-core-gameplay-survival-design.md`

## Decision

Move condition rules and presentation into strictly validated YAML now, while the condition runtime has only one hard-coded rule and no released content packs depend on its shape. Keep the primitive effect-operation registry implemented in TypeScript. Defer reusable named effect sequences and general attack ability definitions until after the current roadmap.

This gives content authors freedom to add, remove, and balance conditions without changing code when those conditions are combinations of supported modifiers and rule traits. A fundamentally new mechanic still requires one new engine operation or condition trait with a schema and tests. YAML does not become an expression or scripting language.

## Goals

- Define conditions as ordinary content entries loaded from any YAML file in the content tree.
- Require every saved and authored condition ID to resolve to exactly one compiled definition.
- Remove special condition IDs from scheduling and action rules.
- Let condition definitions control presentation, stacking, duration defaults, derived-stat modifiers, and a small closed set of engine rule traits.
- Preserve deterministic replay, browser safety, strict startup validation, and compact saved actor state.
- Establish a clean reference boundary that named effect sequences can use later without changing runtime condition state.

## Non-goals

- No reusable named effect-sequence content in this change.
- No arbitrary YAML expressions, scripts, predicates, formulas, event subscriptions, or user-defined operation names.
- No periodic damage, on-apply effects, on-expire effects, auras, contagion, or condition-to-condition triggers. These belong with the later named effect-sequence design.
- No changes to spells, attacks, traps, or item effects beyond validating their condition references.
- No compatibility adapter for earlier development content schema shapes.

## Condition content

Add `condition` to the content-entry union. A definition has this conceptual shape:

```yaml
kind: condition
id: condition.stunned
name: Stunned
description: Cannot take normal actions or reactions.
tags: [control, harmful]
color: "#d8c46a"
duration:
  mode: timed
  default: 100
  maximum: 500
stacking:
  mode: refresh
  maximumStacks: 1
modifiersPerStack:
  defense: -2
traits:
  - condition-trait.incapacitated
  - condition-trait.suppresses-reactions
```

The schema is strict:

- `id`, `name`, and `tags` use existing content conventions.
- `description` is trimmed plain text with a bounded length; it is presentation, not executable markup.
- `color` is a six-digit hexadecimal presentation color.
- `duration.mode` is `timed` or `permanent`. Timed conditions require positive safe-integer `default` and `maximum` values with `default <= maximum`. Permanent conditions require both values to be null.
- `stacking.mode` is `replace`, `refresh`, or `intensify`.
- `maximumStacks` is a positive safe integer. `replace` and `refresh` require it to equal one; `intensify` may use a higher bound.
- `modifiersPerStack` is a strict partial record over the existing derived-stat names. Values are safe integers and apply linearly by saved stack count using checked arithmetic.
- `traits` is a unique, sorted list drawn from a closed compiler-published registry.

The initial trait registry contains:

- `condition-trait.incapacitated`: the actor is excluded from normal scheduling.
- `condition-trait.suppresses-reactions`: the actor cannot make opportunity attacks or other reactions.
- `condition-trait.avoids-opportunity-attacks`: leaving hostile melee reach does not provoke opportunity attacks.
- `condition-trait.interrupts-rest`: applying or retaining the condition interrupts rest.

Tags remain descriptive and never activate engine rules. This prevents a spelling mistake or innocent taxonomy change from altering simulation behavior.

## Application and stacking

`effect.condition.apply` continues to reference `conditionId`. Its `duration` parameter becomes optional:

- Omitted duration uses the condition definition's default.
- A supplied duration must be a positive safe integer no greater than the definition's maximum.
- Permanent conditions reject a supplied duration.

Application uses the definition's stacking mode:

- `replace`: replace the existing instance with one stack, the new source, and a new deadline.
- `refresh`: retain one stack and refresh the source, application time, and deadline.
- `intensify`: add one stack up to `maximumStacks`, then refresh the source, application time, and deadline. Applying at the cap still refreshes duration.

The runtime emits `condition.applied` even when an intensifying condition is already at its cap, because its deadline and source may have changed. The event reports the resulting stack count and deadline. Removal and expiration continue to remove the entire condition instance; partial stack removal is deferred until a concrete game rule needs it.

## Compilation and references

The compiler parses condition files through the existing YAML and Zod pipeline. Its semantic pass builds a content map and validates:

- Every `effect.condition.apply` and `effect.condition.remove` reference resolves to a `condition` entry.
- Every saved condition resolves when a run is attached to its exact compiled content pack.
- Trait names, modifier keys, stacking combinations, and duration combinations are valid.
- Content identifiers remain globally unique across files and kinds.

The compiled pack keeps condition definitions as sorted immutable entries and includes them in the existing content hash. The server continues to load and hash content once at startup. The browser receives or loads the same compiled pack already bound to the run by `contentHash`.

Missing references and invalid combinations fail content compilation with the source file and structural path. Runtime resolvers treat a missing definition after successful compilation as an internal invariant failure, not a recoverable player action.

## Engine integration

Saved `ConditionState` remains compact and unchanged: condition ID, source actor ID, application time, optional absolute expiration time, and stacks. Definitions are not copied into saves. The run's exact content hash prevents definition drift during replay or resume.

Condition-aware engine functions accept the compiled content pack or a derived read-only condition lookup. In particular:

- Scheduling checks the `incapacitated` trait instead of comparing with `condition.incapacitated`.
- Opportunity-reaction eligibility checks `suppresses-reactions` on the potential attacker and `avoids-opportunity-attacks` on the departing actor.
- Derived-stat calculation obtains each active condition's `modifiersPerStack`, multiplies by stacks with checked integer arithmetic, and passes the results through the existing condition-modifier input.
- Rest interruption checks `interrupts-rest` rather than treating every condition ID specially.
- Effect resolution obtains duration and stacking behavior from the referenced definition.

Lookups are pure and contain no I/O, ambient time, or mutable caches. Callers may construct one map per compiled pack at their boundary, but the map is derived data and is not serialized.

## Bundled definitions

The initial content includes at least `condition.incapacitated`, because current scheduling tests exercise that rule. Task 6 fixtures add conditions for suppressing reactions and avoiding opportunity attacks as needed. More conditions remain ordinary balance content and do not require engine changes when they only use existing modifiers and traits.

## Schema and development data

The project is still greenfield with no supported external content packs. The current compiled-content schema v2 is replaced in place and all bundled fixtures are updated together. No compatibility branch or migration is added. Invalid older development packs fail normal startup validation, and a local development database may be rebuilt.

## Verification

Tests cover:

- YAML acceptance for every stacking mode, duration mode, modifier key, and initial trait.
- Rejection of unknown traits or modifiers, invalid stack/duration combinations, missing condition references, duplicate IDs, and references to the wrong content kind.
- Deterministic replace, refresh, capped intensify, expiration, removal, and event ordering.
- Scheduler behavior based on traits rather than special IDs.
- Opportunity-reaction and rest behavior for both relevant traits and ordinary conditions.
- Linear checked derived-stat modifiers by stack count.
- Save/load and continuous-versus-split replay equivalence with active conditions.
- Browser-boundary verification showing that condition lookup and resolution introduce no Node-only dependency.

## Deferred reusable effects

After the current roadmap, a separate `effect-sequence` content kind may give a stable ID to an ordered list of the existing primitive operations. Spells, attacks, traps, and items can reference those IDs. The compiler should reject reference cycles and materialize the sequences into the compiled pack so the engine continues to consume bounded validated operation arrays. That later change does not require a different `ConditionState` or weaken the closed primitive-operation registry.
