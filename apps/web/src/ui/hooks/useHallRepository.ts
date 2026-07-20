import { useMemo } from 'react';
import type { RunRecordRepository } from '@woven-deep/engine';
import {
  createSessionRunRecordRepository,
  SessionHallCorruptError,
} from '../../session/run-records-storage.js';
import type { SessionStorageLike } from '../../session/storage.js';

/**
 * The session-scoped Hall of Records repository plus any corruption notice. A corrupt blob throws
 * `SessionHallCorruptError` at construction; the module itself clears the storage key back to a
 * fresh, empty Hall before throwing, so retrying the SAME construction immediately succeeds and
 * the notice carries the original message. The active run (an entirely separate storage key) is
 * untouched either way — only a notice is surfaced.
 *
 * `storageEpoch` forces reconstruction after a guest-session wipe removes `RECORDS_KEY` out from
 * under the memo — `storage` itself never changes identity, so without this second dependency the
 * memo would keep serving the records it already loaded.
 */
export function useHallRepository(
  storage: SessionStorageLike,
  storageEpoch: number,
): readonly [RunRecordRepository, string | null] {
  return useMemo((): readonly [RunRecordRepository, string | null] => {
    try {
      return [createSessionRunRecordRepository(storage), null] as const;
    } catch (thrown) {
      if (thrown instanceof SessionHallCorruptError) {
        return [createSessionRunRecordRepository(storage), thrown.message] as const;
      }
      throw thrown;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storageEpoch is intentionally a dependency to force reconstruction after a session wipe, even though it is not read inside the memo.
  }, [storage, storageEpoch]);
}
