# Dungeon NPCs Design

**Date:** 2026-07-14

**Status:** Approved design

**Roadmap milestone:** 4B2 — dungeon NPCs

**Parent milestone:** 4B — populations, NPCs, and run records

**Previous milestone:** `docs/superpowers/specs/2026-07-14-population-encounters-design.md`

## Goal

Add deterministic, YAML-authored neutral dungeon NPCs through a complete travelling-merchant vertical slice. Merchants reuse the population framework, carry finite saved stock, offer buying, selling, and identification, react to the current hero's faction reputation, protect themselves when threatened, and depart on global dungeon time. All merchant state remains authoritative, replayable, hidden-state-safe, and browser-compatible.

The content model remains open to later healers, explorers, prisoners, and lore encounters, but 4B2 implements only travelling merchants and identification service.

## Exit demonstration

A terminal scenario uses forced demonstration eligibility while production content retains normal rarity. It:

- Creates two travelling merchants from the one bundled faction using ordinary encounter gates and placement.
- Opens an explicit transaction with the first merchant, then buys an item, sells an eligible item, and identifies an unidentified carried item.
- Shows exact prices and currency only in the active trade projection.
- Advances global dungeon time through meaningful departure-warning thresholds and proves an off-floor merchant can depart without simulating off-floor turns.
- Deliberately attacks a neutral merchant, closing trade, applying the faction penalty once, triggering the authored flee response, and dropping exactly the configured fraction of remaining stock once.
- Encounters the related merchant and visibly demonstrates that the aggression penalty moved the hero into a trade-refusal tier.
- Produces identical saves, events, prices, stock, reputation, and player projections with continuous execution and execution split by several save/reload boundaries.

## Scope

### Included

- Strict reusable `npc` and `npc-faction` YAML content kinds.
- A `merchant` encounter model extending the existing encounter union.
- One bundled travelling-merchant NPC and faction, with schemas reusable by later content.
- Deterministically rolled, finite, depth-appropriate item stock and identification uses.
- Hero currency, merchant buying and selling, and one registered identification service.
- Explicit authoritative transaction sessions with free commerce commands.
- Hero-scoped faction reputation, deterministic tiers, prices, service gates, and refusal.
- Global-time departure, warning thresholds, and transaction-safe departure behavior.
- Mortal merchant behavior with authored flee or self-defense responses.
- Neutral-monster relations, deliberate aggression, configured stock loss, and reputation consequences.
- Save-schema v5 with a v4-to-v5 migration.
- Hidden-state-safe merchant, trade, event, and reputation projection.
- Content, save, replay, property, demonstration, and Docker verification.

### Deferred beyond 4B2

- Healers, explorers, prisoners, lore NPCs, escort quests, dialogue trees, and NPC schedules.
- Town shops, town price balance, town inventory refresh, and storage.
- Multiple bundled merchant factions or a faction-war simulation.
- Haggling, credit, debt, theft, consignment, buyback guarantees, or stock refresh.
- Currency item stacks, profile-wide money, or money retained between heroes.
- Run metrics, achievements, score, Hall records, and finalized reputation statistics; these belong to 4B3.
- Browser transaction dialogs and server networking; this milestone supplies engine projections and commands.

## Established contracts

4B2 preserves immutable reducer input, stable identifiers, content-hash binding, named deterministic random streams, complete snapshots, integer-energy scheduling, recent-command deduplication, exact stable save encoding, eight-direction corner rules, visibility and lighting, and hidden-state-safe projection.

It extends rather than bypasses 4B1. Merchant encounters use the existing run appearance decisions, depth and environment eligibility, instance limits, population placement, saved behavior intent, pathfinding, actor scheduling, perception, event projection, and replay boundaries. Opportunity reactions remain hostile-only. Adding neutral merchants must not cause neutral movement, departure, or fleeing to trigger hostile-only reactions.

The existing aggression interaction remains authoritative: bumping into a neutral merchant returns `confirm-aggression`; an explicit adjacent `attack` is confirmation and proceeds through the ordinary attack resolver. No second confirmation token or merchant-specific attack command is added.

