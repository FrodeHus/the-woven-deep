import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

describe('readConfig', () => {
  it('defaults to the local development database path', () => {
    expect(readConfig({}).databasePath).toBe(resolve('data/rogue.sqlite'));
  });

  it('resolves the production database path override', () => {
    expect(readConfig({ DATABASE_PATH: '/data/rogue.sqlite' }).databasePath).toBe('/data/rogue.sqlite');
  });

  it('rejects invalid ports', () => {
    expect(() => readConfig({ PORT: '0' })).toThrow('PORT must be an integer from 1 to 65535');
    expect(() => readConfig({ PORT: '65536' })).toThrow('PORT must be an integer from 1 to 65535');
    expect(() => readConfig({ PORT: '3.14' })).toThrow('PORT must be an integer from 1 to 65535');
  });
});
