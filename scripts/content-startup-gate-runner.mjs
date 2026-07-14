import { isDeepStrictEqual } from 'node:util';

export async function verifyContentStartupGate(runtime) {
  await runtime.startValid();
  let health;
  try {
    await runtime.assertReadOnly();
    health = await runtime.smokeValid();
  } finally {
    await runtime.stopValid();
  }

  const before = await runtime.snapshotPublications();
  const invalid = await runtime.runInvalid();
  if (invalid.exitCode === 0) {
    throw new Error('invalid schema-v3 replacement unexpectedly started');
  }
  if (!/schemaVersion|schema version/i.test(invalid.output)) {
    throw new Error(`invalid startup did not report a schema rejection: ${invalid.output}`);
  }
  const after = await runtime.snapshotPublications();
  if (!isDeepStrictEqual(after, before)) {
    throw new Error('rejected content changed published packs');
  }

  return {
    contentHash: health.contentHash,
    entries: health.entries,
    publications: after.length,
  };
}
