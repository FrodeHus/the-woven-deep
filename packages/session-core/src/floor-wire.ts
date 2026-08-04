import type {
  GameplayProjection,
  ObservableCell,
  ObservableFloorProjection,
} from '@woven-deep/engine';
import type { ServerMessage, ServerRunSnapshot } from './ws-protocol.js';

/**
 * Cell transport for `/ws/play`.
 *
 * `projectFloor` emits one `ObservableCell` for EVERY cell of the floor grid, unknown ones
 * included. On a 160x50 dungeon floor that is 8,000 objects -- a ~527 KB JSON command reply of
 * which roughly 1.3% describes anything the player can perceive, since a freshly-entered floor has
 * only ~50 known cells. The guest client builds the identical array and never serializes it, which
 * is why only signed-in play felt slow.
 *
 * Two encodings fix that, and BOTH are needed:
 *
 * - `full` omits unknown cells entirely; the receiver materializes them from `width`/`height`.
 * - `patch` sends only the cells that changed since the last snapshot this connection sent.
 *
 * Omitting unknowns alone is not sufficient: an unknown cell costs ~65 B and a remembered one
 * ~105 B, so a fully-explored floor would encode LARGER than today's whole-grid payload. Only the
 * patch bounds the per-turn cost, because what changes per move is bounded by the hero's light
 * radius (measured: mean 51 cells, ~6.6 KB) rather than by how much has been explored.
 *
 * Everything else in `ServerRunSnapshot` is ~3.3 KB and ships whole, every message. That is the
 * deliberate simplification here: only cells are worth delta-encoding, so only cells are.
 */
export type WireFloorCells =
  | {
      readonly kind: 'full';
      /** Every cell whose `knowledge` is not `unknown`. Order is irrelevant; `index` is authority. */
      readonly knownCells: readonly ObservableCell[];
    }
  | {
      readonly kind: 'patch';
      /** The revision the receiver MUST already hold, or the patch does not apply and it must
       * resync. This is the revision of the last snapshot sent on this connection -- NOT
       * necessarily one less than this snapshot's own revision: a `rejected` reply carries an
       * unchanged revision, and a Wanderer rise-again lowers it. */
      readonly baseRevision: number;
      /** Whole-cell replacements keyed by `index`. A cell that has REVERTED to unknown (light-out
       * with `rememberedMapPersists: false`) appears here as an ordinary `knowledge: 'unknown'`
       * cell -- replacement, never field-level merging, so reversion needs no special case. */
      readonly changedCells: readonly ObservableCell[];
    };

export interface WireFloorProjection extends Omit<ObservableFloorProjection, 'cells'> {
  readonly cells: WireFloorCells;
}

export interface WireGameplayProjection extends Omit<GameplayProjection, 'floor'> {
  readonly floor: WireFloorProjection;
}

export interface WireRunSnapshot extends Omit<ServerRunSnapshot, 'projection'> {
  readonly projection: WireGameplayProjection;
}

/**
 * `ServerMessage` as it actually travels: identical in every respect except that the three
 * snapshot-carrying variants carry a {@link WireRunSnapshot}. Deriving it from `ServerMessage`
 * rather than restating it means a new snapshot-carrying variant cannot be added without this
 * following along.
 */
export type WireServerMessage = ServerMessage extends infer Message
  ? Message extends { readonly snapshot: ServerRunSnapshot }
    ? Omit<Message, 'snapshot'> & { readonly snapshot: WireRunSnapshot }
    : Message
  : never;

/** An unknown cell exactly as `projectFloor` emits one. Both of its unknown-producing branches
 * (unexplored-and-unseen, and light-out without remembered-map persistence) build this same shape,
 * so a receiver can reconstruct omitted cells byte-identically rather than approximately. */
function unknownCell(index: number, width: number): ObservableCell {
  return {
    index,
    x: index % width,
    y: Math.floor(index / width),
    knowledge: 'unknown',
    intensity: 0,
  };
}

function sameTint(left: ObservableCell['tint'], right: ObservableCell['tint']): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function sameFixture(left: ObservableCell['fixture'], right: ObservableCell['fixture']): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.lightId === right.lightId && left.glyph === right.glyph && left.token === right.token;
}

