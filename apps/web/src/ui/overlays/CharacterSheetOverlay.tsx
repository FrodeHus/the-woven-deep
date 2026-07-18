import { Fragment, type CSSProperties, type JSX, type ReactNode } from 'react';
import {
  DERIVED_STAT_NAMES, type DerivedStatFormula, type DerivedStatName,
} from '@woven-deep/engine';
import { useSessionCtx } from '../providers.js';
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

function Section({ id, title, children }: Readonly<{ id: string; title: string; children: ReactNode }>): JSX.Element {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <h3 id={id} className="font-serif text-sm text-fg-strong">{title}</h3>
      {children}
    </section>
  );
}

function DefinitionGrid({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">{children}</dl>;
}

function Row({ label, value }: Readonly<{ label: string; value: ReactNode }>): JSX.Element {
  return (
    <Fragment>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
    </Fragment>
  );
}

/**
 * Read-only character sheet: base attributes, every `DERIVED_STAT_NAMES` entry with its value AND
 * formula, active conditions (stacks + a disclosed expiry marker), hunger stage, sight radius,
 * equipped gear, and current-run metrics. No dispatch surface at all -- unlike `InventoryOverlay`,
 * this overlay never calls `onDispatch`; there is nothing here to act on, only to read. Reads
 * directly from `useSessionCtx()` rather than taking props, since the character sheet is
 * play-scope (a session is always present while this overlay can open) -- guards to rendering
 * nothing if that invariant is ever violated.
 *
 * Presented as a static section grid rather than `ListDetail`: every section here is a flat,
 * read-only fact sheet with no drill-down detail pane to show, so a list+detail split would add
 * structure with nothing to put in the detail side (YAGNI).
 *
 * Two deliberate omissions, both disclosed rather than silently dropped:
 *
 * - **Resistances**: the approved design spec calls for them, but `projection.hero` does not
 *   project a `resistances` field (verified against `projectGameplayState`'s hero object,
 *   `packages/engine/src/projection.ts`) -- only monster/encounter content entries carry
 *   `resistances`. This section is omitted here rather than inventing engine state; a later task
 *   can add it following that same disclosed process.
 *
 * - **Condition remaining time**: the design calls for "remaining durations". `projectGameplayState`
 *   (`packages/engine/src/projection.ts`) computes this engine-side per condition as `remaining =
 *   expiresAt - worldTime` (hero-experienced time, not hidden state -- `worldTime` itself still
 *   never reaches the web layer, only this derived value does), `null` when the condition is
 *   permanent (`expiresAt === null`) or the active floor is town (depth 0, frozen time). Because
 *   both "permanent" and "frozen in town" collapse to `remaining === null`, this overlay
 *   disambiguates using the pre-existing `projection.floor.town` flag: town always shows the
 *   frozen marker (time is frozen for every condition while in town, permanent or not); outside
 *   town, a null `remaining` can only mean the condition is permanent, so it renders "Permanent".
 *   A non-null `remaining` renders as "N world-time units remaining" -- "world-time units" is this
 *   codebase's own established vocabulary for `worldTime` ticks (see `restMaximumDuration` in
 *   `docs/server-admin/content-configuration.md`), not an invented "turns" unit.
 */
export function CharacterSheetOverlay(): JSX.Element | null {
  const sessionCtx = useSessionCtx();
  if (!sessionCtx) return null;

  const { snapshot } = sessionCtx;
  const hero = snapshot.projection.hero as unknown as ProjectedHeroLike;
  const town = snapshot.projection.floor.town;
  const metrics = snapshot.projection.metrics;

  return (
    <div className="flex flex-col gap-3">
      <Section id="character-sheet-attributes-heading" title="Attributes">
        <DefinitionGrid>
          {ATTRIBUTE_ORDER.map((name) => (
            <Row key={name} label={ATTRIBUTE_LABEL[name]} value={hero.attributes[name]} />
          ))}
        </DefinitionGrid>
      </Section>

      <Section id="character-sheet-derived-heading" title="Derived stats">
        <DefinitionGrid>
          {DERIVED_STAT_NAMES.map((name) => {
            const stat = hero.derived[name];
            return (
              <Row
                key={name}
                label={DERIVED_STAT_LABEL[name]}
                value={(
                  <>
                    {stat.value}
                    <span className="ml-1 text-xs text-muted">{`(${formatFormula(stat.formula)})`}</span>
                  </>
                )}
              />
            );
          })}
        </DefinitionGrid>
      </Section>

      <Section id="character-sheet-vitals-heading" title="Vitals">
        <DefinitionGrid>
          <Row label="Health" value={`${hero.health} / ${hero.maxHealth}`} />
          <Row label="Hunger" value={hero.hungerStage} />
          <Row label="Sight radius" value={hero.sightRadius} />
        </DefinitionGrid>
      </Section>

      <Section id="character-sheet-conditions-heading" title="Conditions">
        {hero.conditions.length === 0 && <p className="text-sm text-muted">No active conditions.</p>}
        {hero.conditions.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {hero.conditions.map((condition) => (
              <li
                key={condition.conditionId}
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: condition.color, color: condition.color } as CSSProperties}
              >
                <span className="font-medium">{condition.name}</span>
                {' '}
                <span>{`×${condition.stacks}`}</span>
                {' '}
                <span>
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
      </Section>

      <Section id="character-sheet-equipment-heading" title="Equipment">
        <DefinitionGrid>
          {Object.entries(hero.equipment).map(([slot, item]) => (
            <Row key={slot} label={slot} value={item ? item.name : 'Empty'} />
          ))}
        </DefinitionGrid>
      </Section>

      <Section id="character-sheet-metrics-heading" title="Run statistics">
        <DefinitionGrid>
          {METRIC_ROWS.map(({ key, label }) => (
            <Row key={key} label={label} value={metrics[key]} />
          ))}
        </DefinitionGrid>
      </Section>
    </div>
  );
}
