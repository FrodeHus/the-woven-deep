import type { CSSProperties, JSX } from 'react';
import type { ObservableFloorProjection, ObservablePlacementSlot } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { actorsOf, heroOf, type ActorView, type HeroView } from '../../session/projection-view.js';
import { visibleForeground } from '../cell-color.js';
import { cn } from '../lib/cn.js';
import { useSessionCtx } from '../providers.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/tabs.js';

/**
 * The current-milestone objective line -- static text, sourced from this one exported constant so
 * a later milestone (7, per the plan) can wire the real, dynamic objective without touching this
 * overlay's rendering at all. Deliberately not derived from any projection field: no such field
 * exists today (see the plan's Global Constraints -- this task adds zero new projection fields).
 */
export const JOURNAL_OBJECTIVE = 'Reach the Heart of the Deep, then find your way back out alive.';

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

const MAP_CELL_STYLE = { width: 'var(--map-cell)', height: 'var(--map-cell)' } as const;

/**
 * The map tab's grid: the FULL floor (not the camera-limited viewport `GridRenderer` draws during
 * play) at a fixed, compact cell size -- `--map-cell` is its own custom property (deliberately
 * distinct from the playfield's zoom-scaled `--cell-w`/`--cell-h`), so this pane's cell size never
 * changes with the guest's play-zoom or font-scale setting. The pane itself scrolls rather than
 * clipping, since even a large floor must stay fully reachable at a fixed cell size.
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
function MapPane({ floor, hero, actors }: Readonly<{
  floor: ObservableFloorProjection;
  hero: HeroView;
  actors: readonly ActorView[];
}>): JSX.Element {
  const actorsByCell = byCell(actors);

  return (
    <div className="max-h-[60vh] overflow-auto" style={{ '--map-cell': '0.6em' } as CSSProperties}>
      <div
        role="grid"
        aria-label="Floor map"
        className="grid font-mono leading-none"
        style={{ gridTemplateColumns: `repeat(${floor.width}, var(--map-cell))`, gridAutoRows: 'var(--map-cell)', fontSize: 'var(--map-cell)' }}
      >
        {floor.cells.map((cell) => {
          if (cell.knowledge === 'unknown') {
            return <span key={cell.index} className="block text-center text-transparent" style={MAP_CELL_STYLE} />;
          }

          if (cell.knowledge === 'remembered') {
            return (
              <span key={cell.index} className="block text-center text-subtle opacity-55 saturate-50" style={MAP_CELL_STYLE}>
                {cell.glyph ?? ''}
              </span>
            );
          }

          const isHero = cell.x === hero.x && cell.y === hero.y;
          const actor = actorsByCell.get(`${cell.x},${cell.y}`);
          const glyph = isHero ? '@' : (actor?.glyph ?? cell.fixture?.glyph ?? cell.glyph ?? '');
          const style: CellCustomProperties = { ...MAP_CELL_STYLE, '--light': String(cell.intensity / 255) };
          if (cell.tint) style['--fg'] = visibleForeground(cell.tint, cell.intensity);

          return (
            <span
              key={cell.index}
              className="block text-center text-[color:var(--fg,var(--color-fg))]"
              style={{ ...style, opacity: `calc(0.62 + 0.38 * var(--light, 1))` }}
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
 * key -- `${kind}:${x}:${y}`, the SAME key scheme `PersistedLandmark`s below convert to, so a
 * landmark that is both currently live AND already persisted collapses to one row instead of two
 * (`mergeLandmarks`'s whole job). */
interface Landmark {
  readonly key: string;
  readonly label: string;
  /** Set only for merchant landmarks -- their disclosed name, used by `mergeLandmarks` to dedupe
   * by IDENTITY rather than position. Stairs and the house never move, so their `key` alone
   * (which already encodes position) is identity enough; a dungeon merchant can flee/defend once
   * provoked (`merchant-behavior`), so its position is not a stable identity. */
  readonly merchantName?: string;
}