/** Field-by-field rather than `JSON.stringify` comparison: this runs across every cell of the grid
 * on every command, and stringifying 16,000 objects per turn would trade the wire cost for a CPU
 * one. Every field of `ObservableCell` is compared -- if a field is ever added there, it must be
 * added here too, or changes to it would stop being transmitted. */
export function sameCell(left: ObservableCell, right: ObservableCell): boolean {
  return (
    left.index === right.index &&
    left.x === right.x &&
    left.y === right.y &&
    left.knowledge === right.knowledge &&
    left.tileId === right.tileId &&
    left.glyph === right.glyph &&
    left.token === right.token &&
    left.intensity === right.intensity &&
    left.previewIntensity === right.previewIntensity &&
    sameTint(left.tint, right.tint) &&
    sameFixture(left.fixture, right.fixture)
  );
}

/**
 * Per-connection encoder. Holds the last cell array it emitted so the next snapshot can be sent as
 * a patch against it. State is in-memory and per-socket: a reconnect builds a new encoder, which
 * necessarily starts with a full sync, which is exactly the desired behaviour.
 */
export class FloorWireEncoder {
  private lastCells: readonly ObservableCell[] | null = null;
  private lastFloorId: string | null = null;
  private lastRevision = -1;

  /** Forces the next `encode` to emit a full sync. Used when the client reports it could not apply
   * a patch, and whenever this connection's continuity is in doubt. */
  reset(): void {
    this.lastCells = null;
    this.lastFloorId = null;
    this.lastRevision = -1;
  }

  encode(snapshot: ServerRunSnapshot): WireRunSnapshot {
    const floor = snapshot.projection.floor;
    // A floor change invalidates the cache wholesale: indices address a different grid, and the
    // dimensions themselves may differ (town is 34x16, dungeon floors 160x50).
    const canPatch = this.lastCells !== null && this.lastFloorId === floor.floorId;
    const cells: WireFloorCells = canPatch
      ? {
          kind: 'patch',
          baseRevision: this.lastRevision,
          changedCells: floor.cells.filter((cell, index) => {
            const previous = this.lastCells![index];
            return previous === undefined || !sameCell(previous, cell);
          }),
        }
      : { kind: 'full', knownCells: floor.cells.filter((cell) => cell.knowledge !== 'unknown') };

    this.lastCells = floor.cells;
    this.lastFloorId = floor.floorId;
    this.lastRevision = snapshot.revision;

    return {
      ...snapshot,
      projection: { ...snapshot.projection, floor: { ...floor, cells } },
    };
  }
}

/**
 * Per-connection decoder, the exact inverse of {@link FloorWireEncoder}. `decode` returns `null`
 * when a patch cannot be applied (no cached floor, a different floor, or a base revision the
 * receiver does not hold) -- the caller must then ask the server to resync rather than render a
 * half-applied grid. That path is a correctness backstop, not an expected occurrence.
 */
export class FloorWireDecoder {
  private lastCells: readonly ObservableCell[] | null = null;
  private lastFloorId: string | null = null;
  private lastRevision = -1;

  reset(): void {
    this.lastCells = null;
    this.lastFloorId = null;
    this.lastRevision = -1;
  }

  decode(wire: WireRunSnapshot): ServerRunSnapshot | null {
    const floor = wire.projection.floor;
    let cells: ObservableCell[];

    if (floor.cells.kind === 'full') {
      cells = Array.from({ length: floor.width * floor.height }, (_unused, index) =>
        unknownCell(index, floor.width),
      );
      for (const cell of floor.cells.knownCells) cells[cell.index] = cell;
    } else {
      if (
        this.lastCells === null ||
        this.lastFloorId !== floor.floorId ||
        this.lastRevision !== floor.cells.baseRevision
      ) {
        return null;
      }
      cells = [...this.lastCells];
      for (const cell of floor.cells.changedCells) cells[cell.index] = cell;
    }

    this.lastCells = cells;
    this.lastFloorId = floor.floorId;
    this.lastRevision = wire.revision;

    return {
      ...wire,
      projection: { ...wire.projection, floor: { ...floor, cells } },
    };
  }
}
