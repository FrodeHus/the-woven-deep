import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

describe('readConfig', () => {
  it('resolves local defaults independently of the process working directory', () => {
    const originalCwd = process.cwd();
    const repositoryRoot = resolve(import.meta.dirname, '../../..');

    try {
      process.chdir(import.meta.dirname);
      const fromServerTestDirectory = readConfig({});
      process.chdir(repositoryRoot);
      const fromRepositoryRoot = readConfig({});

      expect(fromServerTestDirectory).toEqual(fromRepositoryRoot);
      expect(fromRepositoryRoot.databasePath).toBe(resolve(repositoryRoot, 'data/rogue.sqlite'));
      expect(fromRepositoryRoot.contentDir).toBe(resolve(repositoryRoot, 'content'));
      expect(fromRepositoryRoot.webDistDir).toBe(resolve(repositoryRoot, 'apps/web/dist'));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('resolves explicit production path overrides unchanged', () => {
    expect(readConfig({
      DATABASE_PATH: '/data/rogue.sqlite',
      CONTENT_DIR: '/app/content',
      WEB_DIST_DIR: '/app/apps/web/dist',
    })).toMatchObject({
      databasePath: '/data/rogue.sqlite',
      contentDir: '/app/content',
      webDistDir: '/app/apps/web/dist',
    });
  });

  it('rejects invalid ports', () => {
    expect(() => readConfig({ PORT: '0' })).toThrow('PORT must be an integer from 1 to 65535');
    expect(() => readConfig({ PORT: '65536' })).toThrow('PORT must be an integer from 1 to 65535');
    expect(() => readConfig({ PORT: '3.14' })).toThrow('PORT must be an integer from 1 to 65535');
  });
});
