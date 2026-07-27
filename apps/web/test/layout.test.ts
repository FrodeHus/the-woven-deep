import { describe, expect, it } from 'vitest';
import { layoutTier } from '../src/ui/layout.js';

describe('layoutTier', () => {
  it('is full at exactly the full threshold and above', () => {
    expect(layoutTier(1100)).toBe('full');
    expect(layoutTier(1101)).toBe('full');
    expect(layoutTier(2000)).toBe('full');
  });

  it('is compact just below the full threshold', () => {
    expect(layoutTier(1099)).toBe('compact');
  });

  it('is compact at exactly the compact threshold and above', () => {
    expect(layoutTier(760)).toBe('compact');
    expect(layoutTier(761)).toBe('compact');
  });

  it('is minimal just below the compact threshold and below', () => {
    expect(layoutTier(759)).toBe('minimal');
    expect(layoutTier(0)).toBe('minimal');
  });
});
