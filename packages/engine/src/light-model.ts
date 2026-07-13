import type { OpaqueId } from './model.js';

export type RgbColor = readonly [number, number, number];

export interface AmbientLight {
  readonly color: RgbColor;
  readonly strength: number;
}

export type LightLocation =
  | { readonly type: 'fixed'; readonly x: number; readonly y: number }
  | { readonly type: 'actor'; readonly actorId: OpaqueId };

export interface LightSource {
  readonly lightId: OpaqueId;
  readonly location: LightLocation;
  readonly color: RgbColor;
  readonly radius: number;
  readonly strength: number;
  readonly enabled: boolean;
  readonly falloff: 'linear';
  readonly vaultPlacementId: OpaqueId | null;
  readonly presentation: Readonly<{ glyph: string; token: OpaqueId }> | null;
}

export interface IlluminationField {
  readonly red: readonly number[];
  readonly green: readonly number[];
  readonly blue: readonly number[];
  readonly intensity: readonly number[];
}
