import type { JSX, ReactNode } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { effectLabel } from '../labels.js';
import { itemById } from '../../session/pack-queries.js';
import { itemKnownFacts } from '../../session/item-facts.js';
import {
  artifactDrawbackRows,
  artifactSignature,
  isArtifact,
  isFuellessLight,
} from '../../session/artifact-view.js';
import type { MenuEntry, ProjectedItemLike } from './inventory-model.js';

/** The tone each action button borders in, mirroring the HUD's own tone vocabulary (`Gauge`'s
 * hp/weave tones, the belt's accent) rather than inventing new colors: equip/refuel read as the
 * neutral accent, use as an affirmative "good" action, drop as destructive "danger", and toggling
 * a light as a "warn" (fire) accent. */
type ActionTone = 'accent' | 'good' | 'danger' | 'warn';

const ACTION_TONE_CLASS: Readonly<Record<ActionTone, string>> = {
  accent: 'border-accent text-accent-strong hover:bg-accent hover:text-deep',
  good: 'border-good text-good hover:bg-good hover:text-deep',
  danger: 'border-danger text-danger-fg hover:bg-danger hover:text-deep',
  warn: 'border-warn text-warn hover:bg-warn hover:text-deep',
};

function ActionButton({
  label,
  chord,
  tone = 'accent',
  disabled = false,
  onClick,
}: Readonly<{
  label: string;
  chord: string;
  tone?: ActionTone;
  disabled?: boolean;
  onClick: () => void;
}>): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`border bg-raised px-3 py-1.5 font-mono text-xs ${
        disabled
          ? 'cursor-not-allowed border-subtle text-subtle'
          : `cursor-pointer ${ACTION_TONE_CLASS[tone]}`
      }`}
    >
      {label} <span className="opacity-60">[{chord}]</span>
    </button>
  );
}

/** A dotted-leader fact row: label on the left, value on the right, the dotted rule filling the
 * gap between them -- the mockup's "Damage ······ 1d6+2" / "Condition ······ 100" presentation. */
function FactRow({ label, value }: Readonly<{ label: string; value: ReactNode }>): JSX.Element {
  return (
    <div className="flex items-baseline gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span aria-hidden="true" className="flex-1 border-b border-dotted border-subtle" />
      <span className="text-fg">{value}</span>
    </div>
  );
}

