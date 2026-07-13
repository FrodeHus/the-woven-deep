import { describe, expect, it } from 'vitest';
import { CONTENT_SCHEMA_VERSION, type CompiledContentPack } from '../src/index.js';

describe('content model', () => {
  it('publishes a versioned, immutable pack contract', () => {
    const pack: CompiledContentPack = {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      hash: 'a'.repeat(64),
      entries: [],
    };

    expect(pack.schemaVersion).toBe(1);
    expect(pack.hash).toHaveLength(64);
  });
});