/**
 * Landmarks are derived fresh on every render from fields the projection already exposes -- no new
 * engine state, no new projection fields (per the plan's Global Constraints). This is the LIVE half;
 * `JournalPane` unions it with the PERSISTED half (`persistedLandmarksFor`,
 * fed by `session/codex.ts`'s `accumulateLandmarks`) so a landmark survives even once it leaves the
 * current projection entirely (a merchant who has since departed, a floor left behind).
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
function landmarksFor(floor: ObservableFloorProjection, actors: readonly ActorView[], slots: readonly ObservablePlacementSlot[]): readonly Landmark[] {
  const landmarks: Landmark[] = [];

  const stairUpCell = floor.cells.find((cell) => cell.knowledge !== 'unknown' && cell.tileId === STAIR_UP_TILE_ID);
  if (stairUpCell) landmarks.push({ key: `stair-up:${stairUpCell.x}:${stairUpCell.y}`, label: 'Stairs up (seen)' });
  const stairDownCell = floor.cells.find((cell) => cell.knowledge !== 'unknown' && cell.tileId === STAIR_DOWN_TILE_ID);
  if (stairDownCell) landmarks.push({ key: `stair-down:${stairDownCell.x}:${stairDownCell.y}`, label: 'Stairs down (seen)' });

  if (floor.town) {
    for (const slot of slots) {
      if (slot.tags.includes('house-door')) {
        landmarks.push({ key: `house:${slot.x}:${slot.y}`, label: 'The house' });
        continue;
      }
      if (slot.tags.includes('merchant')) {
        // The third tag beyond `town`/`merchant` names the trade (e.g. `provisioner`, `arms`,
        // `curios`) -- see `content/vaults/town.yaml`'s merchant slot tags.
        const trade = slot.tags.find((tag) => tag !== 'town' && tag !== 'merchant') ?? 'merchant';
        landmarks.push({
          key: `merchant:${slot.x}:${slot.y}`, label: `${trade.charAt(0).toUpperCase()}${trade.slice(1)} (met)`,
        });
      }
    }
    return landmarks;
  }

  for (const actor of actors) {
    if (typeof actor.factionName !== 'string') continue;
    const name = actor.name ?? actor.factionName;
    landmarks.push({ key: `merchant:${actor.x}:${actor.y}`, label: `${name} (met)`, merchantName: name });
  }
  return landmarks;
}

/** The narrow slice of `session/codex.ts`'s `Landmark` (the PERSISTED shape) this overlay reads --
 * duck-typed rather than imported to keep this file's existing narrow-projection-slice convention
 * (see every other `Projected*` interface above). */