export function DetailPane({
  entry,
  refuelTarget,
  pack,
  provenance = [],
  onEquip,
  onUse,
  onDrop,
  onToggleLight,
  onRefuel,
}: Readonly<{
  entry: MenuEntry | undefined;
  /** The equipped light `entry`'s item can refuel, if any -- see `equippedLightMatchingFuel`. */
  refuelTarget: ProjectedItemLike | undefined;
  pack: CompiledContentPack;
  /** This artifact's circulation history, oldest first, already rendered as prose by
   * `provenanceLines` -- empty for an ordinary item, and for an artifact no run has ever carried.
   * Resolved by the caller from the records repository's ledger (the engine never holds it). */
  provenance?: readonly string[];
  onEquip: () => void;
  onUse: () => void;
  onDrop: () => void;
  onToggleLight: () => void;
  onRefuel: () => void;
}>): JSX.Element {
  if (!entry)
    return <p className="text-subtle">Select an item — ↑↓ to browse, e to equip, u to use.</p>;
  const { item, equipped, slot } = entry;
  const unidentified = item.contentId === undefined;
  const description =
    !unidentified && item.contentId ? itemById(pack, item.contentId)?.description : undefined;

  /** Static per-content facts (damage/worth/light/armor) live on the compiled pack entry, not the
   * projected instance. The lookup is gated on `contentId`, which the projection omits entirely for
   * an unidentified item -- so an unidentified item resolves no entry and reveals none of these. */
  const content = item.contentId === undefined ? undefined : itemById(pack, item.contentId);

  /** Artifact-ness is a property of the CONTENT (the pack's `artifact` block), never of the
   * projected instance -- so an unidentified item, whose projection omits `contentId` entirely,
   * cannot be recognized as one, and its gold name never gives it away. */
  const artifact = isArtifact(pack, item.contentId);
  const drawbacks = artifactDrawbackRows(pack, item.contentId);
  /** The signature ability, if this artifact has one. Casting it IS using the item -- the same
   * `onUse` intent a scroll goes through -- so the affordance only changes what the button says. */
  const signature = artifactSignature(pack, item.contentId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {/* Gold for an artifact: the same `text-accent` token the HUD spends on the carried-gold
         * count (`TopBar`), rather than a color invented for this one pane. */}
        <h3 className={`font-serif text-lg ${artifact ? 'text-accent' : 'text-fg-strong'}`}>
          {item.name}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <span className="border border-muted px-1.5 py-px text-[10px] uppercase tracking-[0.1em] text-muted">
            {item.category}
          </span>
          <span className="border border-muted px-1.5 py-px text-[10px] uppercase tracking-[0.1em] text-muted">
            {unidentified ? 'Unidentified' : 'Identified'}
          </span>
          {artifact && (
            <span className="border border-accent px-1.5 py-px text-[10px] uppercase tracking-[0.1em] text-accent">
              Relic
            </span>
          )}
        </div>
      </div>

      {/* Dotted-leader fact rows. Instance facts come off the projected item; static facts
       * (Damage/Worth/Light radius/Armor) come off the identified content entry (`content`), which
       * is absent for an unidentified item -- so its hidden stats never leak. `Condition` is real
       * per-instance durability data (`item.condition`, an `ItemView` field), not the demo's
       * hardcoded placeholder -- it stays, alongside the identified/unidentified tag above, per
       * "all current functionality preserved" (design spec's Panels section); whether an item is
       * identified still gates which of the OTHER rows below are shown. */}
      <div className="flex flex-col gap-1">
        {equipped && <FactRow label="Equipped" value={slot} />}
        {content != null &&
          itemKnownFacts(content).map((fact) => (
            <FactRow key={fact.label} label={fact.label} value={fact.value} />
          ))}
        {!unidentified &&
          item.effects?.map((effect) => (
            <FactRow
              key={effect.effectId}
              label="Effect"
              value={effectLabel(effect.effectId, effect.parameters)}
            />
          ))}
        {item.enchantment &&
          Object.entries(item.enchantment.modifiers).map(([stat, amount]) => (
            <FactRow key={stat} label={stat} value={`${amount >= 0 ? '+' : ''}${amount}`} />
          ))}
        {drawbacks.map((row) => (
          <FactRow
            key={row.label}
            label={row.label}
            value={<span className="text-danger-fg">{row.value}</span>}
          />
        ))}
        <FactRow label="Condition" value={item.condition} />
        {/* A signature artifact states its charges as "spent / full" inside its own block below,
         * so the bare instance count would only repeat it. */}
        {item.charges != null && !signature && <FactRow label="Charges" value={item.charges} />}
        {/* A fuelless artifact light carries a full reserve it never spends, so the gauge would
         * read as a countdown that never moves -- it hides on the pack's `artifact.light.fuelless`
         * flag, never on `fuel === null`. The refuel affordance is gone for the same reason, gated
         * one level up in `equippedLightMatchingFuel`. */}
        {item.fuel != null && !isFuellessLight(pack, item.contentId) && (
          <FactRow label="Fuel" value={item.fuel} />
        )}
        {item.enabled !== null && <FactRow label="State" value={item.enabled ? 'Lit' : 'Unlit'} />}
        {item.unknownProperties && <FactRow label="Properties" value="Unknown" />}
      </div>

      {/* The signature block wears the same gold (`accent`) the artifact's name and Relic tag do,
       * so a relic reads as one thing rather than a stat list with a stranger bolted on. */}
      {signature && (
        <section aria-label="Signature" className="flex flex-col gap-1 border border-accent p-2">
          <h4 className="text-[10px] uppercase tracking-[0.14em] text-accent">Signature</h4>
          <FactRow
            label={signature.name}
            value={`${item.charges ?? 0} / ${signature.maximumCharges}`}
          />
        </section>
      )}

      {description && <p className="text-sm italic text-muted">{description}</p>}

      {provenance.length > 0 && (
        <section aria-label="Provenance" className="flex flex-col gap-1">
          <h4 className="text-[10px] uppercase tracking-[0.14em] text-subtle">Provenance</h4>
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
            {provenance.map((line, index) => (
              <li key={`${index}-${line}`} className="text-xs text-muted">
                {line}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <ActionButton
          label={equipped ? 'Unequip' : 'Equip'}
          chord="e"
          tone="accent"
          onClick={onEquip}
        />
        {/* A spent relic cannot be spoken until the next floor wakes it. The engine rejects the
         * cast with `signature.no-charges` regardless -- this only stops the pane offering an
         * action that is already known to fail. */}
        <ActionButton
          label={signature ? `Cast ${signature.name}` : 'Use'}
          chord="u"
          tone="good"
          disabled={signature !== undefined && (item.charges ?? 0) <= 0}
          onClick={onUse}
        />
        <ActionButton label="Drop" chord="d" tone="danger" onClick={onDrop} />
        {item.category === 'light' && (
          <ActionButton label="Toggle light" chord="l" tone="warn" onClick={onToggleLight} />
        )}
        {refuelTarget && (
          <ActionButton
            label={`Refuel ${refuelTarget.name}`}
            chord="r"
            tone="warn"
            onClick={onRefuel}
          />
        )}
      </div>
    </div>
  );
}
