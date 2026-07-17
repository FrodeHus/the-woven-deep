import type { JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { TILE_DEFINITIONS } from '@woven-deep/engine';
import { HINTS } from '../../session/onboarding.js';
import {
  ACTION_IDS, ACTION_LABELS, chordKey, type ActionId, type ResolvedKeymap,
} from '../../session/settings.js';

export interface HelpOverlayProps {
  /** The live resolved keymap (defaults merged with any rebinding) -- every chord this overlay
   * shows comes from here, never a hardcoded key literal, so a rebind is reflected immediately. */
  readonly keymap: ResolvedKeymap;
  /** The compiled content pack -- the glyph legend is derived from its entries at render time, so
   * new monsters/items/vault fixtures show up automatically with no hand-maintained list here. */
  readonly pack: CompiledContentPack;
}

const MOVEMENT_ACTIONS: readonly ActionId[] = ACTION_IDS.filter((id) => id.startsWith('move.'));
const SCREEN_ACTIONS: readonly ActionId[] = ['character-sheet', 'map-journal', 'codex', 'settings', 'help'];
const ACTION_ACTIONS: readonly ActionId[] = ACTION_IDS.filter(
  (id) => !MOVEMENT_ACTIONS.includes(id) && !SCREEN_ACTIONS.includes(id),
);

function ControlsRow({ action, keymap }: Readonly<{ action: ActionId; keymap: ResolvedKeymap }>): JSX.Element {
  return (
    <li>
      <span className="help-controls-label">{ACTION_LABELS[action]}</span>
      <span className="help-controls-chord">{chordKey(keymap.byAction[action])}</span>
    </li>
  );
}

/**
 * The controls section: one row per `ActionId`, grouped movement/actions/screens, every chord read
 * live from `keymap.byAction` -- rebinding an action (e.g. inventory to `p`) changes what this
 * section renders with no code change here. The two hardwired facts that are NOT part of the
 * rebindable keymap (arrow/numpad keys always move; Escape always closes the open screen -- see
 * `settings.ts`'s `chordReserved` and `OverlayScaffold`'s Escape handler) are called out as their
 * own fixed notes so a guest doesn't go looking for them in the bindings list.
 */
function ControlsSection({ keymap }: Readonly<{ keymap: ResolvedKeymap }>): JSX.Element {
  return (
    <section aria-labelledby="help-controls-heading">
      <h3 id="help-controls-heading">Controls</h3>

      <h4>Movement</h4>
      <ul className="help-controls-list">
        {MOVEMENT_ACTIONS.map((action) => <ControlsRow key={action} action={action} keymap={keymap} />)}
      </ul>
      <p className="help-controls-note">Arrow keys and the numpad always move too -- always available, not rebindable.</p>

      <h4>Actions</h4>
      <ul className="help-controls-list">
        {ACTION_ACTIONS.map((action) => <ControlsRow key={action} action={action} keymap={keymap} />)}
      </ul>

      <h4>Screens</h4>
      <ul className="help-controls-list">
        {SCREEN_ACTIONS.map((action) => <ControlsRow key={action} action={action} keymap={keymap} />)}
      </ul>
      <p className="help-controls-note">Escape closes whatever screen is currently open.</p>
    </section>
  );
}

function rgbToCss(color: readonly [number, number, number]): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

/* Fixtures carry no display name in the content model, only an authoring token like
 * "fixture.standing-lamp" -- turn the last segment into readable copy ("Standing lamp"). */
function fixtureLabel(token: string): string {
  const segment = token.split('.').at(-1) ?? token;
  const words = segment.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
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
 * with no mention of a sighting gate, and the (separately gated) codex is Task 8's job. Rendering
 * every pack entry here is therefore intentional, not an oversight -- flagged in the task report
 * for review to weigh.
 */
function GlyphLegendSection({ pack }: Readonly<{ pack: CompiledContentPack }>): JSX.Element {
  const monsters = pack.entries.filter((entry) => entry.kind === 'monster');
  const items = pack.entries.filter((entry) => entry.kind === 'item');
  const fixtures = collectLightFixtures(pack);

  return (
    <section aria-labelledby="help-legend-heading">
      <h3 id="help-legend-heading">Glyph legend</h3>

      <h4>Hero</h4>
      <ul className="help-legend-list">
        <li><span className="help-legend-glyph">@</span><span>You</span></li>
      </ul>

      <h4>Creatures</h4>
      <ul className="help-legend-list">
        {monsters.map((monster) => (
          <li key={monster.id}>
            <span className="help-legend-glyph" style={{ color: monster.color }}>{monster.glyph}</span>
            <span>{monster.name}</span>
          </li>
        ))}
      </ul>

      <h4>Items</h4>
      <ul className="help-legend-list">
        {items.map((item) => (
          <li key={item.id}>
            <span className="help-legend-glyph" style={{ color: item.color }}>{item.glyph}</span>
            <span>{item.name}</span>
            <span className="help-legend-category">({item.category})</span>
          </li>
        ))}
      </ul>

      <h4>Terrain</h4>
      <ul className="help-legend-list">
        {TILE_DEFINITIONS.map((tile) => (
          <li key={tile.id}>
            <span className="help-legend-glyph">{tile.glyph === ' ' ? ' ' : tile.glyph}</span>
            <span>{tile.name}</span>
          </li>
        ))}
      </ul>

      <h4>Light fixtures</h4>
      <ul className="help-legend-list">
        {fixtures.map((fixture) => (
          <li key={fixture.token}>
            <span className="help-legend-glyph" style={{ color: rgbToCss(fixture.color) }}>{fixture.glyph}</span>
            <span>{fixtureLabel(fixture.token)}</span>
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
    <section aria-labelledby="help-mechanics-heading">
      <h3 id="help-mechanics-heading">Mechanics notes</h3>
      <dl className="help-mechanics-list">
        <dt>Hunger</dt>
        <dd>
          Every action spends food. As your reserve drops you pass through sated, hungry, weak, and
          starving -- each stage weighs on your fighting ability more than the last. Eat before you
          reach the bottom.
        </dd>

        <dt>Light and fuel</dt>
        <dd>
          A lit source burns fuel every turn it's carried or placed and eventually gutters out.
          Refuel, extinguish, or relight it from your backpack. Some creatures hunt light, some flee
          it, and some only show themselves in the dark.
        </dd>

        <dt>Identification</dt>
        <dd>
          An unidentified potion, scroll, or ring shows only its appearance -- a made-up name and a
          look, not what it does. Using one, or having it identified, reveals the truth for every
          item that shares that appearance for the rest of the run.
        </dd>

        <dt>The town truce</dt>
        <dd>
          Town holds a truce: no monster attacks you there, and your own hostile actions are
          refused. Time and light fuel still pass as you walk, but rest is uninterrupted and
          merchants only restock at real milestones, not by walking in and out.
        </dd>

        <dt>Death is final</dt>
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
 * Every contextual onboarding hint's copy (Task 8's `HINTS`, `onboarding.ts`), in priority order,
 * rendered live from `keymap` -- a rebind changes what this section shows exactly like the
 * controls section above, and it lists every hint regardless of whether the guest has already
 * mastered/dismissed it (this is a reference list, not a live mirror of `activeHint`'s current
 * pick -- that state lives on the play screen, not here).
 */
function GuidanceSection({ keymap }: Readonly<{ keymap: ResolvedKeymap }>): JSX.Element {
  return (
    <section aria-labelledby="help-guidance-heading">
      <h3 id="help-guidance-heading">Guidance</h3>
      <ul className="help-guidance-list">
        {HINTS.map((hint) => <li key={hint.id}>{hint.copy(keymap)}</li>)}
      </ul>
    </section>
  );
}

/**
 * The help overlay body: controls, glyph legend, mechanics notes, guidance, in that order. Purely
 * presentational content inside `OverlayScaffold`'s dialog frame (focus trap, Escape-close) --
 * there's nothing here for a guest to change, so the sections are static and scroll natively; the
 * scaffold's own fallback (focusing the dialog container itself when it holds no interactive
 * control) keeps arrow/Page Up/Page Down keyboard scrolling working with no extra wiring.
 */
export function HelpOverlay({ keymap, pack }: HelpOverlayProps): JSX.Element {
  return (
    <div className="help-overlay">
      <ControlsSection keymap={keymap} />
      <GlyphLegendSection pack={pack} />
      <MechanicsSection />
      <GuidanceSection keymap={keymap} />
    </div>
  );
}
