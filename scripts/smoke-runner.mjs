const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function verifyOnce(baseUrl, fetch, timeoutMs) {
  const health = await fetch(`${baseUrl}/api/health`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!health.ok) throw new Error(`health returned ${health.status}`);
  const body = await health.json();
  if (body.status !== 'ok' || !/^[a-f0-9]{64}$/.test(body.contentHash) || body.entries < 2) {
    throw new Error(`invalid health payload: ${JSON.stringify(body)}`);
  }
  const page = await fetch(baseUrl, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!page.ok || !(await page.text()).includes('<div id="root">')) {
    throw new Error('web client was not served');
  }
  return `ok ${body.contentHash} ${body.entries} entries\n`;
}

export async function runSmoke(baseUrl, options = {}) {
  const fetch = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? delay;
  const attempts = options.attempts ?? 5;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const retryDelayMs = options.retryDelayMs ?? 250;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await verifyOnce(baseUrl, fetch, timeoutMs);
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await sleep(retryDelayMs * (2 ** attempt));
    }
  }
  throw new Error('smoke test exhausted all attempts');
}
