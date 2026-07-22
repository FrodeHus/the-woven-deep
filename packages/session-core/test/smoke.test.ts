import { describe, expect, it } from 'vitest';
import { SESSION_CORE_VERSION } from '../src/index.js';

describe('session-core scaffold', () => {
  it('exports a version placeholder', () => {
    expect(SESSION_CORE_VERSION).toBe('0.0.0');
  });
});
