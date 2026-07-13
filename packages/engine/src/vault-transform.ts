import type {
  VaultContentEntry,
  VaultLegendEntry,
  VaultLightFixture,
  VaultPlacementSlot,
  VaultRotation,
  VaultTerrainName,
} from '@woven-deep/content';

export interface TransformedVaultCell {
  readonly x: number;
  readonly y: number;
  readonly symbol: string;
  readonly terrain: VaultTerrainName;
}

export interface TransformedVaultFixture {
  readonly x: number;
  readonly y: number;
  readonly fixture: VaultLightFixture;
}

export interface TransformedVaultSlot {
  readonly x: number;
  readonly y: number;
  readonly slot: VaultPlacementSlot;
}

export interface TransformedVault {
  readonly vaultId: string;
  readonly rotation: VaultRotation;
  readonly reflected: boolean;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
  readonly cells: readonly TransformedVaultCell[];
  readonly entrances: readonly Readonly<{ x: number; y: number }>[];
  readonly fixtures: readonly TransformedVaultFixture[];
  readonly slots: readonly TransformedVaultSlot[];
}

interface SourceCell {
  readonly x: number;
  readonly y: number;
  readonly symbol: string;
  readonly legend: VaultLegendEntry;
}

function dimensions(width: number, height: number, rotation: VaultRotation): readonly [number, number] {
  return rotation === 90 || rotation === 270 ? [height, width] : [width, height];
}

function rotate(x: number, y: number, width: number, height: number, rotation: VaultRotation): readonly [number, number] {
  if (rotation === 90) return [height - 1 - y, x];
  if (rotation === 180) return [width - 1 - x, height - 1 - y];
  if (rotation === 270) return [y, width - 1 - x];
  return [x, y];
}

export function transformVault(
  template: VaultContentEntry,
  rotation: VaultRotation,
  reflected: boolean,
): TransformedVault {
  const sourceRows = template.layout.map((row) => [...row]);
  const sourceHeight = sourceRows.length;
  const sourceWidth = sourceRows[0]?.length ?? 0;
  const [width, height] = dimensions(sourceWidth, sourceHeight, rotation);
  const sourceCells: SourceCell[] = [];
  for (let y = 0; y < sourceHeight; y += 1) for (let x = 0; x < sourceWidth; x += 1) {
    const symbol = sourceRows[y]![x]!;
    sourceCells.push({ x, y, symbol, legend: template.legend[symbol]! });
  }
  const transformed = sourceCells.map((cell) => {
    const [rotatedX, transformedY] = rotate(cell.x, cell.y, sourceWidth, sourceHeight, rotation);
    return { ...cell, x: reflected ? width - 1 - rotatedX : rotatedX, y: transformedY };
  }).sort((left, right) => left.y - right.y || left.x - right.x);
  const cells = transformed.map(({ x, y, symbol, legend }) => ({ x, y, symbol, terrain: legend.terrain }));
  const rows = Array.from({ length: height }, (_, y) =>
    cells.filter((cell) => cell.y === y).map((cell) => cell.symbol).join(''));
  const rowMajor = <T extends { readonly x: number; readonly y: number }>(values: T[]): readonly T[] =>
    values.sort((left, right) => left.y - right.y || left.x - right.x);
  return {
    vaultId: template.id,
    rotation,
    reflected,
    width,
    height,
    rows,
    cells,
    entrances: rowMajor(transformed.filter((cell) => cell.legend.entrance).map(({ x, y }) => ({ x, y }))),
    fixtures: rowMajor(transformed.filter((cell) => cell.legend.light !== null)
      .map(({ x, y, legend }) => ({ x, y, fixture: legend.light! }))),
    slots: rowMajor(transformed.filter((cell) => cell.legend.slot !== null)
      .map(({ x, y, legend }) => ({ x, y, slot: legend.slot! }))),
  };
}

export function vaultTransforms(template: VaultContentEntry): readonly TransformedVault[] {
  return [...template.transforms.rotations]
    .sort((left, right) => left - right)
    .flatMap((rotation) => template.transforms.reflectHorizontal
      ? [transformVault(template, rotation, false), transformVault(template, rotation, true)]
      : [transformVault(template, rotation, false)]);
}
