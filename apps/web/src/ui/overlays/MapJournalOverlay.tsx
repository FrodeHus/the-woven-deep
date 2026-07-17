import { useRef, useState, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SessionSnapshot } from '../../session/guest-session.js';

/**
 * The current-milestone objective line -- static text, sourced from this one exported constant so
 * a later milestone (7, per the plan) can wire the real, dynamic objective without touching this
 * overlay's rendering at all. Deliberately not derived from any projection field: no such field
 * exists today (see the plan's Global Constraints -- this task adds zero new projection fields).
 */
export const JOURNAL_OBJECTIVE = 'Reach the Heart of the Deep, then find your way back out alive.';

type MapJournalTab = 'map' | 'journal';

const TAB_ORDER: readonly MapJournalTab[] = ['map', 'journal'];
const TAB_LABEL: Readonly<Record<MapJournalTab, string>> = { map: 'Map', journal: 'Journal' };
const TAB_ID: Readonly<Record<MapJournalTab, string>> = {
  map: 'map-journal-tab-map',
  journal: 'map-journal-tab-journal',
};
const PANEL_ID: Readonly<Record<MapJournalTab, string>> = {
  map: 'map-journal-panel-map',
  journal: 'map-journal-panel-journal',
};

/** The full `ObservableCell` shape this overlay reads (`packages/engine/src/projection.ts`) --
 * every field reused verbatim, never re-derived: `knowledge` decides which of the three render
 * branches a cell takes, `glyph`/`tint`/`intensity` are painted exactly as the engine reports them
 * (the same discipline `GridRenderer` already follows for the camera-limited play view). */
interface ProjectedCell {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly knowledge: 'unknown' | 'remembered' | 'visible';
  readonly tileId?: number;
  readonly glyph?: string;
  readonly tint?: readonly [number, number, number];
  readonly intensity: number;
  readonly fixture?: Readonly<{ glyph: string }>;
}

interface ProjectedFloor {
  readonly floorId: string;
  readonly town: boolean;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly ProjectedCell[];
}

interface ProjectedHero {
  readonly x: number;
  readonly y: number;
}

interface ProjectedActor {
  readonly x: number;
  readonly y: number;
  readonly glyph?: string;
  readonly name?: string;
  readonly factionName?: string;
}

interface ProjectedPlacementSlot {
  readonly slotId: string;
  readonly tags: readonly string[];
  readonly x: number;
  readonly y: number;
}

/** Stair tile ids (`packages/engine/src/terrain.ts`'s `TILE_DEFINITIONS`) -- both share the same
 * `terrain.stair` token, so `tileId` (not `token`) is the only field that actually distinguishes
 * up from down; never re-derived here, just read straight off the projected cell. */
const STAIR_UP_TILE_ID = 4;
const STAIR_DOWN_TILE_ID = 5;

type CellCustomProperties = CSSProperties & { '--light'?: string; '--fg'?: string };

function byCell<T extends { x: number; y: number }>(items: readonly T[]): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(`${item.x},${item.y}`, item);
  return map;
}

/**
 * The map tab's grid: the FULL floor (not the camera-limited viewport `GridRenderer` draws during
 * play) at a fixed, compact cell size -- `--map-cell` is its own custom property (deliberately
 * distinct from the playfield's zoom-scaled `--cell-w`/`--cell-h`), so this pane's cell size never
 * changes with the guest's play-zoom or font-scale setting. The pane itself scrolls
 * (`.map-journal-map-pane`'s `overflow: auto`) rather than clipping, since even a large floor must stay fully
 * reachable at a fixed cell size.
 *
 * Every branch below reuses the cell's own `knowledge`/`glyph`/`tint`/`intensity` verbatim -- an
 * `unknown` cell renders no glyph at all (blank), a `remembered` cell renders its glyph dim (same
 * `cell.glyph` a `visible` reading of that same tile would show -- terrain doesn't change once
 * explored), and a `visible` cell renders lit, with the hero's own marker and any actor glyph
 * layered on top exactly as `GridRenderer` does. `projection.actors` is visible-only by
 * construction (`projectGameplayState`'s actor filter drops anything not currently perceived), so
 * layering actor glyphs unconditionally here can never leak an actor onto a non-visible cell.
 *
 * This pane deliberately omits `groundItems` overlays -- it paints actors/hero/stairs only, per
 * the brief -- so a future reader diffing this against `GridRenderer` (which does layer ground
 * items) should read that as intentional scope, not an oversight.
 */
