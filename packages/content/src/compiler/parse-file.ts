import { parseDocument } from 'yaml';
import type { ContentEntry } from '../model.js';
import { ContentCompileError } from './error.js';
import { contentFileSchema } from './schema.js';

const MAX_FILE_BYTES = 256 * 1024;

export function parseContentFile(input: { path: string; source: string }): readonly ContentEntry[] {
  if (Buffer.byteLength(input.source, 'utf8') > MAX_FILE_BYTES) {
    throw new ContentCompileError([{ file: input.path, path: '$', message: 'file exceeds 262144 bytes' }]);
  }

  const document = parseDocument(input.source, {
    schema: 'core',
    customTags: [],
    prettyErrors: false,
  });
  if (document.errors.length > 0) {
    throw new ContentCompileError(document.errors.map((error) => ({
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
  const result = contentFileSchema.safeParse(value);
  if (!result.success) {
    throw new ContentCompileError(result.error.issues.map((issue) => ({
      file: input.path,
      path: issue.path.length === 0 ? '$' : `$.${issue.path.join('.')}`,
      message: issue.message,
    })));
  }
  return result.data.entries;
}
