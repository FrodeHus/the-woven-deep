import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const forbiddenAmbient =
  /\b(?:Math\.random\s*\(|Date\.now\s*\(|new\s+Date\s*\(|performance\.now\s*\(|localStorage\b|sessionStorage\b)/;
const forbiddenRoots = ['react', 'fastify', 'better-sqlite3'] as const;

function isForbiddenModule(specifier: string): boolean {
  return (
    specifier.startsWith('node:') ||
    forbiddenRoots.some((root) => specifier === root || specifier.startsWith(`${root}/`))
  );
}

function findForbiddenModuleSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const inspect = (specifier: ts.Expression | undefined): void => {
    if (specifier && ts.isStringLiteralLike(specifier) && isForbiddenModule(specifier.text))
      found.push(specifier.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      inspect(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      inspect(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) inspect(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

describe('browser-safe production graph', () => {
  it('detects a forbidden dynamic import in synthetic source', () => {
    expect(
      findForbiddenModuleSpecifiers(
        "async function load() { await import('node:fs'); }",
        'synthetic.ts',
      ),
    ).toEqual(['node:fs']);
  });

  it('allows the reviewed ROT.js browser import', () => {
    expect(
      findForbiddenModuleSpecifiers("import { FOV, Map, RNG } from 'rot-js';", 'synthetic.ts'),
    ).toEqual([]);
  });

  it('contains no platform framework, Node, storage, clock, or ambient-random dependency', async () => {
    const files = await sourceFiles(sourceRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(findForbiddenModuleSpecifiers(source, file), file).toEqual([]);
      expect(source, file).not.toMatch(forbiddenAmbient);
    }
  });
});
