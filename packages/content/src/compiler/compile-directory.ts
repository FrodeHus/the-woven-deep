import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { CompiledContentPack, ContentEntry } from '../model.js';
import { CONTENT_SCHEMA_VERSION } from '../model.js';
import { compareCodeUnits, stableJsonHash } from './stable-json.js';
import { ContentCompileError, type ContentCompileIssue } from './error.js';
import { validateContentEntries, type LocatedContentEntry } from './content-validation.js';
import { parseContentFile } from './parse-file.js';
import { validateVaultEntry } from './vault-validation.js';

const FOUNDATIONAL_CATEGORIES = new Set(['defense', 'food', 'healing', 'identification', 'light', 'offense']);

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
  signal?: AbortSignal;
}): Promise<CompiledContentPack> {
  throwIfAborted(input.signal);
  const entries: ContentEntry[] = [];
  const locatedEntries: LocatedContentEntry[] = [];
  const vaultEntries: Array<{ entry: Extract<ContentEntry, { kind: 'vault' }>; file: string }> = [];
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
      if (entry.kind === 'vault') vaultEntries.push({ entry, file });
      entries.push(entry);
      locatedEntries.push({ entry, file });
    }
  }

  for (const { entry, file } of vaultEntries) {
    throwIfAborted(input.signal);
    issues.push(...validateVaultEntry(entry, file));
  }
  issues.push(...validateContentEntries(locatedEntries));

  throwIfAborted(input.signal);
  if (entries.length === 0) issues.push({ file: input.rootDir, path: '$', message: 'content directory contains no YAML entries' });
  for (const requiredKind of ['monster', 'item', 'vault', 'balance'] as const) {
    throwIfAborted(input.signal);
    if (!entries.some((entry) => entry.kind === requiredKind)) {
      issues.push({ file: input.rootDir, path: '$.entries', message: `missing foundational ${requiredKind} content` });
    }
  }
  const presentCategories = new Set(entries.flatMap((entry) => entry.tags)
    .filter((tag) => FOUNDATIONAL_CATEGORIES.has(tag)));
  for (const category of [...FOUNDATIONAL_CATEGORIES].sort(compareCodeUnits)) {
    if (!presentCategories.has(category)) {
      issues.push({ file: input.rootDir, path: '$.entries', message: `missing foundational category ${category}` });
    }
  }
  throwIfAborted(input.signal);
  if (issues.length > 0) {
    issues.sort((left, right) => compareCodeUnits(left.file, right.file)
      || compareCodeUnits(left.path, right.path)
      || compareCodeUnits(left.message, right.message));
    throw new ContentCompileError(issues);
  }
  entries.sort((left, right) => compareCodeUnits(left.id, right.id));
  throwIfAborted(input.signal);
  const generationReport = {
    foundationalCategories: [...presentCategories].sort(compareCodeUnits),
  };
  const hashInput = { schemaVersion: CONTENT_SCHEMA_VERSION, entries, generationReport };
  return { ...hashInput, hash: stableJsonHash(hashInput) };
}