The engine remains browser-safe and imports no React, Fastify, SQLite, browser storage, clock, network, or Node-only APIs. No new runtime dependency is required. Commerce, pricing, reputation, and NPC behavior are small game-rule modules whose exact behavior belongs in the replay contract.

## Content architecture

### NPC definitions

An `npc` entry describes a reusable neutral actor independently of where it appears:

- Glyph, color, display name, tags, base attributes, health, speed, perception, and light interaction.
- A required faction ID.
- Initial neutral disposition.
- A registered NPC behavior ID and strictly validated parameters.
- A positive self-preservation health threshold expressed in basis points.

The initial registered behavior is `npc-behavior.travelling-merchant`. The closed registry permits later TypeScript implementations, but YAML cannot introduce executable behavior or arbitrary state machines.

### Faction definitions

An `npc-faction` entry supplies a stable ID, player-facing name, reputation bounds, starting reputation, and an ordered reputation-tier table. Exactly one tier must contain every reputation value within the authored bounds. Tiers cannot overlap or leave gaps.

Each tier defines:

- A qualitative player-facing label.
- A purchase-price multiplier in basis points.
- A sale-price multiplier in basis points.
- Whether ordinary trade is accepted.
- The set of registered service IDs available at that tier.

4B2 bundles one faction. The schema and run state support additional factions without changing the save shape.

### Merchant encounters

`merchant` joins `individual`, `group`, `swarm`, and `boss` in the encounter model. It uses every common encounter field from 4B1, including appearance chance, discovery protection, depth and environment filters, weight, maximum instances, placement, and intent presentation. Discovery protection defaults to zero for merchants unless content explicitly opts in.

A merchant encounter definition contains:

- One NPC content ID.
- One ordinary loot-table ID used for stock, with an inclusive positive roll-count range.
- Merchant purchase and sale multipliers in positive basis points.
- An ordered list of service offers.
- A positive lifetime range in global world-time units.
- Ordered, unique warning thresholds measured as remaining global time.
- An aggression response of `flee` or `self-defense`.
- Reputation deltas for completed commerce, deliberate aggression, and merchant death.
- A stock-drop fraction from zero through one.

The compiler proves all referenced items are ordinary transferable stock. Loot entries may use existing depth and weight controls, but cannot include guaranteed unique rewards, heirlooms, objectives, quest items, or entries explicitly tagged nontransferable. The same constraints are checked again when selling to a merchant.

### Service registry

Service definitions are closed registered records rather than executable YAML. 4B2 implements only `merchant-service.identify`. A merchant offer supplies:

- The registered service ID.
- A non-negative base price.
- An inclusive non-negative use-count range.
- The reputation tiers in which the service may be offered, further restricted by the faction tier's service allow-list.

The use count is rolled once at merchant creation and saved. It never refreshes.

## Run state

### Hero currency and reputation

`HeroState` gains a non-negative safe-integer currency balance. New runs receive `startingCurrency` from the single balance content entry. Currency belongs to the current hero and ends with the run; it is not an inventory item and consumes no backpack capacity.

The active run stores one sorted reputation record per faction encountered by the hero. Missing records mean the faction's authored starting value. Every change clamps to that faction's authored minimum and maximum. Reputation never leaves the active run.

### Merchant population state

Each merchant population stores:

- Population, encounter, actor, NPC, and faction IDs.
- Creation time, rolled lifetime, and absolute `departureAt` global time.
- Warning thresholds already emitted.
- Initial stock item IDs and current stock item IDs.
- Rolled service offers and remaining use counts.
- Lifecycle state: `available`, `fleeing`, `defending`, `departed`, or `dead`.
- Whether the hero has deliberately provoked it.
- Whether aggression and death reputation penalties have been applied.
- Whether stock loss has been resolved.
- Whether this population has already granted its commerce reputation bonus.

