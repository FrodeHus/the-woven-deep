import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { CompiledContentPack, ContentEntry } from '../model.js';
import { CONTENT_SCHEMA_VERSION } from '../model.js';
import { compareCodeUnits, stableJsonHash } from './stable-json.js';
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

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function yamlPaths(root: string, current = root, signal?: AbortSignal): Promise<string[]> {
  throwIfAborted(signal);
  const entries = await readdir(current, { withFileTypes: true });
  throwIfAborted(signal);
  const found: string[] = [];
  for (const entry of entries) {
    throwIfAborted(signal);
    const path = join(current, entry.name);
    if (entry.isDirectory()) found.push(...await yamlPaths(root, path, signal));
    if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) found.push(path);
  }
  throwIfAborted(signal);
  found.sort((a, b) => compareCodeUnits(relative(root, a), relative(root, b)));
  throwIfAborted(signal);
  return found;
}

export async function compileContentDirectory(input: {
  rootDir: string;
  registries: ContentRegistries;
  signal?: AbortSignal;
}): Promise<CompiledContentPack> {
  throwIfAborted(input.signal);
  const startupIssues = registryIssues(input.rootDir, input.registries);
  throwIfAborted(input.signal);
  if (startupIssues.length > 0) throw new ContentCompileError(startupIssues);

  const entries: ContentEntry[] = [];
  const issues: ContentCompileIssue[] = [];
  const seen = new Map<string, string>();

  for (const absolutePath of await yamlPaths(input.rootDir, input.rootDir, input.signal)) {
    throwIfAborted(input.signal);
    const file = relative(input.rootDir, absolutePath);
    const source = await readFile(absolutePath, { encoding: 'utf8', signal: input.signal });
    throwIfAborted(input.signal);
    const parsedEntries = parseContentFile({ path: file, source });
    throwIfAborted(input.signal);
    for (const entry of parsedEntries) {
      throwIfAborted(input.signal);
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

  throwIfAborted(input.signal);
  if (entries.length === 0) issues.push({ file: input.rootDir, path: '$', message: 'content directory contains no YAML entries' });
  for (const requiredKind of ['monster', 'item'] as const) {
    throwIfAborted(input.signal);
    if (!entries.some((entry) => entry.kind === requiredKind)) {
      issues.push({ file: input.rootDir, path: '$.entries', message: `missing foundational ${requiredKind} content` });
    }
  }
  throwIfAborted(input.signal);
  if (issues.length > 0) throw new ContentCompileError(issues);
  entries.sort((left, right) => compareCodeUnits(left.id, right.id));
  throwIfAborted(input.signal);
  const hashInput = { schemaVersion: CONTENT_SCHEMA_VERSION, entries };
  return { ...hashInput, hash: stableJsonHash(hashInput) };
}
