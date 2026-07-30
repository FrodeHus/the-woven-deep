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
  const [attempt, setAttempt] = useState(0);
  // The settled outcome is stamped with the request it belongs to, so a new request (a retry, or a
  // different `fetcher`) reads as loading by comparison while rendering -- no effect has to clear
  // the previous pack/error first.
  const [outcome, setOutcome] = useState<{
    readonly fetcher: typeof fetch;
    readonly attempt: number;
    readonly pack?: CompiledContentPack;
    readonly error?: string;
  }>();

  useEffect(() => {
    let cancelled = false;
    void loadContentPack(fetcher).then(
      (loaded) => {
        if (!cancelled) setOutcome({ fetcher, attempt, pack: loaded });
      },
      (reason: unknown) => {
        if (!cancelled)
          setOutcome({
            fetcher,
            attempt,
            error: reason instanceof Error ? reason.message : 'The content service is unavailable.',
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher, attempt]);

  const current =
    outcome && outcome.fetcher === fetcher && outcome.attempt === attempt ? outcome : undefined;

  return {
    pack: current?.pack,
    error: current?.error,
    retry: () => setAttempt((count) => count + 1),
  };
}