Merchant stock consists of ordinary `ItemState` records. `ItemLocation` gains a merchant-stock variant keyed by merchant population ID. Purchases, sales, drops, death, and departure move or remove the exact mutable item records; identified state, charges, fuel, condition, enchantment, and stack quantity are never regenerated.

Initial stock IDs are retained as audit state. Current stock IDs are sorted and must refer bidirectionally to item records in that merchant location. Cross-record save validation rejects missing actors, factions, encounters, stock, services, or mismatched population references.

### Transaction state

The run stores at most one active transaction:

- Merchant population and actor IDs.
- Opening command ID and opening revision.
- Whether at least one buy, sell, or service action completed.

A transaction survives save/reload. It closes automatically if the merchant is attacked, dies, becomes unavailable, changes floor, is no longer owned by its population, or otherwise violates the transaction invariant. Automatic closure records its reason and never grants the commerce reputation bonus.

## Creation and random isolation

Merchant encounters enter the existing floor-population selection and placement flow. They consume ordinary encounter-selection and placement randomness exactly like other populations.

After placement, merchant creation consumes a dedicated merchant-stock random stream to roll:

1. The merchant lifetime.
2. Loot-table stock and quantities.
3. Service use counts.

The results are materialized once and saved. Re-entry, transaction opening, reputation changes, and save loading never reroll or refresh them. Separating stock randomness prevents a change in commerce content from perturbing combat AI, placement, or later encounter selection.

## Lifecycle and behavior

### Available

An available merchant follows its registered neutral behavior, may trade when all preconditions pass, and presents a broad non-hostile intent. Hostile creatures normally treat it as neutral and do not target it merely because it exists.

A hostile creature may threaten a merchant only after a relationship override, faction rule, direct damage, or collateral danger makes that threat explicit. A merchant below its self-preservation threshold attempts to flee from the known danger using existing saved intent and pathfinding.

### Departure

Departure uses the run's global world time, not floor-local turns. An inactive floor remains otherwise frozen: merchants take no movement or behavior turns there. When global time reaches a warning threshold, the engine emits that warning once even if the merchant is off-floor. When `departureAt` becomes due, the merchant actor and all remaining merchant-held stock are removed atomically and the population becomes `departed`.

A due merchant never departs while its transaction is open. Trade commands consume no world time, so a valid transaction cannot newly cross a deadline. If a due transaction is recovered from a save or closed after becoming invalid, automatic closure resolves first and departure resolves immediately afterward. Opening a transaction with an already-due merchant is rejected.

### Aggression and self-preservation

The first deliberate hero attack against a neutral merchant atomically:

1. Closes any active transaction without a commerce bonus.
2. Marks the merchant provoked and applies the authored aggression penalty once.
3. Makes the hero/merchant relationship hostile.
4. Resolves stock loss once.
5. Enters the authored `fleeing` or `defending` state before subsequent AI turns.
6. Resolves the ordinary attack.

`flee` seeks a safe reachable cell away from known threats through existing deterministic pathfinding. `self-defense` uses ordinary combat behavior and may later flee when its self-preservation threshold is crossed. Neither behavior creates opportunity attacks against neutral actors; the relationship override with the hero is hostile after provocation.

Stock loss counts aggregate item units across remaining stock. It drops `ceil(totalUnits * stockDropFraction)` units, capped at total units; a zero fraction drops none. A deterministic merchant-runtime stream selects units, stable item splitting creates exact ground stacks, and the result is saved. Services never drop. Stock loss cannot occur again on later hits or death.

If the merchant dies, any configured death penalty is applied once. The selected stock loss is the only merchant stock placed on the floor; all stock still held by the merchant is removed. Departure also removes all held stock. A surviving merchant may trade again only if its lifecycle, relationship, and faction reputation permit it; the bundled fleeing merchant does not resume trade after provocation.

## Transactions and economy

### Commands

4B2 adds five authoritative commands:

- `trade-open`: merchant actor ID.
- `trade-buy`: merchant population ID, stock item ID, and positive quantity.
- `trade-sell`: merchant population ID, hero item ID, and positive quantity.
- `trade-service`: merchant population ID, service ID, and target item ID when required.
- `trade-close`: merchant population ID.

