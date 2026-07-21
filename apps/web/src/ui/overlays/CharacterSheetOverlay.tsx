import type { JSX, ReactNode } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { ATTRIBUTE_ORDER, type DerivedStatFormula } from '@woven-deep/engine';
import { useSessionCtx, usePack } from '../providers.js';
import { classEntries } from '../../session/pack-queries.js';
import {
  ATTRIBUTE_LABELS,
  DERIVED_STAT_LABELS,
  playerVisibleDerivedStats,
} from '../derived-stats-display.js';
import { heroOf, type HeroView } from '../../session/projection-view.js';

/** Only the current-run stats the brief lists -- deliberately a narrower literal union than
 * `keyof RunMetrics` (which also has `killsByModel`, a nested object, plus a few fields the brief
 * doesn't ask for) so each row's value is provably a plain number, never an object. */
type ScalarMetricKey =
  | 'kills'
  | 'damageDealt'
  | 'damageTaken'
  | 'itemsCollected'
  | 'itemsIdentified'
  | 'currencyEarned'
  | 'currencySpent'
  | 'floorsEntered'
  | 'deepestDepth'
  | 'turnsElapsed'
  | 'restsCompleted';

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
  return entries
    .map(([operand, coefficient]) =>
      operand === 'base' ? `base ${coefficient}` : `${operand}×${coefficient}`,
    )
    .join(' + ');
}

function Section({
  id,
  title,
  children,
}: Readonly<{ id: string; title: string; children: ReactNode }>): JSX.Element {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3
        id={id}
        className="flex items-center gap-2 text-[0.625rem] uppercase tracking-[0.14em] text-subtle"
      >
        <span aria-hidden="true">·&nbsp;─</span>
        {title}
        <span aria-hidden="true">─&nbsp;·</span>
      </h3>
      {children}
    </section>
  );
}

function DefinitionGrid({
  children,
  columns = 1,
}: Readonly<{ children: ReactNode; columns?: 1 | 2 }>): JSX.Element {
  return (
    <dl className={`grid gap-x-5 gap-y-1 text-sm ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {children}
    </dl>
  );
}

/** A dotted-leader row: label on the left, value on the right, with the dotted rule drawn on the
 * value cell itself so `dt` stays the immediate previous sibling of `dd` (the character-sheet tests
 * read `getByText(label).nextElementSibling` for the value). */
function Row({ label, value }: Readonly<{ label: string; value: ReactNode }>): JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="flex-1 border-b border-dotted border-subtle pb-0.5 text-right text-fg">
        {value}
      </dd>
    </div>
  );
}

/**
 * The hero's class is not projected: the run records only `heroClassTags`, not a class id (see the
 * design amendment noted in `session/codex-derive.ts`). Its display name is resolved the same way
 * the unlock codex resolves it -- the bundled classes carry distinctive tags, so the one class whose
 * every `classTag` the hero carries is the hero's class. `undefined` when no class matches (e.g. the
 * hero carries no class tags), in which case the line is omitted rather than shown blank.
 */
function heroClassName(
  pack: CompiledContentPack,
  heroClassTags: readonly string[],
): string | undefined {
  return classEntries(pack).find((entry) =>
    entry.classTags.every((tag) => heroClassTags.includes(tag)),
  )?.name;
}

/**
 * Read-only character sheet: base attributes, every player-visible derived stat (`DERIVED_STAT_NAMES`
 * minus the internal knobs in `PLAYER_HIDDEN_DERIVED_STATS`) with its value AND formula, active
 * conditions (stacks + a disclosed expiry marker), hunger stage, sight radius,
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
  const pack = usePack();
  if (!sessionCtx) return null;

  const { snapshot } = sessionCtx;
  const hero: HeroView = heroOf(snapshot.projection);
  const floor = snapshot.projection.floor;
  const town = floor.town;
  const location = town ? 'Town' : `Depth ${floor.depth}`;
  const metrics = snapshot.projection.metrics;
  const className = heroClassName(pack, snapshot.heroClassTags);

  return (
    <div className="flex flex-col gap-4">
      {/* Identity header: avatar glyph, hero name, class, current location. The class name is
       * resolved from the hero's class tags against the pack (`heroClassName`); it is omitted when
       * no class matches rather than shown blank. */}
      <header className="flex items-center gap-3.5">
        <div
          aria-hidden="true"
          className="grid size-16 place-items-center border border-double border-accent bg-raised font-serif text-3xl text-accent-strong"
        >
          @
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="font-serif text-lg text-fg-strong">{hero.name}</p>
          {className !== undefined && <p className="text-sm text-fg">{className}</p>}
          <p className="text-xs uppercase tracking-[0.08em] text-subtle">{location}</p>
        </div>
      </header>

      <Section id="character-sheet-attributes-heading" title="Attributes">
        <DefinitionGrid>
          {ATTRIBUTE_ORDER.map((name) => (
            <Row key={name} label={ATTRIBUTE_LABELS[name]} value={hero.attributes[name]} />
          ))}
        </DefinitionGrid>
      </Section>

      <Section id="character-sheet-derived-heading" title="Derived stats">
        <DefinitionGrid>
          {playerVisibleDerivedStats().map((name) => {
            const stat = hero.derived[name];
            return (
              <Row
                key={name}
                label={DERIVED_STAT_LABELS[name]}
                value={
                  <>
                    {stat.value}
                    <span className="ml-1 text-xs text-muted">{`(${formatFormula(stat.formula)})`}</span>
                  </>
                }
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
        {hero.conditions.length === 0 && (
          <p className="text-sm text-muted">No active conditions.</p>
        )}
        {hero.conditions.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {hero.conditions.map((condition) => (
              <li
                key={condition.conditionId}
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: condition.color, color: condition.color }}
              >
                <span className="font-medium">{condition.name}</span>{' '}
                <span>{`×${condition.stacks}`}</span>{' '}
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
        <DefinitionGrid columns={2}>
          {METRIC_ROWS.map(({ key, label }) => (
            <Row key={key} label={label} value={metrics[key]} />
          ))}
        </DefinitionGrid>
      </Section>
    </div>
  );
}
