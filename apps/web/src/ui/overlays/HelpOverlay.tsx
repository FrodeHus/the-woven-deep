import type { JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { TILE_DEFINITIONS } from '@woven-deep/engine';
import { HINTS } from '../../session/onboarding.js';
import {
  ACTION_IDS, ACTION_LABELS, chordKey, type ActionId, type ResolvedKeymap,
} from '../../session/settings.js';
import { humanize } from '../labels.js';
import { usePack, useSettingsCtx } from '../providers.js';

const MOVEMENT_ACTIONS: readonly ActionId[] = ACTION_IDS.filter((id) => id.startsWith('move.'));
const SCREEN_ACTIONS: readonly ActionId[] = ['character-sheet', 'map-journal', 'codex', 'settings', 'help'];
const ACTION_ACTIONS: readonly ActionId[] = ACTION_IDS.filter(
  (id) => !MOVEMENT_ACTIONS.includes(id) && !SCREEN_ACTIONS.includes(id),
);

function ControlsRow({ action, keymap }: Readonly<{ action: ActionId; keymap: ResolvedKeymap }>): JSX.Element {
  return (
    <li className="flex items-center gap-3">
      <span className="min-w-40 text-sm">{ACTION_LABELS[action]}</span>
      <span className="min-w-16 font-mono text-sm text-muted">{chordKey(keymap.byAction[action])}</span>
    </li>
  );
}

/**
 * The controls section: one row per `ActionId`, grouped movement/actions/screens, every chord read
 * live from `keymap.byAction` -- rebinding an action (e.g. inventory to `p`) changes what this
 * section renders with no code change here. The two hardwired facts that are NOT part of the
 * rebindable keymap (arrow/numpad keys always move; Escape always closes the open screen -- see
 * `settings.ts`'s `chordReserved` and `OverlayHost`'s `Dialog`/`Sheet` Escape handling) are called
 * out as their own fixed notes so a guest doesn't go looking for them in the bindings list.
 */
function ControlsSection({ keymap }: Readonly<{ keymap: ResolvedKeymap }>): JSX.Element {
  return (
    <section aria-labelledby="help-controls-heading" className="flex flex-col gap-2">
      <h3 id="help-controls-heading" className="text-sm font-semibold text-fg-strong">Controls</h3>

      <h4 className="text-sm font-semibold text-fg-strong">Movement</h4>
      <ul className="flex flex-col gap-1">
        {MOVEMENT_ACTIONS.map((action) => <ControlsRow key={action} action={action} keymap={keymap} />)}
      </ul>
      <p className="text-sm text-muted">Arrow keys and the numpad always move too -- always available, not rebindable.</p>

      <h4 className="text-sm font-semibold text-fg-strong">Actions</h4>
      <ul className="flex flex-col gap-1">
        {ACTION_ACTIONS.map((action) => <ControlsRow key={action} action={action} keymap={keymap} />)}
      </ul>

      <h4 className="text-sm font-semibold text-fg-strong">Screens</h4>
      <ul className="flex flex-col gap-1">
        {SCREEN_ACTIONS.map((action) => <ControlsRow key={action} action={action} keymap={keymap} />)}
      </ul>
      <p className="text-sm text-muted">Escape closes whatever screen is currently open.</p>
    </section>
  );
}

function rgbToCss(color: readonly [number, number, number]): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

/**
 * Every light fixture a vault legend can place, deduplicated by `presentationToken` (multiple
 * vaults reuse the same fixture presentation). Derived from the pack's own vault entries -- no
 * hand-maintained fixture list.
 */
function collectLightFixtures(pack: CompiledContentPack): ReadonlyArray<Readonly<{
  token: string; glyph: string; color: readonly [number, number, number];
}>> {
  const seen = new Map<string, Readonly<{ token: string; glyph: string; color: readonly [number, number, number] }>>();
  for (const entry of pack.entries) {
    if (entry.kind !== 'vault') continue;
    for (const legendEntry of Object.values(entry.legend)) {
      const light = legendEntry.light;
      if (!light || !light.enabled) continue;
      if (seen.has(light.presentationToken)) continue;
      seen.set(light.presentationToken, { token: light.presentationToken, glyph: light.glyph, color: light.color });
    }
  }
  return Array.from(seen.values());
}

/**
 * The glyph legend: hero, every monster and item the pack defines (name + glyph + color, straight
 * from `PresentedContentEntry`), the engine's own terrain vocabulary (`TILE_DEFINITIONS` --
 * imported, not re-declared, so it can never drift from what the floor renderer actually uses),
 * and vault-authored light fixtures. This is a reference manual, not a discovery-gated surface: the
 * master design describes Help as "keyboard reference, glyph legend, and mechanics explanations"
 * with no mention of a sighting gate; the (separately gated) codex serves the discovery-gated
 * purpose instead. Rendering every pack entry here is therefore intentional, not an oversight.
 */
function GlyphLegendSection({ pack }: Readonly<{ pack: CompiledContentPack }>): JSX.Element {
  const monsters = pack.entries.filter((entry) => entry.kind === 'monster');
  const items = pack.entries.filter((entry) => entry.kind === 'item');
  const fixtures = collectLightFixtures(pack);

  return (
    <section aria-labelledby="help-legend-heading" className="flex flex-col gap-2">
      <h3 id="help-legend-heading" className="text-sm font-semibold text-fg-strong">Glyph legend</h3>

      <h4 className="text-sm font-semibold text-fg-strong">Hero</h4>
      <ul className="flex flex-col gap-1">
        <li className="flex items-center gap-3">
          <span className="min-w-6 font-mono text-sm">@</span>
          <span className="text-sm">You</span>
        </li>
      </ul>

      <h4 className="text-sm font-semibold text-fg-strong">Creatures</h4>
      <ul className="flex flex-col gap-1">
        {monsters.map((monster) => (
          <li key={monster.id} className="flex items-center gap-3">
            <span className="min-w-6 font-mono text-sm" style={{ color: monster.color }}>{monster.glyph}</span>
            <span className="text-sm">{monster.name}</span>
          </li>
        ))}
      </ul>

      <h4 className="text-sm font-semibold text-fg-strong">Items</h4>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            <span className="min-w-6 font-mono text-sm" style={{ color: item.color }}>{item.glyph}</span>
            <span className="text-sm">{item.name}</span>
            <span className="text-sm text-muted">({item.category})</span>
          </li>
        ))}
      </ul>

      <h4 className="text-sm font-semibold text-fg-strong">Terrain</h4>
      <ul className="flex flex-col gap-1">
        {TILE_DEFINITIONS.map((tile) => (
          <li key={tile.id} className="flex items-center gap-3">
            <span className="min-w-6 font-mono text-sm">{tile.glyph === ' ' ? ' ' : tile.glyph}</span>
            <span className="text-sm">{tile.name}</span>
          </li>
        ))}
      </ul>

      <h4 className="text-sm font-semibold text-fg-strong">Light fixtures</h4>
      <ul className="flex flex-col gap-1">
        {fixtures.map((fixture) => (
          <li key={fixture.token} className="flex items-center gap-3">
            <span className="min-w-6 font-mono text-sm" style={{ color: rgbToCss(fixture.color) }}>{fixture.glyph}</span>
            <span className="text-sm">{humanize(fixture.token)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Short static prose covering the mechanics a guest can't infer from the controls or the legend
 * alone -- hunger, light/fuel, identification, the town truce, and death's finality. Deliberately
 * NOT derived from content data (there's no single source for this; the design spec states these
 * rules in prose, not YAML), so this section is hand-written and reviewed like any other copy.
 */
function MechanicsSection(): JSX.Element {
  return (
    <section aria-labelledby="help-mechanics-heading" className="flex flex-col gap-2">
      <h3 id="help-mechanics-heading" className="text-sm font-semibold text-fg-strong">Mechanics notes</h3>
      <dl className="flex flex-col gap-2 text-sm">
        <dt className="font-semibold text-fg-strong">Hunger</dt>
        <dd>
          Every action spends food. As your reserve drops you pass through sated, hungry, weak, and
          starving -- each stage weighs on your fighting ability more than the last. Eat before you
          reach the bottom.
        </dd>

        <dt className="font-semibold text-fg-strong">Light and fuel</dt>
        <dd>
          A lit source burns fuel every turn it's carried or placed and eventually gutters out.
          Refuel, extinguish, or relight it from your backpack. Some creatures hunt light, some flee
          it, and some only show themselves in the dark.
        </dd>

        <dt className="font-semibold text-fg-strong">Identification</dt>
        <dd>
          An unidentified potion, scroll, or ring shows only its appearance -- a made-up name and a
          look, not what it does. Using one, or having it identified, reveals the truth for every
          item that shares that appearance for the rest of the run.
        </dd>

        <dt className="font-semibold text-fg-strong">The town truce</dt>
        <dd>
          Town holds a truce: no monster attacks you there, and your own hostile actions are
          refused. Time and light fuel still pass as you walk, but rest is uninterrupted and
          merchants only restock at real milestones, not by walking in and out.
        </dd>

        <dt className="font-semibold text-fg-strong">Death is final</dt>
        <dd>
          When your hero dies, the run ends there -- the hero, everything carried, and everything
          stored at the house are gone for good. Escaping with the Heart ends the run the other way.
          Either way the record is written and cannot be replayed.
        </dd>
      </dl>
    </section>
  );
}

/**
 * Every contextual onboarding hint's copy (`HINTS`, `onboarding.ts`), in priority order,
 * rendered live from `keymap` -- a rebind changes what this section shows exactly like the
 * controls section above, and it lists every hint regardless of whether the guest has already
 * mastered/dismissed it (this is a reference list, not a live mirror of `activeHint`'s current
 * pick -- that state lives on the play screen, not here).
 */
function GuidanceSection({ keymap }: Readonly<{ keymap: ResolvedKeymap }>): JSX.Element {
  return (
    <section aria-labelledby="help-guidance-heading" className="flex flex-col gap-2">
      <h3 id="help-guidance-heading" className="text-sm font-semibold text-fg-strong">Guidance</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {HINTS.map((hint) => <li key={hint.id}>{hint.copy(keymap)}</li>)}
      </ul>
    </section>
  );
}

/**
 * The help overlay body: controls, glyph legend, mechanics notes, guidance, in that order. Purely
 * presentational content inside `OverlayHost`'s `Dialog` frame (focus trap, Escape-close) -- there's
 * nothing here for a guest to change, so the sections are static and scroll natively. `keymap` and
 * `pack` are read straight from context (`useSettingsCtx`/`usePack`), the same convention every
 * other rebuilt overlay follows -- no props.
 */
export function HelpOverlay(): JSX.Element {
  const { keymap } = useSettingsCtx();
  const pack = usePack();
  return (
    <div className="flex flex-col gap-6">
      <ControlsSection keymap={keymap} />
      <GlyphLegendSection pack={pack} />
      <MechanicsSection />
      <GuidanceSection keymap={keymap} />
    </div>
  );
}
