import { useEffect, useRef, type CSSProperties, type JSX } from 'react';
import type { SessionSnapshot } from '../session/guest-session.js';
import type { LogLine } from '../session/event-log.js';
import { pickPrimaryCondition } from './effects-map.js';

export interface PanelProps {
  readonly snapshot: SessionSnapshot;
}

interface ProjectedEquippedItem { readonly itemId: string; readonly name: string }

interface ProjectedBackpackItem { readonly itemId: string; readonly name: string }

interface ProjectedCondition {
  readonly conditionId: string; readonly name: string; readonly color: string;
  readonly stacks: number; readonly remaining: number | null;
}

interface ProjectedHero {
  readonly name: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly hungerStage: string;
  readonly conditions: readonly ProjectedCondition[];
  readonly equipment: Readonly<Record<string, ProjectedEquippedItem | null>>;
  readonly backpack: readonly ProjectedBackpackItem[];
  readonly backpackCapacity: number;
}

function hero(snapshot: SessionSnapshot): ProjectedHero {
  return snapshot.projection.hero as unknown as ProjectedHero;
}

/** Text description of the hero's equipped light, honestly derived from whatever is enabled in an
 * off-hand or main-hand slot with `enabled: true` — the projection has no single "light state"
 * field, so this mirrors the same "first enabled light source wins" rule `EffectsLayer` uses. */
function lightStateText(equipment: ProjectedHero['equipment']): string {
  const lit = Object.values(equipment).some((item) =>
    item !== null && (item as unknown as { enabled?: boolean }).enabled === true);
  return lit ? 'Lit' : 'Dark';
}

export function HeroPanel({ snapshot }: PanelProps): JSX.Element {
  const heroData = hero(snapshot);
  const healthRatio = heroData.maxHealth > 0 ? heroData.health / heroData.maxHealth : 0;
  return (
    <section aria-label="Hero" className="hero-panel framed">
      <h2 className="framed-title">{heroData.name}</h2>
      <p className="vital-text">{`${heroData.health}/${heroData.maxHealth} HP`}</p>
      <div className="bar" aria-hidden="true">
        <div className="bar-fill" style={{ '--fill': healthRatio } as CSSProperties} />
      </div>
      <p className="vital-text">{`Hunger: ${heroData.hungerStage}`}</p>
      <p className="vital-text">{`Light: ${lightStateText(heroData.equipment)}`}</p>
      {heroData.conditions.length > 0 && (
        <ul className="condition-list">
          {heroData.conditions.map((condition) => <li key={condition.conditionId}>{condition.name}</li>)}
        </ul>
      )}
      <ul className="equipment-list">
        {Object.entries(heroData.equipment).map(([slot, item]) => (
          <li key={slot}>{`${slot}: ${item ? item.name : 'empty'}`}</li>
        ))}
      </ul>
      <p className="backpack-summary">{`Backpack: ${heroData.backpack.length}/${heroData.backpackCapacity}`}</p>
    </section>
  );
}

/** The always-visible collapsed form of `HeroPanel` at the `minimal` layout tier: health, hunger
 * stage, and light state as text, nothing more. */
export function VitalsStrip({ snapshot }: PanelProps): JSX.Element {
  const heroData = hero(snapshot);
  return (
    <div className="vitals-strip" aria-label="Vitals">
      <span>{`${heroData.health}/${heroData.maxHealth} HP`}</span>
      <span>{`Hunger: ${heroData.hungerStage}`}</span>
      <span>{`Light: ${lightStateText(heroData.equipment)}`}</span>
    </div>
  );
}

export interface ProjectedThreatActor {
  readonly actorId: string;
  readonly name?: string;
  readonly glyph?: string;
  readonly disposition: string;
  readonly healthPresentation: { readonly band: string };
  readonly intentPresentation?: string;
}

interface ProjectedGroundItem {
  readonly itemId: string;
  readonly name: string;
}

function threatActors(snapshot: SessionSnapshot): readonly ProjectedThreatActor[] {
  return (snapshot.projection.actors as unknown as readonly ProjectedThreatActor[])
    .filter((actor) => actor.disposition === 'hostile');
}

function groundItems(snapshot: SessionSnapshot): readonly ProjectedGroundItem[] {
  return snapshot.projection.groundItems as unknown as readonly ProjectedGroundItem[];
}

export function ThreatPanel({ snapshot }: PanelProps): JSX.Element {
  const hostiles = threatActors(snapshot);
  const items = groundItems(snapshot);
  const nothingNearby = hostiles.length === 0 && items.length === 0;
  return (
    <section aria-label="Threats" className="threat-panel framed">
      {nothingNearby && <p className="placeholder">Nothing nearby.</p>}
      {hostiles.length > 0 && (
        <ul className="threat-list">
          {hostiles.map((actor) => (
            <li key={actor.actorId}>
              <span aria-hidden="true">{actor.glyph}</span>
              {` ${actor.name ?? 'Something'} — ${actor.healthPresentation.band}`}
              {actor.intentPresentation ? ` (${actor.intentPresentation})` : ''}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <>
          <p className="ground-item-label">On the ground nearby</p>
          <ul className="ground-item-list">
            {items.map((item) => <li key={item.itemId}>{item.name}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}

const TONE_CLASS: Record<LogLine['tone'], string> = {
  info: 'log-line--info',
  combat: 'log-line--combat',
  warning: 'log-line--warning',
  system: 'log-line--system',
};

export function LogPanel({ snapshot }: PanelProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const { log } = snapshot;

  useEffect(() => {
    const node = containerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log]);

  return (
    <div className="log-panel framed">
      <div ref={containerRef} role="log" aria-live="polite" aria-label="Adventure log" className="log-panel-scroll">
        {log.map((line) => (
          <p key={line.id} className={`log-line ${TONE_CLASS[line.tone]}`}>{line.text}</p>
        ))}
      </div>
    </div>
  );
}

/** `StatusBar` is the one panel that renders at EVERY layout tier (full/compact/minimal), unlike
 * `HeroPanel`'s own condition list (which collapses into a drawer at the `minimal` tier) -- so the
 * colorblind-safe condition badge lives here rather than there, guaranteeing it is always on
 * screen while any hero condition is active. This is the glyph badge Task 9's colorblind pass
 * verifies: a generic status-effect glyph (conditions carry no per-id glyph of their own in the
 * projection, only a `color`) PLUS the condition's name as text -- so meaning never rests on color
 * alone, even though the badge is also tinted via `--condition-color` for a sighted-color reader. */
export function StatusBar({ snapshot }: PanelProps): JSX.Element {
  const heroData = hero(snapshot);
  const { metrics, floor } = snapshot.projection;
  const primaryCondition = pickPrimaryCondition(heroData.conditions);
  return (
    <div className="status-bar" role="status">
      <span className="status-hero">{heroData.name}</span>
      <span className="status-depth">{floor.town ? 'Town' : `Depth ${floor.depth}`}</span>
      <span data-testid="turn-count">{`Turn ${metrics.turnsElapsed}`}</span>
      {primaryCondition && (
        <span
          className="condition-badge"
          title={primaryCondition.name}
          style={{ '--condition-color': primaryCondition.color } as CSSProperties}
        >
          <span aria-hidden="true">{'✺'}</span>
          {` ${primaryCondition.name}`}
        </span>
      )}
    </div>
  );
}
