import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const forbiddenImports = /(?:from\s*|import\s*)['"](?:node:|react(?:\/|['"]|$)|fastify(?:\/|['"]|$)|better-sqlite3(?:\/|['"]|$))/;
const forbiddenAmbient = /\b(?:Math\.random\s*\(|Date\.now\s*\(|new\s+Date\s*\(|performance\.now\s*\(|localStorage\b|sessionStorage\b)/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat().sort();
}

describe('browser-safe production graph', () => {
  it('contains no platform framework, Node, storage, clock, or ambient-random dependency', async () => {
    const files = await sourceFiles(sourceRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(forbiddenImports);
      expect(source, file).not.toMatch(forbiddenAmbient);
    }
  });
});
