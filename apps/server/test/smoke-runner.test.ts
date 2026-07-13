import { expect, it, vi } from 'vitest';
import { runSmoke } from '../../../scripts/smoke-runner.mjs';

it('retries transient failures with bounded requests and preserves the smoke output', async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new Error('not ready'))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      status: 'ok',
      contentHash: 'a'.repeat(64),
      entries: 2,
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response('<div id="root"></div>', { status: 200 }));
  const sleep = vi.fn(async () => undefined);

  await expect(runSmoke('http://example.test', {
    fetch,
    sleep,
    attempts: 2,
    timeoutMs: 100,
    retryDelayMs: 10,
  })).resolves.toBe(`ok ${'a'.repeat(64)} 2 entries\n`);

  expect(sleep).toHaveBeenCalledWith(10);
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [, options] of fetch.mock.calls) {
    expect(options.signal).toBeInstanceOf(AbortSignal);
  }
});

it('stops retrying an unavailable endpoint after the configured bound', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('unavailable'));
  const sleep = vi.fn(async () => undefined);

  await expect(runSmoke('http://example.test', {
    fetch,
    sleep,
    attempts: 3,
    timeoutMs: 100,
    retryDelayMs: 5,
  })).rejects.toThrow('unavailable');

  expect(fetch).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls).toEqual([[5], [10]]);
});
