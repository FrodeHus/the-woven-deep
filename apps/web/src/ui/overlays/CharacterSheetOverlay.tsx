import type { JSX } from 'react';
import {
  DERIVED_STAT_NAMES, type DerivedStatFormula, type DerivedStatName,
} from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { ProjectedItemLike } from './InventoryOverlay.js';

type AttributeName = 'might' | 'agility' | 'vitality' | 'wits' | 'resolve';

const ATTRIBUTE_ORDER: readonly AttributeName[] = ['might', 'agility', 'vitality', 'wits', 'resolve'];

const ATTRIBUTE_LABEL: Readonly<Record<AttributeName, string>> = {
  might: 'Might', agility: 'Agility', vitality: 'Vitality', wits: 'Wits', resolve: 'Resolve',
};

const DERIVED_STAT_LABEL: Readonly<Record<DerivedStatName, string>> = {
  maxHealth: 'Max health', meleeAccuracy: 'Melee accuracy', meleeDamageBonus: 'Melee damage bonus',
  rangedAccuracy: 'Ranged accuracy', defense: 'Defense', search: 'Search', disarm: 'Disarm',
};

/** The projection's `derived` entry shape -- `{value, formula}` per `DERIVED_STAT_NAMES`, produced
 * by `deriveActorStats` (`packages/engine/src/attributes.ts`) and carried verbatim onto
 * `projection.hero.derived` (`projectGameplayState`, `packages/engine/src/projection.ts`). */
interface ProjectedDerivedStat {
  readonly value: number;
  readonly formula: DerivedStatFormula;
}

interface ProjectedCondition {
  readonly conditionId: string;
  readonly name: string;
  readonly color: string;
  readonly stacks: number;
  readonly remaining: number | null;
}

/** The subset of `projection.hero`'s widened `Record<string, unknown>` shape this overlay actually
 * reads -- mirrors `InventoryOverlay`'s `ProjectedItemLike` cast discipline: the engine's
 * `GameplayProjection.hero` type is intentionally loose (`Readonly<Record<string, unknown>>`), so
 * consumers narrow it to exactly the fields they use, never inventing fields the engine doesn't
 * actually project (no resistances -- see the doc comment below `CharacterSheetOverlay`). */
interface ProjectedHeroLike {
  readonly attributes: Readonly<Record<AttributeName, number>>;
  readonly derived: Readonly<Record<DerivedStatName, ProjectedDerivedStat>>;
  readonly health: number;
  readonly maxHealth: number;
  readonly sightRadius: number;
  readonly hungerStage: string;
  readonly conditions: readonly ProjectedCondition[];
  readonly equipment: Readonly<Record<string, ProjectedItemLike | null>>;
}

/** Only the current-run stats the brief lists -- deliberately a narrower literal union than
 * `keyof RunMetrics` (which also has `killsByModel`, a nested object, plus a few fields the brief
 * doesn't ask for) so each row's value is provably a plain number, never an object. */
type ScalarMetricKey =
  | 'kills' | 'damageDealt' | 'damageTaken' | 'itemsCollected' | 'itemsIdentified'
  | 'currencyEarned' | 'currencySpent' | 'floorsEntered' | 'deepestDepth' | 'turnsElapsed' | 'restsCompleted';

const METRIC_ROWS: readonly Readonly<{ key: ScalarMetricKey; label: string }>[] = [
  { key: 'kills', label: 'Kills' },
  { key: 'damageDealt', label: 'Damage dealt' },
  { key: 'damageTaken', label: 'Damage taken' },
  { key: 'itemsCollected', label: 'Items collected' },
  { key: 'itemsIdentified', label: 'Items identified' },
  { key: 'currencyEarned', label: 'Currency earned' },
  { key: 'currencySpent', label: 'Currency spent' },
  { key: 'floorsEntered', label: 'Floors entered' },
  { key: 'deepestDepth', label: 'Deepest depth' },
  { key: 'turnsElapsed', label: 'Turns elapsed' },
  { key: 'restsCompleted', label: 'Rests' },
];

/**
 * Renders a derived-stat formula as disclosed, human-readable text -- e.g. `{base: 10, vitality:
 * 1}` becomes `"base 10 + vitality×1"`. This is the exact formula record the balance content entry
 * carries (`packages/content/src/model.ts`'s `BalanceContentEntry.formulas`), not a re-derivation,
 * so it can never drift from what `deriveActorStats` actually computed.
 */
function formatFormula(formula: DerivedStatFormula): string {
  const entries = Object.entries(formula) as readonly (readonly [string, number])[];
  return entries.map(([operand, coefficient]) => (
    operand === 'base' ? `base ${coefficient}` : `${operand}×${coefficient}`
  )).join(' + ');
}

export interface CharacterSheetOverlayProps {
  readonly snapshot: SessionSnapshot;
}

