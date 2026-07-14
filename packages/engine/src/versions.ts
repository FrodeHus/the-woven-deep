export const SAVE_SCHEMA_VERSION = 5 as const;
export const ENGINE_GAME_VERSION = '0.1.0' as const;
export const RECENT_COMMAND_LIMIT = 128 as const;

export const RNG_STREAM_NAMES = [
  'generation',
  'encounters',
  'population-gates',
  'merchant-stock',
  'merchant-runtime',
  'combat',
  'loot',
  'effects',
  'narrative',
] as const;

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number];
