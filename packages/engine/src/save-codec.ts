import type { ActiveRun } from './model.js';
import { SaveLoadError } from './save-error.js';
import { validateActiveRun } from './save-schema.js';
import { stableJson } from './stable-json.js';
import { SAVE_SCHEMA_VERSION } from './versions.js';

export function encodeActiveRun(state: ActiveRun): string {
  return stableJson(validateActiveRun(state));
}

export function decodeActiveRun(json: string): ActiveRun {
  let input: unknown;
  try { input = JSON.parse(json); }
  catch (cause) { throw new SaveLoadError('malformed_json', '$', 'Save is not valid JSON', { cause }); }
  const schemaVersion = typeof input === 'object' && input !== null
    ? (input as Readonly<Record<string, unknown>>).schemaVersion
    : undefined;
  if (schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new SaveLoadError(
      'unsupported_version',
      'schemaVersion',
      `Unsupported save schema version ${String(schemaVersion)}; expected ${SAVE_SCHEMA_VERSION}`,
    );
  }
  return validateActiveRun(input);
}