interface PersistedLandmark {
  readonly floorId: string;
  readonly kind: 'merchant' | 'stair-up' | 'stair-down' | 'house';
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

const PERSISTED_LANDMARK_LABEL: Readonly<Record<PersistedLandmark['kind'], (name: string) => string>> = {
  'stair-up': () => 'Stairs up (seen)',
  'stair-down': () => 'Stairs down (seen)',
  house: () => 'The house',
  merchant: (name) => `${name} (met)`,
};

/** Converts the persisted, cross-render landmark cache (filtered to the CURRENT floor -- a
 * landmark from a floor the guest has since left is not shown here; it is still safely retained in
 * storage for when Milestone 6's cross-run codex wants it) into the same `Landmark` row shape
 * `landmarksFor` produces, using the identical `${kind}:${x}:${y}` key so `mergeLandmarks` can tell
 * a persisted row apart from its still-live twin. */
function persistedLandmarksFor(floorId: string, persisted: readonly PersistedLandmark[]): readonly Landmark[] {
  return persisted
    .filter((landmark) => landmark.floorId === floorId)
    .map((landmark) => ({
      key: `${landmark.kind}:${landmark.x}:${landmark.y}`,
      label: PERSISTED_LANDMARK_LABEL[landmark.kind](landmark.name),
      ...(landmark.kind === 'merchant' ? { merchantName: landmark.name } : {}),
    }));
}

/** Live ∪ persisted, deduped by key -- the live row wins when both exist for the same key (it is
 * always at least as current as the persisted one), so a persisted twin of a still-visible
 * landmark never renders as a second, redundant row.
 *
 * Merchant landmarks get a SECOND dedup pass, by identity (`merchantName`) rather than position:
 * a dungeon merchant can flee/defend once provoked (`merchant-behavior`), so a persisted entry
 * frozen at its first-seen (x,y) and a live entry at the merchant's current (x,y) have different
 * keys and would otherwise both survive the position-keyed pass above as two rows for the same
 * merchant. Live wins here too, being the fresher position. Stairs and the house are exempt --
 * they never move, so position IS their identity, and this pass only ever touches entries carrying
 * `merchantName` (town's slot-derived merchant landmarks never set it, so town's already-safe
 * position dedup is untouched). */
function mergeLandmarks(live: readonly Landmark[], persisted: readonly Landmark[]): readonly Landmark[] {
  const byKey = new Map<string, Landmark>();
  for (const landmark of live) byKey.set(landmark.key, landmark);
  for (const landmark of persisted) if (!byKey.has(landmark.key)) byKey.set(landmark.key, landmark);

  const liveKeys = new Set(live.map((landmark) => landmark.key));
  const liveMerchantNames = new Set(
    live.flatMap((landmark) => (landmark.merchantName !== undefined ? [landmark.merchantName] : [])),
  );

  return [...byKey.values()].filter((landmark) => {
    if (landmark.merchantName === undefined) return true;
    if (liveKeys.has(landmark.key)) return true; // this IS the live row for its key -- always kept
    return !liveMerchantNames.has(landmark.merchantName); // a stale persisted twin of a live merchant -- drop it
  });
}

const LOG_TONE_CLASS: Readonly<Record<string, string>> = {
  warning: 'text-danger-fg',
  combat: 'text-accent',
  system: 'text-muted',
};

/** Colorblind reinforcement classes (`styles.css`'s `.journal-log-line--*::before` rules): a silent
 * leading glyph for each colored tone, so severity is never carried by `LOG_TONE_CLASS`'s text
 * color alone. `info` (and any tone absent from `LOG_TONE_CLASS`) gets no glyph. */
const LOG_REINFORCEMENT_CLASS: Readonly<Record<string, string>> = {
  warning: 'journal-log-line--warning',
  combat: 'journal-log-line--combat',
  system: 'journal-log-line--system',
};

function JournalPane({ snapshot }: Readonly<{ snapshot: SessionSnapshot }>): JSX.Element {
  const { projection } = snapshot;
  const floor = projection.floor;
  const actors = actorsOf(projection);
  const slots = projection.slots;
  const liveLandmarks = landmarksFor(floor, actors, slots);
  const persistedLandmarks = persistedLandmarksFor(floor.floorId, snapshot.sightings.landmarks);
  const landmarks = mergeLandmarks(liveLandmarks, persistedLandmarks);

  return (
    <div className="flex flex-col gap-3">
      <p className="italic text-accent">{JOURNAL_OBJECTIVE}</p>

      <section aria-labelledby="journal-landmarks-heading" className="flex flex-col gap-2">
        <h3 id="journal-landmarks-heading" className="font-serif text-sm text-fg-strong">Landmarks</h3>
        {landmarks.length === 0
          ? <p className="text-sm text-muted">Nothing landmark-worthy seen yet.</p>
          : (
            <ul className="flex list-none flex-col gap-1 p-0 text-sm" aria-label="Landmarks">
              {landmarks.map((landmark) => <li key={landmark.key}>{landmark.label}</li>)}
            </ul>
          )}
      </section>

      <section aria-labelledby="journal-log-heading" className="flex flex-col gap-2">
        <h3 id="journal-log-heading" className="font-serif text-sm text-fg-strong">Adventure log</h3>
        {/* The FULL retained log history (up to `LOG_CAPACITY` = 200 lines), not the 8-line
            conclusion tail `App.tsx` shows on the run-ending screen -- `snapshot.log` is the same
            array either consumer reads, this one just never slices it. Newest last, matching the
            order `foldEventsIntoLog` already appends in (oldest first). */}
        <ul className="flex max-h-[40vh] list-none flex-col gap-0.5 overflow-auto p-0 text-sm" aria-label="Adventure log">
          {snapshot.log.map((line) => (
            <li key={line.id} className={cn(LOG_TONE_CLASS[line.tone], LOG_REINFORCEMENT_CLASS[line.tone])}>{line.text}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * Map & journal, as two tabs sharing one overlay body -- built on the shadcn `Tabs` primitive
 * (`../components/tabs.js`, itself Base UI's `Tabs`), which owns tab switching, roving focus, and
 * the ARIA tab/tabpanel wiring; this component only supplies the two panes. Reads directly from
 * `useSessionCtx()` rather than taking props, since map & journal is play-scope (a session is
 * always present while this overlay can open) -- guards to rendering nothing if that invariant is
 * ever violated.
 */
export function MapJournalOverlay(): JSX.Element | null {
  const sessionCtx = useSessionCtx();
  if (!sessionCtx) return null;

  const { snapshot } = sessionCtx;
  const floor = snapshot.projection.floor;
  const hero = heroOf(snapshot.projection);
  const actors = actorsOf(snapshot.projection);

  return (
    <Tabs defaultValue="map" className="flex flex-col gap-3">
      <TabsList aria-label="Map and journal" activateOnFocus>
        <TabsTrigger value="map">Map</TabsTrigger>
        <TabsTrigger value="journal">Journal</TabsTrigger>
      </TabsList>
      <TabsContent value="map">
        <MapPane floor={floor} hero={hero} actors={actors} />
      </TabsContent>
      <TabsContent value="journal">
        <JournalPane snapshot={snapshot} />
      </TabsContent>
    </Tabs>
  );
}
