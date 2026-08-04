/** Moved to `@woven-deep/session-core` so the SERVER runs the identical planning and stop rules
 * when it walks a batched travel intent -- guest and profile play cannot drift apart if there is
 * only one copy. Re-exported here so existing local importers keep working unchanged. */
export * from '@woven-deep/session-core';