function MapPane({ floor, hero, actors, panelId, tabId }: Readonly<{
  floor: ProjectedFloor;
  hero: ProjectedHero;
  actors: readonly ProjectedActor[];
  panelId: string;
  tabId: string;
}>): JSX.Element {
  const actorsByCell = byCell(actors);

  return (
    <div
      className="map-journal-map-pane"
      style={{ '--map-cell': '0.6em' } as CSSProperties}
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      tabIndex={0}
    >
      <div
        role="grid"
        aria-label="Floor map"
        className="map-grid"
        style={{ gridTemplateColumns: `repeat(${floor.width}, var(--map-cell))` }}
      >
        {floor.cells.map((cell) => {
          if (cell.knowledge === 'unknown') {
            return <span key={cell.index} className="map-cell map-cell-unknown" />;
          }

          if (cell.knowledge === 'remembered') {
            return (
              <span key={cell.index} className="map-cell map-cell-remembered">
                {cell.glyph ?? ''}
              </span>
            );
          }

          const isHero = cell.x === hero.x && cell.y === hero.y;
          const actor = actorsByCell.get(`${cell.x},${cell.y}`);
          const glyph = isHero ? '@' : (actor?.glyph ?? cell.fixture?.glyph ?? cell.glyph ?? '');
          const style: CellCustomProperties = { '--light': String(cell.intensity / 255) };
          if (cell.tint) style['--fg'] = `rgb(${cell.tint[0]}, ${cell.tint[1]}, ${cell.tint[2]})`;

          return (
            <span
              key={cell.index}
              className="map-cell map-cell-visible"
              style={style}
              {...(isHero ? { 'aria-label': `Hero at ${cell.x}, ${cell.y}` } : {})}
            >
              {glyph}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** A single landmark row: `label` is the disclosed, human-readable name; `key` is a stable React
 * key (slot/actor id, or a fixed literal for the two stair rows). */
interface Landmark {
  readonly key: string;
  readonly label: string;
}

/**
 * Landmarks are derived fresh on every render from fields the projection already exposes -- no new
 * engine state, no new projection fields (per the plan's Global Constraints):
 *
 * - **Stairs seen**: any floor cell whose `knowledge` is `remembered` or `visible` and whose
 *   `tileId` is the stair-up/stair-down id. Works identically in town or a dungeon floor.
 * - **Merchants met + the house**: in town, `projection.slots` is always the three authored
 *   merchant slots plus the house door (the ONLY floor where `slots` is ever populated -- a
 *   dungeon floor's `slots` is `[]` by the engine's own spoiler guard, `projection.ts`'s `slots`
 *   comment), so those slots are the honest, always-current source there. Off in a dungeon, there
 *   are no slots to read, so a "merchant met" landmark instead comes from `projection.actors` --
 *   visible-only by construction -- filtered to the same "carries a `factionName`" signal
 *   `TownPanel` already uses to recognize a merchant actor. The two sources are never combined for
 *   the same floor: town always has slots (never actors duplicating the same three merchants
 *   in this list), a dungeon floor never has slots at all.
 */
function landmarksFor(floor: ProjectedFloor, actors: readonly ProjectedActor[], slots: readonly ProjectedPlacementSlot[]): readonly Landmark[] {
  const landmarks: Landmark[] = [];

  const stairUpSeen = floor.cells.some((cell) => cell.knowledge !== 'unknown' && cell.tileId === STAIR_UP_TILE_ID);
  if (stairUpSeen) landmarks.push({ key: 'stair-up', label: 'Stairs up (seen)' });
  const stairDownSeen = floor.cells.some((cell) => cell.knowledge !== 'unknown' && cell.tileId === STAIR_DOWN_TILE_ID);
  if (stairDownSeen) landmarks.push({ key: 'stair-down', label: 'Stairs down (seen)' });

  if (floor.town) {
    for (const slot of slots) {
      if (slot.tags.includes('house-door')) {
        landmarks.push({ key: slot.slotId, label: 'The house' });
        continue;
      }
      if (slot.tags.includes('merchant')) {
        // The third tag beyond `town`/`merchant` names the trade (e.g. `provisioner`, `arms`,
        // `curios`) -- see `content/vaults/town.yaml`'s merchant slot tags.
        const trade = slot.tags.find((tag) => tag !== 'town' && tag !== 'merchant') ?? 'merchant';
        landmarks.push({ key: slot.slotId, label: `${trade.charAt(0).toUpperCase()}${trade.slice(1)} (met)` });
      }
    }
    return landmarks;
  }

  for (const actor of actors) {
    if (typeof actor.factionName !== 'string') continue;
    landmarks.push({ key: `${actor.name ?? actor.factionName}`, label: `${actor.name ?? actor.factionName} (met)` });
  }
  return landmarks;
}

function JournalPane({ snapshot, panelId, tabId }: Readonly<{
  snapshot: SessionSnapshot;
  panelId: string;
  tabId: string;
}>): JSX.Element {
  const floor = snapshot.projection.floor as unknown as ProjectedFloor;
  const actors = snapshot.projection.actors as unknown as readonly ProjectedActor[];
  const slots = snapshot.projection.slots as unknown as readonly ProjectedPlacementSlot[];
  const landmarks = landmarksFor(floor, actors, slots);

  return (
    <div className="journal-pane" role="tabpanel" id={panelId} aria-labelledby={tabId} tabIndex={0}>
      <p className="journal-objective">{JOURNAL_OBJECTIVE}</p>

      <section aria-labelledby="journal-landmarks-heading">
        <h3 id="journal-landmarks-heading">Landmarks</h3>
        {landmarks.length === 0
          ? <p className="placeholder">Nothing landmark-worthy seen yet.</p>
          : (
            <ul className="journal-landmarks" aria-label="Landmarks">
              {landmarks.map((landmark) => <li key={landmark.key}>{landmark.label}</li>)}
            </ul>
          )}
      </section>

      <section aria-labelledby="journal-log-heading">
        <h3 id="journal-log-heading">Adventure log</h3>
        {/* The FULL retained log history (up to `LOG_CAPACITY` = 200 lines), not the 8-line
            conclusion tail `App.tsx` shows on the run-ending screen -- `snapshot.log` is the same
            array either consumer reads, this one just never slices it. Newest last, matching the
            order `foldEventsIntoLog` already appends in (oldest first). */}
        <ul className="journal-log" aria-label="Adventure log">
          {snapshot.log.map((line) => (
            <li key={line.id} className={`journal-log-line journal-log-line--${line.tone}`}>{line.text}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export interface MapJournalOverlayProps {
  readonly snapshot: SessionSnapshot;
}

/**
 * Map & journal, as two tabs sharing one overlay body. **Tab switching is deliberately NOT bound
 * to the literal `Tab` key** the brief suggests: `Tab` is already load-bearing here for
 * `useDialogFocusTrap`'s native focus-order wrapping between this pane's own focusable elements
 * (the two tab buttons) -- exactly the same conflict Task 5 (`InventoryOverlay`'s filter/sort)
 * hit and resolved by picking different keys. Here, ArrowLeft/ArrowRight cycle the active tab
 * instead -- the standard ARIA tablist keyboard convention (see the `role="tablist"` markup
 * below), which reads naturally as "switch tabs" without colliding with Tab's own focus-movement
 * job. The tabs are also plainly clickable, matching the brief's "also clickable".
 */
export function MapJournalOverlay({ snapshot }: MapJournalOverlayProps): JSX.Element {
  const [tab, setTab] = useState<MapJournalTab>('map');
  const floor = snapshot.projection.floor as unknown as ProjectedFloor;
  const hero = snapshot.projection.hero as unknown as ProjectedHero;
  const actors = snapshot.projection.actors as unknown as readonly ProjectedActor[];

  // Roving-tabindex bookkeeping: only the active tab button is ever in the Tab order
  // (`tabIndex=0`), the inactive one is `-1` -- the standard ARIA tablist convention. These refs
  // exist solely so ArrowLeft/ArrowRight can move DOM focus to match, since updating `tab` state
  // alone repaints `aria-selected` but never moves the screen reader/keyboard focus itself.
  const tabButtonRefs = useRef<Record<MapJournalTab, HTMLButtonElement | null>>({ map: null, journal: null });

  const handleTablistKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const currentIndex = TAB_ORDER.indexOf(tab);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + delta + TAB_ORDER.length) % TAB_ORDER.length;
    const nextTab = TAB_ORDER[nextIndex]!;
    setTab(nextTab);
    tabButtonRefs.current[nextTab]?.focus();
  };

  return (
    <div className="map-journal-overlay">
      <div
        role="tablist"
        aria-label="Map and journal"
        className="map-journal-tablist"
        tabIndex={-1}
        onKeyDown={handleTablistKeyDown}
      >
        {TAB_ORDER.map((candidate) => (
          <button
            key={candidate}
            ref={(element) => { tabButtonRefs.current[candidate] = element; }}
            type="button"
            role="tab"
            id={TAB_ID[candidate]}
            aria-selected={candidate === tab}
            aria-controls={PANEL_ID[candidate]}
            tabIndex={candidate === tab ? 0 : -1}
            className={candidate === tab ? 'map-journal-tab map-journal-tab--active' : 'map-journal-tab'}
            onClick={() => setTab(candidate)}
          >
            {TAB_LABEL[candidate]}
          </button>
        ))}
      </div>
      {tab === 'map'
        ? <MapPane floor={floor} hero={hero} actors={actors} panelId={PANEL_ID.map} tabId={TAB_ID.map} />
        : <JournalPane snapshot={snapshot} panelId={PANEL_ID.journal} tabId={TAB_ID.journal} />}
      <p className="map-journal-hints">← → switch tab · Esc close</p>
    </div>
  );
}
