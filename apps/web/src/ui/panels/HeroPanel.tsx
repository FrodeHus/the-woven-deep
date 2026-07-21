import type { JSX } from 'react';
import { cn } from '../lib/cn.js';
import { hero, lightStateText, type PanelProps } from './types.js';

const LOW_HEALTH_RATIO = 0.3;

/** A labelled value/max meter reused for every hero vital bar (VITALITY, WEAVE). */
function StatMeter({
  label,
  current,
  maximum,
  barClass,
}: {
  readonly label: string;
  readonly current: number;
  readonly maximum: number;
  readonly barClass: string;
}): JSX.Element {
  const ratio = maximum > 0 ? current / maximum : 0;
  return (
    <>
      <p>{`${current}/${maximum} ${label}`}</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <div
          className={cn('h-full rounded-full', barClass)}
          style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
        />
      </div>
    </>
  );
}

export function HeroPanel({ snapshot }: PanelProps): JSX.Element {
  const heroData = hero(snapshot);
  const healthRatio = heroData.maxHealth > 0 ? heroData.health / heroData.maxHealth : 0;
  return (
    <section
      aria-label="Hero"
      className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 text-sm text-fg"
    >
      <h2 className="font-serif text-lg text-fg-strong">{heroData.name}</h2>
      <StatMeter
        label="HP"
        current={heroData.health}
        maximum={heroData.maxHealth}
        barClass={healthRatio <= LOW_HEALTH_RATIO ? 'bg-danger' : 'bg-good'}
      />
      <StatMeter
        label="WEAVE"
        current={heroData.weave}
        maximum={heroData.maxWeave}
        barClass="bg-cool"
      />
      <p className="text-muted">{`Hunger: ${heroData.hungerStage}`}</p>
      <p className="text-muted">{`Light: ${lightStateText(heroData.equipment)}`}</p>
      {heroData.conditions.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {heroData.conditions.map((condition) => (
            <li key={condition.conditionId}>{condition.name}</li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-0.5 text-xs text-subtle">
        {Object.entries(heroData.equipment).map(([slot, item]) => (
          <li key={slot}>{`${slot}: ${item ? item.name : 'empty'}`}</li>
        ))}
      </ul>
      <p className="text-xs text-subtle">{`Backpack: ${heroData.backpack.length}/${heroData.backpackCapacity}`}</p>
    </section>
  );
}

/** The always-visible collapsed form of `HeroPanel`: health, hunger stage, and light state as
 * text, nothing more. */
export function VitalsStrip({ snapshot }: PanelProps): JSX.Element {
  const heroData = hero(snapshot);
  return (
    <div
      aria-label="Vitals"
      className="flex gap-4 border-b border-line bg-surface px-2 py-1 text-xs text-fg"
    >
      <span>{`${heroData.health}/${heroData.maxHealth} HP`}</span>
      <span>{`Hunger: ${heroData.hungerStage}`}</span>
      <span>{`Light: ${lightStateText(heroData.equipment)}`}</span>
    </div>
  );
}
