import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, timingSafeEqualHex } from '../../src/auth/tokens.js';

describe('generateToken', () => {
  it('returns distinct 43-character base64url strings across calls', () => {
    const a = generateToken();
    const b = generateToken();

    expect(a).not.toBe(b);
    expect(a).toHaveLength(43);
    expect(b).toHaveLength(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashToken', () => {
  it('is deterministic and produces a 64-character hex digest that differs from the input', () => {
    const token = generateToken();

    const first = hashToken(token);
    const second = hashToken(token);

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).toMatch(/^[0-9a-f]+$/);
    expect(first).not.toBe(token);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken('token-one')).not.toBe(hashToken('token-two'));
  });
});

describe('timingSafeEqualHex', () => {
  it('returns true for equal hex strings', () => {
    const hash = hashToken('some-token');
    expect(timingSafeEqualHex(hash, hash)).toBe(true);
  });

  it('returns false for unequal hex strings of the same length', () => {
    const a = hashToken('token-a');
    const b = hashToken('token-b');
    expect(timingSafeEqualHex(a, b)).toBe(false);
  });

  it('returns false without throwing for a length mismatch', () => {
    expect(() => timingSafeEqualHex('ab', 'abcd')).not.toThrow();
    expect(timingSafeEqualHex('ab', 'abcd')).toBe(false);
  });
});
