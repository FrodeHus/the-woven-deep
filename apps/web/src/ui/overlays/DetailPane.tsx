import type { JSX, ReactNode } from 'react';
import { effectLabel, formatDice } from '../labels.js';
import { usePack } from '../providers.js';
import { itemById } from '../../session/pack-queries.js';
import type { MenuEntry, ProjectedItemLike } from './inventory-model.js';

function ActionButton({
  label,
  chord,
  onClick,
}: Readonly<{ label: string; chord: string; onClick: () => void }>): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer border border-accent bg-raised px-3 py-1.5 font-mono text-xs text-accent-strong hover:bg-accent hover:text-deep"
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
  onEquip,
  onUse,
  onDrop,
  onToggleLight,
  onRefuel,
}: Readonly<{
  entry: MenuEntry | undefined;
  /** The equipped light `entry`'s item can refuel, if any -- see `equippedLightMatchingFuel`. */
  refuelTarget: ProjectedItemLike | undefined;
  onEquip: () => void;
  onUse: () => void;
  onDrop: () => void;
  onToggleLight: () => void;
  onRefuel: () => void;
}>): JSX.Element {
  const pack = usePack();
  if (!entry)
    return <p className="text-subtle">Select an item — ↑↓ to browse, e to equip, u to use.</p>;
  const { item, equipped, slot } = entry;
  const unidentified = item.contentId === undefined;

  /** Static per-content facts (damage/worth/light/armor) live on the compiled pack entry, not the
   * projected instance. The lookup is gated on `contentId`, which the projection omits entirely for
   * an unidentified item -- so an unidentified item resolves no entry and reveals none of these. */
  const content = item.contentId === undefined ? undefined : itemById(pack, item.contentId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <h3 className="font-serif text-lg text-fg-strong">{item.name}</h3>
        <div>
          <span className="border border-muted px-1.5 py-px text-[10px] uppercase tracking-[0.1em] text-muted">
            {`${item.category} · ${unidentified ? 'Unidentified' : 'Identified'}`}
          </span>
        </div>
      </div>

      {/* Description slot: item lore/description copy is not projected on this branch, so it is
       * deliberately left empty rather than fabricated. */}

      {/* Dotted-leader fact rows. Instance facts come off the projected item; static facts
       * (Damage/Worth/Light radius/Armor) come off the identified content entry (`content`), which
       * is absent for an unidentified item -- so its hidden stats never leak. */}
      <div className="flex flex-col gap-1">
        {equipped && <FactRow label="Equipped" value={slot} />}
        {content?.combat?.damage != null && (
          <FactRow label="Damage" value={formatDice(content.combat.damage)} />
        )}
        {content?.combat != null && content.combat.armor > 0 && (
          <FactRow label="Armor" value={content.combat.armor} />
        )}
        {content?.light != null && <FactRow label="Light radius" value={content.light.radius} />}
        {content != null && <FactRow label="Worth" value={content.price} />}
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
        <FactRow label="Condition" value={item.condition} />
        {item.charges != null && <FactRow label="Charges" value={item.charges} />}
        {item.fuel != null && <FactRow label="Fuel" value={item.fuel} />}
        {item.enabled !== null && <FactRow label="State" value={item.enabled ? 'Lit' : 'Unlit'} />}
        {item.unknownProperties && <FactRow label="Properties" value="Unknown" />}
      </div>

      <div className="flex flex-wrap gap-2">
        <ActionButton label={equipped ? 'Unequip' : 'Equip'} chord="e" onClick={onEquip} />
        <ActionButton label="Use" chord="u" onClick={onUse} />
        <ActionButton label="Drop" chord="d" onClick={onDrop} />
        {item.category === 'light' && (
          <ActionButton label="Toggle light" chord="l" onClick={onToggleLight} />
        )}
        {refuelTarget && (
          <ActionButton label={`Refuel ${refuelTarget.name}`} chord="r" onClick={onRefuel} />
        )}
      </div>
    </div>
  );
}
