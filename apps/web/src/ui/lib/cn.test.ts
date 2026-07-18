import { describe, expect, it } from 'vitest';
import { cn } from './cn.js';

describe('cn', () => {
  it('merges conditional classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('de-duplicates conflicting tailwind utilities, last wins', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