/**
 * Read-only character sheet: base attributes, every `DERIVED_STAT_NAMES` entry with its value AND
 * formula, active conditions (stacks + a disclosed expiry marker), hunger stage, sight radius,
 * equipped gear, and current-run metrics. No dispatch surface at all -- unlike `InventoryOverlay`,
 * this overlay never calls `onDispatch`; there is nothing here to act on, only to read.
 *
 * Two deliberate omissions, both disclosed rather than silently dropped:
 *
 * - **Resistances**: the approved design spec calls for them, but `projection.hero` does not
 *   project a `resistances` field (verified against `projectGameplayState`'s hero object,
 *   `packages/engine/src/projection.ts`) -- only monster/encounter content entries carry
 *   `resistances`. The plan's Global Constraints reserve the one permitted projection addition for
 *   Task 8 (an unrelated actor-contentId field), so this section is omitted here rather than
 *   inventing engine state; a later task can add it following that same disclosed process.
 *
 * - **Condition remaining time**: the design calls for "remaining durations". `projectGameplayState`
 *   (`packages/engine/src/projection.ts`) now computes this engine-side per condition as `remaining
 *   = expiresAt - worldTime` (hero-experienced time, not hidden state -- `worldTime` itself still
 *   never reaches the web layer, only this derived value does), `null` when the condition is
 *   permanent (`expiresAt === null`) or the active floor is town (depth 0, frozen time). The raw
 *   `expiresAt` tick was dropped from the projection entirely -- this overlay was its only
 *   consumer (verified by grep), so there is nothing left needing the absolute tick once
 *   `remaining` exists. Because both "permanent" and "frozen in town" collapse to `remaining ===
 *   null`, this overlay disambiguates using the pre-existing `projection.floor.town` flag: town
 *   always shows the frozen marker (time is frozen for every condition while in town, permanent or
 *   not); outside town, a null `remaining` can only mean the condition is permanent, so it renders
 *   "Permanent". A non-null `remaining` renders as "N world-time units remaining" -- "world-time
 *   units" is this codebase's own established vocabulary for `worldTime` ticks (see
 *   `restMaximumDuration` in `docs/server-admin/content-configuration.md` and the `worldTime` field
 *   doc in `docs/superpowers/specs/2026-07-13-core-gameplay-survival-design.md`), not an invented
 *   "turns" unit.
 */
export function CharacterSheetOverlay({ snapshot }: CharacterSheetOverlayProps): JSX.Element {
  const hero = snapshot.projection.hero as unknown as ProjectedHeroLike;
  const town = snapshot.projection.floor.town;
  const metrics = snapshot.projection.metrics;

  return (
    <div className="character-sheet-overlay">
      <section aria-labelledby="character-sheet-attributes-heading">
        <h3 id="character-sheet-attributes-heading">Attributes</h3>
        <dl className="character-sheet-attributes">
          {ATTRIBUTE_ORDER.map((name) => (
            <div key={name}>
              <dt>{ATTRIBUTE_LABEL[name]}</dt>
              <dd>{hero.attributes[name]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="character-sheet-derived-heading">
        <h3 id="character-sheet-derived-heading">Derived stats</h3>
        <dl className="character-sheet-derived">
          {DERIVED_STAT_NAMES.map((name) => {
            const stat = hero.derived[name];
            return (
              <div key={name}>
                <dt>{DERIVED_STAT_LABEL[name]}</dt>
                <dd>
                  {stat.value}
                  <span className="character-sheet-formula"> ({formatFormula(stat.formula)})</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section aria-labelledby="character-sheet-vitals-heading">
        <h3 id="character-sheet-vitals-heading">Vitals</h3>
        <dl className="character-sheet-vitals">
          <div>
            <dt>Health</dt>
            <dd>{`${hero.health} / ${hero.maxHealth}`}</dd>
          </div>
          <div>
            <dt>Hunger</dt>
            <dd>{hero.hungerStage}</dd>
          </div>
          <div>
            <dt>Sight radius</dt>
            <dd>{hero.sightRadius}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="character-sheet-conditions-heading">
        <h3 id="character-sheet-conditions-heading">Conditions</h3>
        {hero.conditions.length === 0 && <p className="placeholder">No active conditions.</p>}
        {hero.conditions.length > 0 && (
          <ul className="character-sheet-conditions">
            {hero.conditions.map((condition) => (
              <li key={condition.conditionId} style={{ color: condition.color }}>
                <span className="character-sheet-condition-name">{condition.name}</span>
                {' '}
                <span className="character-sheet-condition-stacks">{`×${condition.stacks}`}</span>
                {' '}
                <span className="character-sheet-condition-remaining">
                  {condition.remaining === null
                    ? town
                      ? '— (frozen while in town)'
                      : 'Permanent'
                    : `${condition.remaining} world-time units remaining`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="character-sheet-equipment-heading">
        <h3 id="character-sheet-equipment-heading">Equipment</h3>
        <dl className="character-sheet-equipment">
          {Object.entries(hero.equipment).map(([slot, item]) => (
            <div key={slot}>
              <dt>{slot}</dt>
              <dd>{item ? item.name : 'Empty'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="character-sheet-metrics-heading">
        <h3 id="character-sheet-metrics-heading">Run statistics</h3>
        <dl className="character-sheet-metrics">
          {METRIC_ROWS.map(({ key, label }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{metrics[key]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
