import type { ActiveRun } from './model.js';
import { SaveLoadError } from './save-error.js';
import { validateActiveRun } from './save-schema.js';
import { stableJson } from './stable-json.js';

export function encodeActiveRun(state: ActiveRun): string {
  return stableJson(validateActiveRun(state));
}

export function decodeActiveRun(json: string): ActiveRun {
  let input: unknown;
  try { input = JSON.parse(json); }
  catch (cause) { throw new SaveLoadError('malformed_json', '$', 'Save is not valid JSON', { cause }); }
  return validateActiveRun(input);
}
