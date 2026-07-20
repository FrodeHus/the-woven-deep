import { z } from 'zod';
import type { CompiledContentPack, ContentEntry } from './model.js';
import { CONTENT_SCHEMA_VERSION } from './model.js';
import { contentEntrySchema } from './compiler/schema.js';
import { validateContentEntries } from './compiler/content-validation.js';
import { validateVaultEntry } from './compiler/vault-validation.js';

const envelope = z.strictObject({
  schemaVersion: z.number().int().safe(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  entries: z.array(z.unknown()),
  generationReport: z.strictObject({
    foundationalCategories: z.array(z.string().min(1)).readonly(),
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(normalizedJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${normalizedJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Compiled content must contain JSON values only');
  return encoded;
}

function validateEntry(value: unknown, index: number): ContentEntry {
  let input = value;
  let expectedVaultMetadata:
    Readonly<{ entranceCount: unknown; requiredSlotIds: unknown }> | undefined;
  if (isRecord(value) && value.kind === 'vault') {
    const { entranceCount, requiredSlotIds, ...source } = value;
    expectedVaultMetadata = { entranceCount, requiredSlotIds };
    input = source;
  }
  const result = contentEntrySchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new TypeError(
      `Invalid compiled content at entries.${index}.${issue.path.join('.')}: ${issue.message}`,
    );
  }
  if (result.data.kind === 'vault') {
    if (
      expectedVaultMetadata?.entranceCount !== result.data.entranceCount ||
      JSON.stringify(expectedVaultMetadata.requiredSlotIds) !==
        JSON.stringify(result.data.requiredSlotIds)
    ) {
      throw new TypeError(
        `Invalid compiled content at entries.${index}: vault metadata does not match its layout`,
      );
    }
  }
  if (normalizedJson(value) !== normalizedJson(result.data)) {
    throw new TypeError(
      `Invalid compiled content at entries.${index}: compiled entry is missing materialized fields`,
    );
  }
  return result.data as ContentEntry;
}

export function validateCompiledContentPack(input: unknown): CompiledContentPack {
  const suppliedVersion = isRecord(input) ? input.schemaVersion : undefined;
  if (suppliedVersion !== CONTENT_SCHEMA_VERSION) {
    throw new TypeError(
      `Unsupported content schema version ${String(suppliedVersion)}; expected ${CONTENT_SCHEMA_VERSION}`,
    );
  }
  const parsed = envelope.parse(input);
  const entries = parsed.entries.map(validateEntry);
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.id >= entries[index]!.id) {
      throw new TypeError(
        `Invalid compiled content at entries.${index}.id: identifiers must be unique and strictly increasing`,
      );
    }
  }
  for (let index = 1; index < parsed.generationReport.foundationalCategories.length; index += 1) {
    if (
      parsed.generationReport.foundationalCategories[index - 1]! >=
      parsed.generationReport.foundationalCategories[index]!
    ) {
      throw new TypeError(
        'Invalid compiled content generation report: categories must be unique and strictly increasing',
      );
    }
  }
  const semanticIssues = validateContentEntries(
    entries.map((entry) => ({ entry, file: 'compiled content' })),
  );
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    if (entry.kind === 'vault')
      semanticIssues.push(...validateVaultEntry(entry, 'compiled content', byId));
  }
  if (semanticIssues.length > 0) {
    const first = semanticIssues[0]!;
    throw new TypeError(`Invalid compiled content at ${first.path}: ${first.message}`);
  }
  return { ...parsed, entries } as CompiledContentPack;
}
