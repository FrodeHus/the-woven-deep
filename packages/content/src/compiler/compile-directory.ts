import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { CompiledContentPack, ContentEntry } from '../model.js';
import { CONTENT_SCHEMA_VERSION } from '../model.js';
import { canonicalHash, compareCodeUnits } from './canonicalize.js';
import { ContentCompileError, type ContentCompileIssue } from './error.js';
import { parseContentFile } from './parse-file.js';
import { stableIdSchema } from './schema.js';

export interface ContentRegistries {
  readonly ai: ReadonlySet<string>;
  readonly effects: ReadonlySet<string>;
}

function registryIssues(rootDir: string, registries: ContentRegistries): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const key of [...registries.ai].sort(compareCodeUnits)) {
    if (!stableIdSchema.safeParse(key).success || !key.startsWith('ai.')) {
      issues.push({
        file: rootDir,
        path: '$.registries.ai',
        message: `invalid AI registry key ${key}; expected ai.* namespaced ID`,
      });
    }
  }
  for (const key of [...registries.effects].sort(compareCodeUnits)) {
    if (!stableIdSchema.safeParse(key).success || !key.startsWith('effect.')) {
      issues.push({
        file: rootDir,
        path: '$.registries.effects',
        message: `invalid effect registry key ${key}; expected effect.* namespaced ID`,
      });
    }
  }
  return issues;
}

async function yamlPaths(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) found.push(...await yamlPaths(root, path));
    if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) found.push(path);
  }
  return found.sort((a, b) => compareCodeUnits(relative(root, a), relative(root, b)));
}

export async function compileContentDirectory(input: {
  rootDir: string;
  registries: ContentRegistries;
}): Promise<CompiledContentPack> {
  const startupIssues = registryIssues(input.rootDir, input.registries);
  if (startupIssues.length > 0) throw new ContentCompileError(startupIssues);

  const entries: ContentEntry[] = [];
  const issues: ContentCompileIssue[] = [];
  const seen = new Map<string, string>();

  for (const absolutePath of await yamlPaths(input.rootDir)) {
    const file = relative(input.rootDir, absolutePath);
    for (const entry of parseContentFile({ path: file, source: await readFile(absolutePath, 'utf8') })) {
      const firstFile = seen.get(entry.id);
      if (firstFile) issues.push({ file, path: '$.entries.id', message: `duplicate ${entry.id}; first declared in ${firstFile}` });
      else seen.set(entry.id, file);
      if (entry.kind === 'monster' && !input.registries.ai.has(entry.ai)) {
        issues.push({ file, path: `$.entries.${entry.id}.ai`, message: `unregistered AI ${entry.ai}` });
      }
      if (entry.kind === 'item' && !input.registries.effects.has(entry.effect)) {
        issues.push({ file, path: `$.entries.${entry.id}.effect`, message: `unregistered effect ${entry.effect}` });
      }
      entries.push(entry);
    }
  }

  if (entries.length === 0) issues.push({ file: input.rootDir, path: '$', message: 'content directory contains no YAML entries' });
  for (const requiredKind of ['monster', 'item'] as const) {
    if (!entries.some((entry) => entry.kind === requiredKind)) {
      issues.push({ file: input.rootDir, path: '$.entries', message: `missing foundational ${requiredKind} content` });
    }
  }
  if (issues.length > 0) throw new ContentCompileError(issues);
  entries.sort((left, right) => compareCodeUnits(left.id, right.id));
  const hashInput = { schemaVersion: CONTENT_SCHEMA_VERSION, entries };
  return { ...hashInput, hash: canonicalHash(hashInput) };
}