They use ordinary command IDs, expected revisions, recent-command deduplication, events, saves, and replay. A successful commerce command advances the authoritative revision but consumes no actor energy, dungeon turn, hunger, fuel, or global world time. No actors act between commerce commands.

While a transaction is open, non-trade player commands are rejected. A trade command naming another merchant is rejected. These constraints make the session an explicit authoritative modal state rather than a UI convention.

Opening requires a living, visible, adjacent, available, non-hostile merchant on the hero's floor. The merchant must not be due to depart, another transaction must not exist, and the current reputation tier must accept trade.

### Price calculation

Every stocked or sold item uses its existing non-negative integer item `price` as the base unit price. Zero-price items cannot be stocked or sold.

For purchases, the engine calculates:

`ceil(basePrice × merchantSaleBps × factionPurchaseBps / 10000²)`

For sales, it calculates:

`floor(basePrice × merchantPurchaseBps × factionSaleBps / 10000²)`

For services, it calculates:

`ceil(serviceBasePrice × factionPurchaseBps / 10000)`

Positive purchase and service results have a minimum of one currency unit. A sale price of zero is valid and is shown before confirmation. Quantity is applied after the item unit price. Compiler bounds and checked safe-integer arithmetic reject overflow rather than rounding through floating-point imprecision. Purchases and services round up and sales round down, making the travelling merchant consistently less favorable than planned town commerce.

### Buying and selling

A purchase validates stock ownership and quantity, hero currency, item state, stack rules, and backpack capacity before mutation. It then deducts currency and moves the exact purchased state to the hero's backpack, splitting and merging through normal inventory rules.

A sale accepts only an unequipped item in the hero's backpack. It rejects heirlooms, guaranteed unique rewards, quest or objective items, nontransferable tags, and content categories excluded by the merchant definition. Validation includes quantity, price, merchant acceptance, and safe currency addition before moving the exact state into merchant stock. Equipped items must first be unequipped through the ordinary command outside a transaction.

### Identification

The identification service targets one unidentified item in the hero's backpack or equipment. It reuses the existing identification transition and never invents a parallel knowledge model. The command validates the current tier, offer, remaining uses, target, and funds atomically; success deducts currency, decrements the saved use count, and identifies the exact item.

### Closing and reputation

An explicit close ends the transaction. If at least one buy, sell, or service action succeeded, it applies the encounter's commerce reputation bonus, but each merchant population can grant that bonus at most once in its lifetime. Opening and closing without commerce grants nothing. Automatic closure grants nothing.

Reputation changes are event-driven, clamped, reason-coded, and guarded by saved one-time flags. Command replay and deduplication cannot apply a bonus or penalty twice. Reputation modifies prices, service availability, and trade willingness; it never makes every member of a faction automatically attack the hero.

## Validation and atomicity

Every trade command performs a complete preflight before changing state or consuming runtime randomness. It validates transaction identity, actor and population liveness, adjacency and visibility, lifecycle, reputation tier, stock or item ownership, quantity, transferability, backpack capacity, funds, service uses, target eligibility, and checked arithmetic.

Expected failures return a closed `InvalidActionReason` code, including merchant unavailable, out of range, refusal, transaction mismatch, insufficient funds, missing stock, unavailable service, unacceptable item, insufficient capacity, and invalid quantity. No failure partially moves items, changes currency or reputation, consumes a service use, advances time, or changes a random stream.

Impossible internal references, unsupported registry IDs, arithmetic outside compiled bounds, or contradictory lifecycle state remain invariant errors rather than player-facing failures.

## Events and projection

The authoritative event vocabulary includes merchant creation and encounter, trade open, item bought, item sold, service purchased, trade close, automatic close, reputation change, departure warning, departure, provocation, stock drop, and death.

