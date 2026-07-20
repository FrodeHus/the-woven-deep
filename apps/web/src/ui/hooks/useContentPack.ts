import { useEffect, useState } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { loadContentPack } from '../../api.js';

export interface UseContentPackResult {
  readonly pack: CompiledContentPack | undefined;
  readonly error: string | undefined;
  readonly retry: () => void;
}

/** Owns the boot-time content-pack fetch: loading -> pack, or loading -> error with a `retry` that
 * re-fires the effect. `attempt` is the retry counter the effect keys off, bumped by `retry`. */
export function useContentPack(fetcher: typeof fetch): UseContentPackResult {
  const [pack, setPack] = useState<CompiledContentPack>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    setPack(undefined);
    void loadContentPack(fetcher).then(
      (loaded) => {
        if (!cancelled) setPack(loaded);
      },
      (reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : 'The content service is unavailable.',
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher, attempt]);

  return { pack, error, retry: () => setAttempt((count) => count + 1) };
}
