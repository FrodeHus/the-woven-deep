# Development Rules

These are the binding development rules for **The Woven Deep**. **Every contributor and every AI agent must follow them.** They encode both current (2026) best practice for the stack and the conventions this repo depends on. When a rule here conflicts with a habit from another project, this document wins.

Read the [Golden Rules](#1-golden-rules-non-negotiable) first — the rest elaborates.

Most of these rules are not abstract: they were earned. A 2026 code review of this codebase (tracked as the architecture epic #52) catalogued the concrete defects that grow when they're ignored — ~50 lying `as unknown as` casts at one boundary, a save schema that silently drifted from its types, stringly-typed effect parameters that failed as `NaN` instead of a validation error, 800-line god-modules edited in lockstep in three places, the same lookup and label map copy-pasted a dozen times. The refactor that fixed all of it is the reference implementation for the rules below. Where a rule cites "this codebase had…", that is why the rule exists — don't reintroduce the pattern it retired.

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js ≥ 22.12, **ESM only** (no CommonJS) |
| Language | TypeScript 5.8, **`strict` + `exactOptionalPropertyTypes`** |
| Monorepo | npm workspaces |
| `packages/content` | YAML → `CompiledContentPack` compiler; **Zod** schemas; closed registries |
| `packages/engine` | Deterministic, browser-safe game core; seeded RNG; save/replay codec |
| `apps/server` | Fastify 5, better-sqlite3, magic-link auth |
| `apps/web` | React 19, Vite 7, Tailwind CSS v4, shadcn-style components on Base UI, `cmdk` |
| Tests | Vitest 3.2; Testing Library + `user-event` (web); Playwright (e2e) |

---

## 1. Golden Rules (non-negotiable)

1. **Determinism is sacred.** The engine is a pure function of its seed. Every RNG draw threads its `Uint32State` forward and writes it back — never reuse or drop a state. Saves and replays must be **byte-identical** (`encodeActiveRun`). A refactor that changes a `*-demo-hashes.json` hash has changed behavior — stop and fix it; never regenerate a hash to make a "refactor" pass. Regenerate reviewed hashes **only** when content or behavior *intentionally* changed, and eyeball the diff.
2. **Comments describe the present, never the past.** No lineage: never write *"extracted from X"*, *"formerly"*, *"(Task N)"*, *"used to be"*, *"moved from"*, *"deprecated alias for"*, or anything narrating what code previously was or where it came from. Git history records lineage; comments explain current behavior and intent. This is a hard rule — reviewers reject violations.
3. **`vitest` does not typecheck.** Green tests are not a green build. The real gate is, in order: `npm run -w @woven-deep/content build` → `npm run -w @woven-deep/engine build` (its own `tsc`) → `npx tsc -p apps/web/tsconfig.json --noEmit` → `npx tsc -p apps/server/tsconfig.json --noEmit`. Run all of them plus the suites before claiming a change is done.
4. **Behaviour-preserving means byte-identical.** For any refactor, existing tests pass **with no assertion changes**, and no demo hashes move. Test *infrastructure* (wrapping a component in a provider, updating a fixture to a now-required field) may change; behavioural **assertions** may not.
5. **Fail loud, never silent.** Invalid content is a compile-time error. Unexpected runtime state throws. Do not swallow errors, do not `catch` and continue, do not fall back to a plausible default that hides a bug.
6. **No `any`, no lying casts.** See [TypeScript](#3-typescript). A cast that asserts something false compiles clean and no test can catch it — it is worse than the duplication it "fixes".
7. **Every feature ships with a design doc.** Any feature or behavioural change is documented under `docs/design/` — update the relevant existing doc, or add a new one. The design records the intent and shape *before* the code and stays current with it; no feature PR merges without its design recorded there. (Pure refactors and cleanups that change no behaviour are exempt.)

---

## 2. Build & verify

- `packages/*/dist` is **gitignored**. A stale local dist silently feeds old types to consumers (the engine imports `@woven-deep/content` via its built `./dist`). **Always rebuild `@woven-deep/content` before building/typechecking the engine or web.**
- **Git worktrees need their own `npm install`** — it creates the `node_modules/@woven-deep/*` workspace symlinks. Without it, `tsc` resolves stale/wrong content types. A long build session can drop web-only deps (`@tailwindcss/vite`, `cmdk`, `lucide-react`, base-ui) — re-run `npm install` if a web gate fails with "cannot find module".
- The engine `tsconfig` **excludes test files** from its build. Shared-type breakage in engine test fixtures surfaces via the web typecheck (which includes `apps/web/test/**`), so run that too.
- **Automated quality gates** back the rules below — run them, don't eyeball:
  - `npm run lint` — ESLint (type-aware). **Zero errors** to merge; fix the cause, do not blanket-`eslint-disable`. A disable is a last resort for a genuine false positive or a contractual constraint, and carries a present-tense reason. (`react-refresh/only-export-components` warnings are advisory.)
  - `npm run format` / `npm run format:check` — Prettier. Formatting is not a review topic; let the tool decide. CSS is excluded (hand-authored, and glyph tests pin its source).
  - `npm run knip` — dead files, exports, and dependencies. Keep it at zero; delete dead code rather than exporting it "just in case".
  - `npm run depcruise` — forbids runtime import cycles (type-only cycles are allowed) and enforces the layer boundaries (engine ⇏ apps, content ⇏ engine/apps, `model` ⇏ `compiler`, server ⇏ web). The 13 pre-existing runtime cycles are baselined in `.dependency-cruiser-known-violations.json`; do not add new ones, and prefer removing baselined ones (see the burn-down issue).
  - `npm run verify` runs the whole chain (typecheck → lint → format:check → depcruise → knip → test) — the one command that stands in for the full gate. **CI runs `npm run verify` plus the demo-hash replays on every push and PR to `main`** (`.github/workflows/ci.yml`), so a red gate blocks merge; run it locally first.

---

## 3. TypeScript

- **`strict` and `exactOptionalPropertyTypes` are on.** Model optionality precisely: `field?: T` means "may be absent", `field: T | undefined` means "always present, may be undefined" — they are not interchangeable.
- **No `any`.** No `as any`, no `as unknown as X` to force a shape. If you must cross an untyped boundary, do it **once**, in a single named module, with a test that pins the asserted shape to reality (see `apps/web/src/session/projection-view.ts` — one reviewed cast, not fifty).
- **Discriminated unions over stringly-typed data.** Model "one of N shapes" as a `type` discriminated on a literal `kind`/`type`/`model` field, and `switch` on it exhaustively (let the compiler prove you covered every case — a `Record<Union, …>` mapped type or a `default: never` check).
- **Single-source closed vocabularies.** Declare one canonical `as const` array and derive **both** the value set and the type: `export const DAMAGE_TYPES = [...] as const; export type DamageType = typeof DAMAGE_TYPES[number];` — then `z.enum(DAMAGE_TYPES)` for the schema. Never spell the same closed set as a TS union *and* an independent Zod enum; they drift.
- **Types encode invariants.** Prefer a type that makes an illegal state unrepresentable over a runtime check plus a loose type. Narrow ids to their registry union (`BehaviorId`, `EffectId`) rather than `string` wherever consumers benefit.
- **`import type`** for type-only imports. Keep the runtime/type boundary explicit and erasable.
- **Prefer `readonly`** on data that is not meant to mutate (most of it). The engine's state is immutable-by-convention — produce new objects, don't mutate.
- **No non-null `!` to paper over a `T | null`** where a real guard belongs; if two params must be passed together, assert it loudly rather than silently degrading.

## 4. React & the web client

- **Function components + hooks only.** No class components.
- **One responsibility per component.** A component that fuses measurement, key dispatch, data-shaping, and rendering is a god component — extract the stateful concerns into **custom hooks** (`usePaneMeasurement`, `useCellHover`, …) and keep the component to layout + composition. If a file grows past ~300 lines or holds several unrelated `useState`/`useEffect` clusters, split it.
- **Context for cross-cutting values, not prop-drilling.** Settings, keymap, pack, and session flow through one provider (`UiProviders`) read via context hooks — do not also thread them as props through four component levels, and never mount the same provider twice.
- **Effects model derived state and side effects, not everything.** Get dependency arrays right; don't re-derive in an effect what can be computed in render or memoised. Preserve exact effect timing/ordering when refactoring — a reordered effect can change behaviour.
- **Reuse the shared primitives.** Selection lists use `ListDetail` / `useListNavigation`; item-action keys use `useItemActionKeys`; pack lookups use `session/pack-queries`; derived-stat/attribute labels come from `ui/derived-stats-display`. Do not hand-roll a fourth keyboard handler or re-declare a label map.
- **The session layer is the boundary.** `apps/web/src/session/**` (intents, projections, key routing, storage) is framework-free and is the stable contract to the engine. Components consume `SessionSnapshot` and dispatch `PlayerIntent`s; they do not reach past this boundary into engine internals.
- **The ASCII grid renderer** (`GridRenderer`/`EffectsLayer`/`camera`/`cell-color`) is intentionally plain and performance-sensitive — leave it as-is unless the task is specifically about it.

## 5. Deterministic engine

- **Seeded RNG streams only.** Draw via `rollDie(state, sides)` / the stream helpers; thread the returned `Uint32State` back into `run.rng.<stream>`. Never call `Math.random()`, `Date.now()`, or argless `new Date()` in engine or content-derived code — they break replay.
- **Fold effect results in one place** (`applyEffectResult`, `withRngStream`) rather than hand-spreading `{ ...state, rng: … }` at every call site.
- **Content lookups by id** go through the memoised `ContentIndex` (`entryById`/`requireMonster`/`requireItem`/`requireEncounter`) — ids are globally unique (compiler-enforced), so first-match is well-defined.
- **The save format is a single source of truth.** `save-schema/` Zod schemas are bound to their `model` interfaces via per-domain drift guards (`Expect<SchemaMatches<z.infer<…>, Interface>>`) so adding a field to one without the other is a `tsc` error. Keep that binding when you touch either side.

## 6. Content pipeline

- **Content is validated at compile time and fails loud.** A typo'd id, an out-of-range value, or a malformed parameter is a `ContentCompileError`, not a runtime `NaN`.
- **Closed registries.** Behaviours, effects, and vocabularies are closed sets. Content may only reference registered ids; you cannot invent a behaviour in YAML.
- **One kind per module.** `model/` and `compiler/schema/` and `compiler/validation/` are split per content kind, re-exported through thin barrels. Put a new kind's type, schema, and validation rule in the matching modules; keep the barrel's public surface stable.
- **Effect/behaviour parameters are typed** against their registry contract; new parameterised behaviour needs its schema in `registries.ts`.
- **Use Zod's native combinators, not hand-rolled matching.** Model a tagged variant with `z.discriminatedUnion('kind', […])` rather than a loose object plus a `superRefine` that hand-checks which fields are present — the native form gives precise field-level errors and cannot silently accept a mismatched shape.

## 7. Server

- **Cross-cutting HTTP concerns are composable guards**, not per-route boilerplate: `requireOrigin`, `requireCsrf`, `requireSession` (in `auth/http-guards.ts`), composed per route in the correct order. Request-scoped data (`request.profileId`) is a typed `decorateRequest` + `declare module 'fastify'` augmentation — never an inline `request as SomeShape` cast.
- **Dev-only routes are isolated** (`routes/dev.ts`) and registered only under an explicit `isDevMode` flag — never inferred from an unrelated field, never mixed into production route modules.
- **Persistence is separated from transport.** Repositories own SQL and the `Row`/`TableRow`/`toRow` boundary (see `apps/server/src/db/README.md`); route handlers own HTTP. No raw SQL in a handler, no `any` at the DB row boundary.
- **Migrations are versioned and tested.** Use `runMigrations`; do not add un-versioned schema changes.

## 8. Structure & naming

- **Files that change together live together;** split by responsibility, not by technical layer. Prefer small, focused files you can hold in your head over large ones that do too much.
- **Barrels** (`index.ts` / a thin re-export module) keep a package's public surface stable while its internals are split — a refactor that splits a file must keep every existing import path resolving unchanged.
- **Names say what a thing does, not how it works or what it used to be.** `resolveCookieSecret`, `adjacentMerchant`, `FacetedOptionList`. Match the surrounding code's casing and idiom.
- **Shared logic lives once.** If you're about to copy a predicate, a lookup, a label map, or a helper into a second file, extract it to a shared module instead. This codebase accumulated the same content lookup, merchant-adjacency check, and derived-stat label map in a dozen places before they were unified — the second copy is the warning sign, not the tenth.
- **Never maintain the same logic in lockstep across sites.** If a sequence (an advance pipeline, a validation order, a fold) must stay identical in two or three places, it is one function called N times, not N copies to keep in sync by hand. A genuinely-different variant is parameterized (e.g. by a `phase` flag) or kept explicitly separate with a stated reason — never a near-copy that will drift.

## 9. Testing

- **Test observable behaviour, not implementation.** Web: query by role/text (`getByRole`, `getByText`), drive real events with `user-event`, assert rendered output and dispatched intents — not internal state or `data-testid` where a role works. Engine: assert deterministic outputs, replay equality, and projection results.
- **Tests are the refactor safety net.** They must pin behaviour so large changes can proceed safely. When risky code lacks behavioural coverage, add characterization tests *first*.
- **New behaviour ships with tests** in the same change. A pure extraction adds a unit test for the extracted helper; a bug fix adds a regression test that fails before and passes after.
- **Pristine output.** No stray warnings or console noise in test runs — treat them as findings.
- **A test that asserts nothing, mocks the thing under test, or is tautological is worse than no test** — reviewers reject these.

## 10. Security

- **Never commit secrets.** Config comes from env; validate it loudly at boot (all-or-nothing for credential groups, reject weak cookie secrets in production-shaped deployments).
- **Auth guards enforce origin, CSRF, and session** on state-changing routes; preserve the exact guard order when editing routes.
- **Validate all external input** — request bodies via typed schemas, content via the compiler. Untrusted strings (e.g. a content id being *checked*) stay `string` until validated; do not narrow-then-trust.
- **Treat anything sent to an external service as published.** Do not exfiltrate user or run data.

## 11. Git, PRs & workflow

- **Branch off `main`; never commit refactors or features directly to `main`.**
- **One logical change per commit**, imperative subject (`feat: …`, `refactor: …`, `fix: …`, `test: …`, `docs: …`, `content: …`). The commit message describes *what and why*, not the task tracker.
- **PRs are the unit of merge.** A PR states what changed, how it was verified (the build gate + suites), and links the issues it `Closes`. Keep the diff scoped to its stated purpose — no opportunistic unrelated edits. A feature PR also updates or adds its `docs/design/` doc (Golden Rule 7).
- **Every change is reviewed** (spec compliance + code quality) before merge; verify the full build gate and suites are green on the final state.
- **Agents:** you are already on the correct branch/worktree for your task. Do **not** run `git checkout`/`switch`/`reset`/`branch`/`rebase`/`worktree` or `cd` outside your worktree; only edit, `git add`, and `git commit` on the current branch. If `git status` looks unexpected, stop and report rather than "fixing" it with a reset.

---

*When in doubt, prefer the choice that keeps behaviour byte-identical, the types honest, and the next reader oriented. If a rule here is wrong or missing something, change it in a PR — this document is code too.*
