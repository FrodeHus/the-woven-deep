import { parseDocument } from 'yaml';
import type { ContentEntry } from '../model.js';
import { ContentCompileError } from './error.js';
import { contentFileSchema, stableIdSchema } from './schema.js';
import { CONTENT_SCHEMA_VERSION } from '../model.js';

const MAX_FILE_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function structuralIssuePath(path: readonly PropertyKey[], value: unknown): string {
  const segments = [...path];
  if (segments[0] === 'entries' && typeof segments[1] === 'number' && isRecord(value)) {
    const entries = value.entries;
    const entry = Array.isArray(entries) ? entries[segments[1]] : undefined;
    const parsedId = isRecord(entry)
      ? stableIdSchema.safeParse(entry.id)
      : null;
    if (parsedId?.success) {
      segments[1] = parsedId.data;
    }
  }
  return segments.length === 0 ? '$' : `$.${segments.map(String).join('.')}`;
}

export function parseContentFile(input: { path: string; source: string }): readonly ContentEntry[] {
  if (Buffer.byteLength(input.source, 'utf8') > MAX_FILE_BYTES) {
    throw new ContentCompileError([{ file: input.path, path: '$', message: 'file exceeds 262144 bytes' }]);
  }

  const document = parseDocument(input.source, {
    schema: 'core',
    customTags: [],
    prettyErrors: false,
  });
  const parseIssues = [
    ...document.errors,
    ...document.warnings.filter((warning) => warning.code === 'TAG_RESOLVE_FAILED'),
  ];
  if (parseIssues.length > 0) {
    throw new ContentCompileError(parseIssues.map((error) => ({
      file: input.path,
      path: '$',
      message: error.message,
    })));
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ContentCompileError([{
      file: input.path,
      path: '$',
      message: error instanceof Error ? error.message : 'unsafe YAML alias',
    }]);
  }
  const suppliedVersion = isRecord(value) ? value.schemaVersion : undefined;
  if (suppliedVersion !== CONTENT_SCHEMA_VERSION) {
    throw new ContentCompileError([{
      file: input.path,
      path: '$.schemaVersion',
      message: `unsupported schemaVersion ${String(suppliedVersion)}; expected ${CONTENT_SCHEMA_VERSION}`,
    }]);
  }
  const result = contentFileSchema.safeParse(value);
  if (!result.success) {
    throw new ContentCompileError(result.error.issues.map((issue) => ({
      file: input.path,
      path: structuralIssuePath(issue.path, value),
      message: issue.message,
    })));
  }
  return result.data.entries;
}