Events use stable reason and content IDs. Commerce events include exact item, quantity, unit price, total, and resulting currency for the controlling hero. Reputation events include the exact delta and resulting value in authoritative state. Player projection may replace hidden or unrelated details with qualitative public forms if multiplayer observers are added later.

Outside an active transaction, a visible merchant projection exposes its actor presentation, faction, health, disposition, broad intent, qualitative reputation tier, trade availability, and any reached departure warning. It does not expose exact stock, exact deadline, rolled service uses, future stock drops, random state, flee target, or path. An unseen merchant exposes no live actor or merchant state.

During a valid active transaction, a dedicated trade projection exposes:

- Merchant population ID, actor ID, name, faction, and current qualitative tier.
- Hero currency.
- Exact projected stock entries, quantities, mutable player-observable item state, and purchase prices. Unidentified stock uses its appearance and never reveals undiscovered true properties.
- Eligible backpack items and their sale prices.
- Service availability, price, remaining uses, and valid targets.
- A stable refusal or unavailability reason when an offer changes before closure.

Projection derives prices from authoritative state and never stores them in the save. It does not reveal encounter gate rolls, stock RNG, undiscovered item properties, future reputation thresholds, or hidden actors.

## Save schema and migration

4B2 increments the active-run save schema from v4 to v5. Unlike the pre-release fixture rewrites used by earlier milestones, this milestone includes one explicit ordered v4-to-v5 migration because adding currency establishes the first player-economy continuity contract.

The migration initializes existing v4 heroes with zero currency, an empty reputation list, no active transaction, and no merchant populations or merchant-stock locations. All other v4 state is preserved exactly. It then validates the complete v5 document through the normal decoder. Unsupported versions remain clearly rejected.

V5 validation covers safe integer currency, sorted unique reputation records, faction bounds, transaction ownership, merchant lifecycle consistency, absolute departure times, emitted warnings, service counts, one-time flags, and bidirectional stock locations. Encoding remains canonical and split replay must be byte-identical.

Compiled content schema advances by one version to include NPC, faction, merchant encounter, balance currency, and service-offer definitions. The compiler and server-admin documentation enumerate every accepted field, registry value, bound, cross-reference, and invalid combination.

## Verification

Implementation follows test-driven development and adds focused tests for:

- NPC, faction, merchant, service, balance, transferability, and cross-reference content validation.
- V4-to-v5 migration, strict v5 decoding, canonical encoding, and corrupt cross-record rejection.
- Existing encounter gates, instance limits, placement, required-route protection, and discovery defaults for merchants.
- Stock depth eligibility, deterministic creation, saved materialization, and random-stream isolation.
- Price rounding, tier boundaries, zero values, quantities, safe-integer bounds, and buy/sell invariants.
- Transaction preconditions, modal command rejection, revision and deduplication behavior, atomic failures, capacity, exact item-state transfer, and stacking.
- Identification targets, use exhaustion, save/reload, and reuse of existing knowledge rules.
- One-time commerce, aggression, and death reputation effects; clamping; service gates; price effects; and refusal without faction-wide hostility.
- Global warnings and departure while active or off-floor, transaction deferral, automatic closure, and stock removal.
- Neutral monster relations, explicit threats, flee and self-defense behavior, path determinism, hostile-only opportunity reactions, stock fraction rounding, exact drops, and one-time resolution.
- Visible, hidden, remembered, event, and active-trade projection redaction.
- Continuous versus split replay across creation, commerce, departure, aggression, and death.
- At least 512 seeded mixed-system simulations with shrinking and invariant checks after every accepted command.
- The terminal exit demonstration, repeated-process reviewed hashes, full build, typecheck, content startup gate, smoke tests, and Docker Compose health verification.

## Milestone completion

4B2 is complete when the bundled merchant can be generated through ordinary population rules; every stock, service, transaction, reputation, departure, combat, and projection transition is deterministic and saved; the exit demonstration proves the entire vertical slice and faction consequence; and all verification commands pass from a clean checkout.

The roadmap then advances to 4B3 run records without adding metrics, achievements, scoring, or Hall finalization to this milestone.
